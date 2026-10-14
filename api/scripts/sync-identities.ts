/**
 * Re-reads each enrolled user's ledger identity via complaint:whoami and stores it in users.fabric_identity.
 * Fixes users created before identities were taken from the chaincode. Usage: pnpm --filter @aegis/api sync:identities
 */
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { FabricLedger } from '../src/ledger/fabricLedger.js';
import { openString } from '../src/crypto.js';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL);
const ledger = new FabricLedger(cfg);
const { rows } = await pool.query('select id, username, role, unit_id, depot_id, pseudo, fabric_identity, wallet_cert, wallet_key_enc from users where wallet_cert is not null');
let changed = 0;
for (const u of rows) {
  const who = await ledger.evaluate<{ id: string }>({
    userId: u.id, role: u.role, unit: u.unit_id, depot: u.depot_id, pseudo: u.pseudo,
    certPem: u.wallet_cert, keyPem: openString(u.wallet_key_enc, cfg.WALLET_KEK),
  }, 'complaint:whoami', []);
  if (who.id !== u.fabric_identity) {
    await pool.query('update users set fabric_identity = $2 where id = $1', [u.id, who.id]);
    changed++;
  }
}
console.log(`checked ${rows.length} users, updated ${changed}`);
ledger.close();
await pool.end();
