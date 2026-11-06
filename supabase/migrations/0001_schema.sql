-- Plakaty: schemat bazy. Uruchom raz w Supabase: SQL Editor -> New query -> wklej -> Run.
-- Zasady:
--  * klucz główny (user_id, id): identyczne UUID na dwóch kontach nigdy się nie zderzą;
--  * klucz obcy wizyty (user_id, point_id) -> punkt (user_id, id): wizyta z definicji
--    nie może wskazywać punktu innego użytkownika;
--  * server_rev i server_updated_at nadaje wyłącznie baza (wyzwalacz), klient ich nie sfałszuje;
--  * aktualny status punktu NIE jest przechowywany: wynika z historii wizyt.

create table public.points (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id             uuid not null,
  name           text not null check (char_length(btrim(name)) between 1 and 200),
  place_type     text not null check (place_type in ('fire_station', 'notice_board', 'other')),
  locality       text not null default '' check (char_length(locality) <= 200),
  address        text check (char_length(address) <= 300),
  region         text check (char_length(region) <= 100),
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  board_lat      double precision check (board_lat between -90 and 90),
  board_lng      double precision check (board_lng between -180 and 180),
  source         text not null check (source in ('osm', 'manual', 'import')),
  source_ref     text check (char_length(source_ref) <= 200),
  osm            jsonb check (osm is null or (jsonb_typeof(osm) = 'object' and pg_column_size(osm) <= 20000)),
  note           text not null default '' check (char_length(note) <= 5000),
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  archived_at    timestamptz,
  archive_reason text check (char_length(archive_reason) <= 500),
  last_op_id     uuid not null,
  server_rev     bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint board_coords_together check ((board_lat is null) = (board_lng is null))
);

create table public.visits (
  user_id        uuid not null default auth.uid(),
  id             uuid not null,
  point_id       uuid not null,
  visited_at     timestamptz not null,
  outcome        text not null check (outcome in ('posted', 'return', 'impossible')),
  poster_count   integer not null default 0 check (poster_count between 0 and 1000),
  note           text not null default '' check (char_length(note) <= 5000),
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  cancelled_at   timestamptz,
  cancel_reason  text check (char_length(cancel_reason) <= 500),
  gps_lat        double precision check (gps_lat between -90 and 90),
  gps_lng        double precision check (gps_lng between -180 and 180),
  gps_accuracy_m double precision check (gps_accuracy_m >= 0),
  gps_measured_at timestamptz,
  corrections    jsonb not null default '[]' check (jsonb_typeof(corrections) = 'array' and pg_column_size(corrections) <= 50000),
  last_op_id     uuid not null,
  server_rev     bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint visit_point_same_owner foreign key (user_id, point_id)
    references public.points (user_id, id) on delete cascade,
  constraint gps_complete check (
    (gps_lat is null and gps_lng is null and gps_accuracy_m is null and gps_measured_at is null)
    or (gps_lat is not null and gps_lng is not null and gps_measured_at is not null))
);

-- Ten sam obiekt OSM może być w bazie jednego użytkownika tylko raz.
create unique index points_unique_source_ref on public.points (user_id, source, source_ref)
  where source_ref is not null;
create index points_pull on public.points (user_id, server_updated_at, id);
create index visits_pull on public.visits (user_id, server_updated_at, id);
create index visits_by_point on public.visits (user_id, point_id, visited_at desc);

-- Numer wersji wiersza i czas serwera: podstawa wykrywania konfliktów i pobierania zmian.
create function public.stamp_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Nie można zmienić właściciela rekordu' using errcode = '42501';
    end if;
    new.server_rev := old.server_rev + 1;
    new.created_at := old.created_at;
  else
    new.server_rev := 1;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

create trigger points_stamp before insert or update on public.points
  for each row execute function public.stamp_row();
create trigger visits_stamp before insert or update on public.visits
  for each row execute function public.stamp_row();

-- RLS: wyłącznie właściciel. Anonim nie ma nawet uprawnień do tabel.
alter table public.points enable row level security;
alter table public.visits enable row level security;
alter table public.points force row level security;
alter table public.visits force row level security;

revoke all on public.points, public.visits from public, anon;
grant select, insert, update, delete on public.points, public.visits to authenticated;

create policy points_select on public.points for select to authenticated
  using ((select auth.uid()) = user_id);
create policy points_insert on public.points for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy points_update on public.points for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy points_delete on public.points for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy visits_select on public.visits for select to authenticated
  using ((select auth.uid()) = user_id);
create policy visits_insert on public.visits for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy visits_update on public.visits for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy visits_delete on public.visits for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Podgląd statusów w panelu Supabase. security_invoker = RLS działa jak na tabelach.
-- Reguła identyczna jak w src/lib/status.ts.
create view public.point_status with (security_invoker = true) as
select p.user_id, p.id as point_id, p.name, p.archived_at,
  coalesce((
    select case v.outcome when 'posted' then 'posted' when 'return' then 'return' else 'impossible' end
    from public.visits v
    where v.user_id = p.user_id and v.point_id = p.id and v.cancelled_at is null
    order by v.visited_at desc, v.created_at desc, v.id desc
    limit 1), 'todo') as status
from public.points p;

revoke all on public.point_status from public, anon;
grant select on public.point_status to authenticated;
