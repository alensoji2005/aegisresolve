-- Explainable anomaly detection output (one row per family/subject/day).
create table anomalies (
  id uuid primary key default gen_random_uuid(),
  family text not null check (family in ('lifecycle', 'access', 'sensor')),
  subject text not null,        -- personnel pseudonym, staff username, or location id
  day date not null,
  score real not null,
  features jsonb not null,
  explanation jsonb not null,
  case_id text references cases,
  detected_at timestamptz not null default now(),
  unique (family, subject, day)
);
create index on anomalies(subject);
create index on anomalies(case_id);
create index on anomalies(day);
