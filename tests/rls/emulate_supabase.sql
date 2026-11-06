-- Minimalna emulacja środowiska Supabase na czystym Postgresie (tylko do testów).
-- Definicja auth.uid() odpowiada tej z Supabase: id użytkownika pochodzi z JWT.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role authenticator noinherit login password 'test';
grant anon, authenticated to authenticator;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase domyślnie nadaje szerokie uprawnienia nowym tabelom; odtwarzamy to,
-- żeby sprawdzić, że migracja je odbiera.
alter default privileges in schema public grant all on tables to anon, authenticated;
