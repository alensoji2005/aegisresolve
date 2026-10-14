/**
 * In-process Postgres (PGlite + pgvector) exposed over the wire protocol, so node-postgres works unchanged.
 * Used by tests and by the offline demo mode (no Docker). Single connection: fine for one API process.
 */
export async function startEmbeddedDb(port = 0): Promise<{ url: string; stop: () => Promise<void> }> {
  const [{ PGlite }, { citext }, { vector }, { PGLiteSocketServer }] = await Promise.all([
    import('@electric-sql/pglite'), import('@electric-sql/pglite/contrib/citext'), import('@electric-sql/pglite/vector'), import('@electric-sql/pglite-socket'),
  ]);
  const db = await PGlite.create({ extensions: { vector, citext } });
  const p = port || 20000 + Math.floor(Math.random() * 20000);
  const server = new PGLiteSocketServer({ db, port: p, host: '127.0.0.1' });
  await server.start();
  return { url: `postgres://postgres@127.0.0.1:${p}/postgres`, stop: async () => { await server.stop(); await db.close(); } };
}
