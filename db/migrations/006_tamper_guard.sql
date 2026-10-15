-- Database-level tamper guard.
-- The application proves it is the application by setting a secret session token (aegis.writer); only its hash is stored here.
-- Any other INSERT/UPDATE/DELETE on a protected table appears to run, but the row is kept as it was and the attempt
-- (old row, attempted row, who, from where, the SQL text) is written to tamper_attempts instead.
-- Until a token is registered (integrity_config empty) the guard is inactive, e.g. in tests and the offline demo.

create table integrity_config (token_hash bytea not null);

create table tamper_attempts (
  id bigserial primary key,
  table_name text not null,
  operation text not null,
  row_key text,
  old_row jsonb,
  attempted_row jsonb,
  db_user text not null,
  client_addr inet,
  application_name text,
  query text,
  attempted_at timestamptz not null default clock_timestamp()
);
create index on tamper_attempts(row_key);
create index on tamper_attempts(attempted_at);

create function aegis_writer_authorised() returns boolean language sql stable as $$
  select not exists (select 1 from integrity_config)
      or exists (select 1 from integrity_config
                 where token_hash = sha256(convert_to(coalesce(current_setting('aegis.writer', true), ''), 'UTF8')));
$$;

create function aegis_guard() returns trigger language plpgsql as $$
declare
  old_j jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  new_j jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  append_only boolean := TG_NARGS > 0 and TG_ARGV[0] = 'append_only';
begin
  if not append_only and aegis_writer_authorised() then
    return case when TG_OP = 'DELETE' then OLD else NEW end;
  end if;
  insert into tamper_attempts(table_name, operation, row_key, old_row, attempted_row, db_user, client_addr, application_name, query)
  values (TG_TABLE_NAME, TG_OP,
          coalesce(old_j->>'case_id', new_j->>'case_id', old_j->>'resource', new_j->>'resource', old_j->>'username', new_j->>'username',
                   old_j->>'id', new_j->>'id'),
          old_j, new_j, session_user, inet_client_addr(), current_setting('application_name', true), current_query());
  -- UPDATE: write the old values back (the statement still reports success); INSERT/DELETE: skip the row.
  if TG_OP = 'UPDATE' then return OLD; end if;
  return null;
end $$;

create function aegis_block_truncate() returns trigger language plpgsql as $$
begin
  if aegis_writer_authorised() then return null; end if;
  raise exception 'TRUNCATE on % is not permitted', TG_TABLE_NAME;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cases','case_content','evidence','findings','appeals','pseudonyms','users','case_ai','case_links',
                           'access_events','integrity_incidents','disclosure_reasons','lifecycle_events','integrity_config'] loop
    execute format('create trigger aegis_guard before insert or update or delete on %I for each row execute function aegis_guard()', t);
    execute format('create trigger aegis_no_truncate before truncate on %I for each statement execute function aegis_block_truncate()', t);
  end loop;
end $$;

-- The attempts log itself can only grow: nobody (not even the application) may edit or delete it.
create trigger aegis_guard before update or delete on tamper_attempts for each row execute function aegis_guard('append_only');
create function aegis_block_truncate_always() returns trigger language plpgsql as $$
begin
  raise exception 'TRUNCATE on % is not permitted', TG_TABLE_NAME;
end $$;
create trigger aegis_no_truncate before truncate on tamper_attempts for each statement execute function aegis_block_truncate_always();
