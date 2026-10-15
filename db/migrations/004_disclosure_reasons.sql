-- Reasons for controlled-disclosure grants (sealed). The grant itself, with the reason's hash, lives on the ledger.
create table disclosure_reasons (
  grant_id uuid primary key,
  case_id text not null references cases on delete cascade,
  reason_enc bytea not null
);
create index on disclosure_reasons(case_id);
