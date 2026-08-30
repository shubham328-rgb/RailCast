-- ============================================================================
-- RailCast — Supabase (Postgres) schema
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase dashboard:  SQL Editor -> New query -> paste ->
-- Run.  Then load the data with  db/seed.py  (see db/README.md).
--
-- Design: the train catalog, schedules and historical runs are real relational
-- tables (a judge can query them). The fitted model and the display metrics are
-- stored as JSONB blobs because they are genuinely opaque artifacts (coefficient
-- arrays, etc.). Live admin-entered delays live in live_trains and are the only
-- table the public web app is allowed to WRITE to.
-- ============================================================================

-- ---- tables ---------------------------------------------------------------
create table if not exists trains (
  train_no  text primary key,
  name      text not null,
  type      text not null
);

create table if not exists stations (
  train_no   text not null references trains(train_no) on delete cascade,
  seq        int  not null,
  code       text not null,
  name       text not null,
  km         int  not null,
  sched_arr  text,
  sched_dep  text,
  halt_min   int  default 0,
  primary key (train_no, seq)
);

create table if not exists runs (
  id                        bigint generated always as identity primary key,
  train_no                  text not null,
  run_date                  date not null,
  station_seq               int  not null,
  delay_min                 real,
  prev_station_delay_min    real,
  day_of_week               int,
  month                     int,
  section_congestion_idx    real,
  preceding_train_delay_min real,
  weather_flag              text,
  speed_restriction_km      real,
  sched_arr_epoch           bigint,
  actual_arr_epoch          bigint
);
create index if not exists runs_train_date_idx on runs (train_no, run_date, station_seq);

-- admin-entered / "running now" trains — the one writable table
create table if not exists live_trains (
  train_no                  text primary key,
  run_date                  text,
  last_reported_station_seq int,
  ref_seq                   int,
  current_delay_min         real,
  reported_at_epoch         bigint,
  ground_truth_date         text,
  actual_delay              jsonb,          -- {seq: delay} for the demo reveal
  source                    text default 'seed',
  updated_at                timestamptz default now()
);

-- fitted model + display metrics, as JSON blobs
create table if not exists model_artifacts (
  name        text primary key,             -- 'model' | 'metrics'
  data        jsonb not null,
  updated_at  timestamptz default now()
);

-- ---- row-level security ---------------------------------------------------
alter table trains          enable row level security;
alter table stations        enable row level security;
alter table runs            enable row level security;
alter table live_trains     enable row level security;
alter table model_artifacts enable row level security;

-- public READ everywhere (the app only needs to read the catalog/model)
drop policy if exists p_read on trains;          create policy p_read on trains          for select to anon, authenticated using (true);
drop policy if exists p_read on stations;        create policy p_read on stations        for select to anon, authenticated using (true);
drop policy if exists p_read on runs;            create policy p_read on runs            for select to anon, authenticated using (true);
drop policy if exists p_read on live_trains;     create policy p_read on live_trains     for select to anon, authenticated using (true);
drop policy if exists p_read on model_artifacts; create policy p_read on model_artifacts for select to anon, authenticated using (true);

-- public WRITE only to live_trains (a controller saving a delay). Demo-grade:
-- in production you would require an authenticated "controller" role instead.
drop policy if exists p_write_ins on live_trains;
create policy p_write_ins on live_trains for insert to anon, authenticated with check (true);
drop policy if exists p_write_upd on live_trains;
create policy p_write_upd on live_trains for update to anon, authenticated using (true) with check (true);

-- ---- table grants (PostgREST needs these in addition to RLS) --------------
grant usage on schema public to anon, authenticated;
grant select on trains, stations, runs, live_trains, model_artifacts to anon, authenticated;
grant insert, update on live_trains to anon, authenticated;
