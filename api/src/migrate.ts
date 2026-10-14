import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool } from './db.js';

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

export async function migrate(pool: pg.Pool, dir = DEFAULT_DIR): Promise<string[]> {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(await readFile(path.join(dir, f), 'utf8'));
      await client.query('insert into schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
      applied.push(f);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const pool = createPool(process.env.DATABASE_URL!);
  migrate(pool).then((a) => { console.log('applied', a); return pool.end(); });
}
