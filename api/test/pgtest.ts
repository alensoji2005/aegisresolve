import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { vector } from '@electric-sql/pglite/vector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';

/**
 * Test database. Uses TEST_DATABASE_URL (real Postgres) when set; otherwise an
 * in-process PGlite (Postgres + pgvector) behind a socket so node-postgres works unchanged.
 */
export async function testPool(): Promise<{ pool: pg.Pool; stop: () => Promise<void> }> {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    await pool.query('drop schema public cascade; create schema public');
    return { pool, stop: () => pool.end() };
  }
  const db = await PGlite.create({ extensions: { vector, citext } });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1 });
  return { pool, stop: async () => { await pool.end(); await server.stop(); await db.close(); } };
}
