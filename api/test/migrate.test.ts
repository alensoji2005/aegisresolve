import { afterAll, beforeAll, expect, it } from 'vitest';
import type pg from 'pg';
import { migrate } from '../src/migrate.js';
import { testPool } from './pgtest.js';

let pool: pg.Pool;
let stop: () => Promise<void>;
beforeAll(async () => ({ pool, stop } = await testPool()));
afterAll(() => stop());

it('applies 001_init and is idempotent', async () => {
  expect((await migrate(pool))[0]).toBe('001_init.sql');
  expect(await migrate(pool)).toEqual([]);
  const { rows } = await pool.query(`select extname from pg_extension where extname='vector'`);
  expect(rows).toHaveLength(1);
});
