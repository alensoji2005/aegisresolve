import { afterAll, it, expect } from 'vitest';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const pool = createPool(process.env.TEST_DATABASE_URL ?? 'postgres://aegis:aegis@localhost:5432/aegis_test');
afterAll(() => pool.end());

it('applies 001_init and is idempotent', async () => {
  await pool.query('drop schema public cascade; create schema public');
  expect(await migrate(pool)).toEqual(['001_init.sql']);
  expect(await migrate(pool)).toEqual([]);
  const { rows } = await pool.query(`select extname from pg_extension where extname='vector'`);
  expect(rows).toHaveLength(1);
});
