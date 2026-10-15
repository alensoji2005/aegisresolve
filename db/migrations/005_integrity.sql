-- Tamper response: quarantined evidence is never served again; every detection and repair is recorded.
alter table evidence add column quarantined_at timestamptz;

create table integrity_incidents (
  id bigserial primary key,
  kind text not null check (kind in ('CASE_FIELD', 'CONTENT', 'EVIDENCE', 'MISSING_ON_LEDGER')),
  case_id text not null,
  evidence_id uuid,
  detail jsonb not null,
  action text not null check (action in ('REPAIRED_FROM_LEDGER', 'CONTENT_WITHHELD', 'QUARANTINED', 'FLAGGED')),
  detected_by text not null,
  detected_at timestamptz not null default now()
);
create index on integrity_incidents(case_id);
create index on integrity_incidents(detected_at);
