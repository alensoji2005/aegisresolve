import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ROLES, type Role } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { hashPassword, newTotpSecret } from '../auth/credentials.js';
import { openString, sealString } from '../crypto.js';
import { notFound } from '../errors.js';
import { fakeIdentityOf } from '../ledger/ledger.js';
import type { LedgerUser } from '../ledger/ledger.js';

export const newUserSchema = z.object({
  username: z.string().regex(/^[a-z0-9_.-]{3,40}$/),
  role: z.enum(ROLES as [Role, ...Role[]]),
  unit: z.string().regex(/^U\d{1,3}$/),
  depot: z.string().regex(/^(DEP-\d{2}|NONE)$/).default('NONE'),
  pseudo: z.string().regex(/^PER-\d{3}$/).optional(),
});
export type NewUser = z.input<typeof newUserSchema> & { password?: string; totpSecret?: string; totpConfirmed?: boolean };

export async function createUser(deps: AppDeps, input: NewUser): Promise<{ id: string; password: string; totpSecret: string }> {
  const u = newUserSchema.parse(input);
  const id = randomUUID();
  const password = input.password ?? randomBytes(12).toString('base64url');
  const totpSecret = input.totpSecret ?? newTotpSecret();
  const pseudo = u.pseudo ?? `PER-${randomBytes(3).toString('hex')}`;
  let fabricId = fakeIdentityOf(id);
  let cert: string | null = null;
  let keyEnc: Buffer | null = null;
  if (deps.cfg.LEDGER_MODE === 'fabric') {
    const { enrollUser } = await import('../ledger/identity.js');
    const e = await enrollUser(deps.cfg, { username: u.username, role: u.role, unit: u.unit, depot: u.depot, pseudo });
    // Ask the chaincode for the id it will see for this certificate, rather than re-deriving Fabric's DN formatting.
    const who = await deps.ledger.evaluate<{ id: string }>(
      { userId: id, role: u.role, unit: u.unit, depot: u.depot, pseudo, certPem: e.certPem, keyPem: e.keyPem }, 'complaint:whoami', []);
    fabricId = who.id;
    cert = e.certPem;
    keyEnc = sealString(e.keyPem, deps.cfg.WALLET_KEK);
  }
  await deps.pool.query(
    `insert into users(id, username, password_hash, totp_secret_enc, totp_confirmed, role, unit_id, depot_id, pseudo, fabric_identity, wallet_cert, wallet_key_enc)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, u.username, await hashPassword(password), sealString(totpSecret, deps.cfg.AEGIS_KEK), input.totpConfirmed ?? false,
      u.role, u.unit, u.depot, pseudo, fabricId, cert, keyEnc],
  );
  return { id, password, totpSecret };
}

export async function loadLedgerUser(deps: AppDeps, userId: string): Promise<LedgerUser> {
  const { rows } = await deps.pool.query('select * from users where id = $1 and active', [userId]);
  if (!rows[0]) throw notFound('user');
  const r = rows[0];
  return {
    userId: r.id, role: r.role, unit: r.unit_id, depot: r.depot_id, pseudo: r.pseudo ?? '',
    mspId: ['COMPLAINANT', 'STORE_OFFICER'].includes(r.role) ? 'Org1MSP' : 'Org2MSP',
    certPem: r.wallet_cert ?? undefined,
    keyPem: r.wallet_key_enc ? openString(r.wallet_key_enc, deps.cfg.WALLET_KEK) : undefined,
  };
}

export async function systemUser(deps: AppDeps): Promise<LedgerUser> {
  const { rows } = await deps.pool.query(`select id from users where username = 'system'`);
  if (!rows[0]) throw new Error('system user missing: run the seed');
  return loadLedgerUser(deps, rows[0].id);
}

/** Maps a ledger certificate id back to the app user id. */
export async function userIdForFabricId(deps: AppDeps, fabricId: string | null | undefined): Promise<string | null> {
  if (!fabricId) return null;
  const { rows } = await deps.pool.query('select id from users where fabric_identity = $1', [fabricId]);
  return rows[0]?.id ?? null;
}
