-- Uruchamiane przez scripts/test-upgrade.mjs: dane wersji 1.0 przed aktualizacją 0002.
insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.points (user_id,id,name,place_type,lat,lng,source,created_at,updated_at,last_op_id)
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 'P' || g, (array['fire_station','notice_board','other'])[1 + g % 3], 50, 20, 'manual', now(), now(), gen_random_uuid()
from generate_series(1, 200) g;
insert into public.visits (user_id,id,point_id,visited_at,outcome,poster_count,created_at,updated_at,last_op_id)
select user_id, gen_random_uuid(), id, now(), 'posted', 1, now(), now(), gen_random_uuid() from public.points;
