import pg from 'pg';
import { startEmbeddedDb } from '../src/embeddedDb.js';

/** Test database: TEST_DATABASE_URL (real Postgres) when set, otherwise an in-process PGlite. */
export async function testPool(): Promise<{ pool: pg.Pool; stop: () => Promise<void> }> {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    await pool.query('drop schema public cascade; create schema public');
    return { pool, stop: () => pool.end() };
  }
  const db = await startEmbeddedDb();
  const pool = new pg.Pool({ connectionString: db.url, max: 1 });
  return { pool, stop: async () => { await pool.end(); await db.stop(); } };
}
