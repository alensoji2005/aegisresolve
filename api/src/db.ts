import pg from 'pg';

/**
 * writerToken: the secret that tells the database tamper guard (migration 006) that a connection is the application.
 * It is set on every pooled connection; sessions without it (e.g. someone in psql) cannot change protected rows.
 */
export function createPool(url: string, writerToken?: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  if (writerToken) pool.on('connect', (client) => { void client.query(`select set_config('aegis.writer', $1, false)`, [writerToken]); });
  return pool;
}

/**
 * Activates the tamper guard by registering the hash of the application's token on first start; afterwards refuses to
 * start with a different token (otherwise every write would be silently discarded as tampering).
 */
export async function registerWriterToken(pool: pg.Pool, token: string | undefined): Promise<'registered' | 'verified' | 'disabled'> {
  if (!token) return 'disabled';
  const { rows } = await pool.query(`select token_hash = sha256(convert_to($1, 'UTF8')) as ok from integrity_config`, [token]);
  if (!rows.length) {
    await pool.query(`insert into integrity_config(token_hash) values (sha256(convert_to($1, 'UTF8')))`, [token]);
    return 'registered';
  }
  if (!rows[0].ok) throw new Error('DB_WRITE_TOKEN does not match the token registered in the database (integrity_config)');
  return 'verified';
}
