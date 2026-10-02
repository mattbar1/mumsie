-- =====================================================================
-- Mumsie's Meals — Supabase setup
--
-- Paste this WHOLE file into the Supabase SQL editor (your project →
-- SQL Editor → New query) and run it once. It creates the tables,
-- locks them down, creates the token-checked functions the app calls,
-- and seeds your 4 restaurants and everyone's login token.
--
-- Safe to re-run: it drops and recreates the functions, but will
-- error on the CREATE TABLE / seed INSERTs if you run it twice. If
-- you need to re-run the whole thing on a project that already has
-- this schema, ask Claude for a version that handles that.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now()
);

create table restaurants (
  id text primary key,
  name text not null,
  emoji text not null default '🍽️',
  hue int not null default 30,
  cuisine text not null default '',
  address text not null default '',
  phone text not null default '',
  hours text not null default '',
  url text not null default '',
  menu jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table visits (
  id uuid primary key default gen_random_uuid(),
  rest_id text references restaurants(id) on delete set null,
  meal text not null check (meal in ('Breakfast','Lunch','Dinner')),
  type text not null check (type in ('Ate there','Takeout')),
  who text not null,
  ate text not null default '',
  ts timestamptz not null default now(),
  created_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Lock everything down: RLS on, and no direct grants to anon at all.
-- The anon key (used by the app) will ONLY be able to call the
-- functions below — it can never read or write these tables directly.
-- ---------------------------------------------------------------------

alter table people enable row level security;
alter table restaurants enable row level security;
alter table visits enable row level security;
-- (no policies are created, so RLS denies everything by default)

revoke all on people, restaurants, visits from anon, authenticated;

-- ---------------------------------------------------------------------
-- Functions (SECURITY DEFINER = run with elevated rights, but every
-- one of them checks the token itself before doing anything).
-- ---------------------------------------------------------------------

create or replace function app_sync(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
begin
  select * into me from people where token = p_token;
  if me.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  return jsonb_build_object(
    'ok', true,
    'me', jsonb_build_object('name', me.name, 'role', me.role),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('name', name) order by name), '[]'::jsonb) from people),
    'restaurants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'emoji', emoji, 'hue', hue, 'cuisine', cuisine,
        'address', address, 'phone', phone, 'hours', hours, 'url', url,
        'menu', menu, 'note', note
      ) order by name), '[]'::jsonb)
      from restaurants
    ),
    'visits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'restId', rest_id, 'meal', meal, 'type', type, 'who', who,
        'ate', ate, 'ts', (extract(epoch from ts) * 1000)::bigint
      ) order by ts desc), '[]'::jsonb)
      from visits
    )
  );
end;
$$;

create or replace function log_visit(
  p_token text, p_rest_id text, p_meal text, p_type text,
  p_who text, p_ate text, p_ts bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
  new_id uuid;
  use_ts timestamptz;
begin
  select * into me from people where token = p_token;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if p_meal not in ('Breakfast','Lunch','Dinner') then return jsonb_build_object('ok', false, 'error', 'bad_meal'); end if;
  if p_type not in ('Ate there','Takeout') then return jsonb_build_object('ok', false, 'error', 'bad_type'); end if;
  if coalesce(trim(p_who), '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_who'); end if;
  if not exists (select 1 from restaurants where id = p_rest_id) then
    return jsonb_build_object('ok', false, 'error', 'bad_restaurant');
  end if;

  use_ts := case when p_ts is null then now() else to_timestamp(p_ts / 1000.0) end;

  insert into visits (rest_id, meal, type, who, ate, ts, created_by)
  values (p_rest_id, p_meal, p_type, p_who, coalesce(p_ate, ''), use_ts, me.id)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function delete_visit(p_token text, p_visit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
  v visits;
begin
  select * into me from people where token = p_token;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;

  select * into v from visits where id = p_visit_id;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if me.role <> 'admin' and v.created_by is distinct from me.id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from visits where id = p_visit_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function add_restaurant(
  p_token text, p_name text, p_emoji text, p_cuisine text, p_address text,
  p_phone text, p_hours text, p_url text, p_menu jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
  new_id text;
begin
  select * into me from people where token = p_token;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if me.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;

  new_id := 'r_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  insert into restaurants (id, name, emoji, hue, cuisine, address, phone, hours, url, menu)
  values (new_id, p_name, coalesce(nullif(p_emoji,''),'🍽️'), (random()*360)::int,
          coalesce(p_cuisine,''), coalesce(p_address,''), coalesce(p_phone,''),
          coalesce(p_hours,''), coalesce(p_url,''), coalesce(p_menu, '[]'::jsonb));

  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function update_restaurant(
  p_token text, p_id text, p_name text, p_emoji text, p_cuisine text, p_address text,
  p_phone text, p_hours text, p_url text, p_menu jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
begin
  select * into me from people where token = p_token;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if me.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not exists (select 1 from restaurants where id = p_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if coalesce(trim(p_name), '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_name'); end if;

  update restaurants set
    name = p_name,
    emoji = coalesce(nullif(p_emoji,''),'🍽️'),
    cuisine = coalesce(p_cuisine,''),
    address = coalesce(p_address,''),
    phone = coalesce(p_phone,''),
    hours = coalesce(p_hours,''),
    url = coalesce(p_url,''),
    menu = coalesce(p_menu, '[]'::jsonb),
    note = ''
  where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function delete_restaurant(p_token text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me people;
begin
  select * into me from people where token = p_token;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'invalid_token'); end if;
  if me.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  delete from restaurants where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Only the functions above are reachable by the app's anon key.
grant execute on function app_sync(text) to anon;
grant execute on function log_visit(text, text, text, text, text, text, bigint) to anon;
grant execute on function delete_visit(text, uuid) to anon;
grant execute on function add_restaurant(text, text, text, text, text, text, text, text, jsonb) to anon;
grant execute on function update_restaurant(text, text, text, text, text, text, text, text, text, jsonb) to anon;
grant execute on function delete_restaurant(text, text) to anon;

-- ---------------------------------------------------------------------
-- Seed data: the 4 restaurants already in the app
-- ---------------------------------------------------------------------

insert into restaurants (id, name, emoji, hue, cuisine, address, phone, hours, url, menu, note) values
('r_vincents', 'Vincent''s Italian Cuisine', '🍝', 8, 'Italian · Metairie',
 '4411 Chastant St, Metairie', '504-885-2984', 'Lunch Wed–Fri · Dinner Mon–Sat',
 'https://vincentsitaliancuisine.com/',
 '["Chicken Parmagiana","Spaghetti and Meatballs","Homemade Lasagna","Fettucine Alfredo","Chicken Marsala","Veal Parmagiana","Canneloni","Eggplant Parmagiana","Corn & Crabmeat Bisque","Fried Calamari","Caesar Salad","White Chocolate Bread Pudding"]'::jsonb,
 ''),
('r_faustos', 'Fausto''s Bistro', '🍷', 345, 'Italian & Sicilian · Metairie',
 '530 Veterans Memorial Blvd, Metairie', '504-833-7121', 'Mon–Thu 11–9 · Fri 11–10 · Sat 5–10',
 'https://www.faustosbistro.com/lunch-menu/',
 '[]'::jsonb,
 'Their menu is a picture on their website. Lisa can type favorites in.'),
('r_nami', 'Sushi Nami', '🍣', 200, 'Japanese · Metairie',
 'Veterans Memorial Blvd, Metairie', '', 'Open 7 days',
 'https://www.sushi-nami.com/',
 '["Sushi rolls","Sashimi","Shrimp tempura","Chicken teriyaki","Hibachi","Fried rice","Chicken wings"]'::jsonb,
 'General items only. Lisa can update from their site.'),
('r_zea', 'Zea Rotisserie & Bar', '🍗', 28, 'Rotisserie & Louisiana · Metairie',
 '4416 Veterans Memorial Blvd, Metairie', '504-780-9090', 'Mon 4–9:30 · Tue–Sun 11–9:30',
 'https://zearestaurants.com/location/metairie/menu',
 '["Rotisserie Chicken","Rotisserie Chicken Marsala","Thai Ribs","Pepper Jelly Chicken Salad","Catfish Amandine","Shrimp Breaux Bridge","Crispy Shrimp & Grits","Red Beans & Rice","Honey Island Chicken","Bacon Cheeseburger","Sedona Chicken Panini","Balsamic Salmon","Spinach Dip","Key Lime Pie","Sweet Potato Pecan Bread Pudding"]'::jsonb,
 '');

-- ---------------------------------------------------------------------
-- Seed data: people. Tokens are generated automatically (random,
-- long, unique) — you'll copy them out with the query further down.
-- To add someone later, just run:
--   insert into people (name, role) values ('New Person', 'member');
-- ---------------------------------------------------------------------

insert into people (name, role) values
('Lisa', 'admin'),
('Claudia', 'member'),
('Tee', 'member'),
('Brian', 'member'),
('Carrie', 'member'),
('Sharon', 'member'),
('Kristen', 'member'),
('Craig', 'member');

-- ---------------------------------------------------------------------
-- Run this QUERY (not part of the setup above — run it separately,
-- any time) to get everyone's personal link. Replace the site URL
-- with your real Netlify URL once you have it. Only you can see this
-- (it's your private SQL editor) — never paste these links anywhere
-- public.
-- ---------------------------------------------------------------------

-- select name, role, 'https://YOUR-SITE.netlify.app/?k=' || token as link
-- from people order by role desc, name;
