create extension if not exists vector;
create extension if not exists citext;
create sequence case_seq;

create table users (
  id uuid primary key default gen_random_uuid(),
  username citext unique not null,
  password_hash text not null,
  totp_secret_enc bytea,
  totp_confirmed bool not null default false,
  role text not null check (role in ('COMPLAINANT','STORE_OFFICER','INVESTIGATOR','SAFETY_OFFICER','REVIEW_BOARD','AUDITOR','ADMIN','SYSTEM')),
  unit_id text not null,
  depot_id text not null default 'NONE',
  pseudo text unique,
  fabric_identity text unique,
  wallet_cert text,
  wallet_key_enc bytea,
  active bool not null default true,
  created_at timestamptz not null default now()
);

create table pseudonyms (
  pseudonym text primary key,
  user_id uuid not null references users,
  case_id text not null unique,
  created_at timestamptz not null default now()
);
create index on pseudonyms(user_id);

create table cases (
  case_id text primary key,
  pseudonym text not null,
  status text not null,
  category text,
  risk_level text,
  risk_score real,
  depot_id text not null,
  location_ref text not null,
  occurred_at timestamptz,
  investigator_user_id uuid references users,
  sla_due_at timestamptz,
  escalation_level int not null default 0,
  outcome text,
  triage_status text not null default 'PENDING' check (triage_status in ('PENDING','DONE','FAILED')),
  triage_attempts int not null default 0,
  ledger_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on cases(investigator_user_id);
create index on cases(status);
create index on cases(depot_id);

create table case_content (
  case_id text primary key references cases on delete cascade,
  title_enc bytea not null,
  description_enc bytea not null,
  content_sha256 text not null
);

create table case_ai (
  case_id text primary key references cases on delete cascade,
  category_probs jsonb,
  entities jsonb,
  risk_explanation jsonb,
  model_versions jsonb,
  result_sha256 text not null,
  embedding vector(384)
);
create index on case_ai using hnsw (embedding vector_cosine_ops);

create table case_links (
  case_id text not null references cases on delete cascade,
  linked_case_id text not null references cases on delete cascade,
  link_type text not null check (link_type in ('DUPLICATE','RELATED')),
  similarity real,
  reasons jsonb,
  confirmed_by uuid references users,
  primary key (case_id, linked_case_id)
);
create index on case_links(linked_case_id);
create index on case_links(confirmed_by);

create table evidence (
  id uuid primary key,
  case_id text not null references cases on delete cascade,
  object_key text not null,
  original_name_enc bytea not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256_plain text not null,
  sha3_plain text not null,
  sha256_cipher text not null,
  dek_wrapped bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  uploaded_by uuid not null references users,
  ledger_tx_id text,
  created_at timestamptz not null default now()
);
create index on evidence(case_id);
create index on evidence(uploaded_by);

create table findings (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references cases on delete cascade,
  author uuid not null references users,
  body_enc bytea not null,
  body_sha256 text not null,
  outcome text not null,
  ledger_tx_id text,
  created_at timestamptz not null default now()
);
create index on findings(case_id);
create index on findings(author);

create table appeals (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references cases on delete cascade,
  reason_enc bytea not null,
  status text not null default 'FILED',
  ledger_tx_id text,
  created_at timestamptz not null default now()
);
create index on appeals(case_id);

create table depots (id text primary key, name text not null);

create table locations (
  id text primary key,
  depot_id text not null references depots,
  temp_min real not null,
  temp_max real not null,
  rh_max real not null
);
create index on locations(depot_id);

create table assets (
  id text primary key,
  item_type text not null,
  quantity int not null,
  manufactured_on date not null,
  shelf_life_months int not null,
  current_location text references locations,
  status text not null default 'IN_STORE'
);
create index on assets(current_location);

create table personnel (pseudo_id text primary key, unit_id text not null, depot_id text not null);

create table lifecycle_events (
  id text primary key,
  asset_id text not null references assets,
  event_type text not null,
  from_location text,
  to_location text,
  quantity int not null,
  actor_pseudo text not null,
  actor_unit text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',
  ledger_tx_id text
);
create index on lifecycle_events(asset_id, occurred_at);

create table sensor_readings (
  location_id text not null references locations,
  ts timestamptz not null,
  temp_c real not null,
  rh_pct real not null,
  primary key (location_id, ts)
);

create table access_events (
  id bigserial primary key,
  user_id uuid references users,
  action text not null,
  resource text not null,
  at timestamptz not null default now(),
  ledger_tx_id text
);
create index on access_events(user_id);
