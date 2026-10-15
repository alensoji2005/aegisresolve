-- Used only when LEDGER_MODE=postgres: the centralised-database baseline the blockchain is compared against.
create table central_state (key text primary key, value bytea not null);
create table central_history (id bigserial primary key, key text not null, tx_id text not null, ts timestamptz not null, value bytea not null);
create index on central_history(key, id);
create sequence central_tx_seq;
