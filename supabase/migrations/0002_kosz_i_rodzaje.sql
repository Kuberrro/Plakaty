-- Aktualizacja 2: kosz (miękkie usuwanie) i nowe rodzaje miejsc.
-- Tylko DODAJE: nie usuwa ani nie zmienia istniejących danych. Można uruchomić ponownie.
-- Uruchom raz w Supabase: SQL Editor -> New query -> wklej -> Run.

alter table public.points add column if not exists deleted_at timestamptz;

alter table public.points drop constraint if exists points_place_type_check;
alter table public.points add constraint points_place_type_check check (place_type in (
  'fire_station', 'notice_board', 'crossroads', 'shop', 'bus_stop', 'roadside', 'church', 'community', 'other'));

-- Widok statusów: ta sama reguła, nadal z security_invoker (RLS jak na tabelach).
create or replace view public.point_status with (security_invoker = true) as
select p.user_id, p.id as point_id, p.name, p.archived_at,
  coalesce((
    select case v.outcome when 'posted' then 'posted' when 'return' then 'return' else 'impossible' end
    from public.visits v
    where v.user_id = p.user_id and v.point_id = p.id and v.cancelled_at is null
    order by v.visited_at desc, v.created_at desc, v.id desc
    limit 1), 'todo') as status,
  p.deleted_at
from public.points p;

revoke all on public.point_status from public, anon;
grant select on public.point_status to authenticated;
