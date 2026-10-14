import type { Role } from '../../../chaincode/aegis-cc/src/types.js';
import type { AppDeps } from '../app.js';
import { createUser } from '../users/service.js';

export interface SeedCredential { username: string; role: Role; password: string; totpSecret: string }

/** Demo cast. inv3 is based at DEP-02 so assigning them to a DEP-02 case trips COI rule R4. */
export const SEED_USERS: { username: string; role: Role; unit: string; depot: string; pseudo: string }[] = [
  { username: 'comp1', role: 'COMPLAINANT', unit: 'U1', depot: 'DEP-01', pseudo: 'PER-301' },
  { username: 'comp2', role: 'COMPLAINANT', unit: 'U2', depot: 'DEP-02', pseudo: 'PER-302' },
  { username: 'store1', role: 'STORE_OFFICER', unit: 'U1', depot: 'DEP-01', pseudo: 'PER-303' },
  { username: 'store2', role: 'STORE_OFFICER', unit: 'U3', depot: 'DEP-02', pseudo: 'PER-304' },
  { username: 'inv1', role: 'INVESTIGATOR', unit: 'U4', depot: 'NONE', pseudo: 'PER-201' },
  { username: 'inv2', role: 'INVESTIGATOR', unit: 'U5', depot: 'NONE', pseudo: 'PER-202' },
  { username: 'inv3', role: 'INVESTIGATOR', unit: 'U1', depot: 'DEP-02', pseudo: 'PER-203' },
  { username: 'safety1', role: 'SAFETY_OFFICER', unit: 'U5', depot: 'NONE', pseudo: 'PER-204' },
  { username: 'board1', role: 'REVIEW_BOARD', unit: 'U6', depot: 'NONE', pseudo: 'PER-205' },
  { username: 'board2', role: 'REVIEW_BOARD', unit: 'U6', depot: 'NONE', pseudo: 'PER-206' },
  { username: 'board3', role: 'REVIEW_BOARD', unit: 'U6', depot: 'NONE', pseudo: 'PER-207' },
  { username: 'audit1', role: 'AUDITOR', unit: 'U6', depot: 'NONE', pseudo: 'PER-208' },
  { username: 'admin1', role: 'ADMIN', unit: 'U6', depot: 'NONE', pseudo: 'PER-209' },
  { username: 'system', role: 'SYSTEM', unit: 'U6', depot: 'NONE', pseudo: 'PER-210' },
];

export async function seedUsers(deps: AppDeps): Promise<SeedCredential[]> {
  const out: SeedCredential[] = [];
  for (const u of SEED_USERS) {
    const { password, totpSecret } = await createUser(deps, { ...u, totpConfirmed: true });
    out.push({ username: u.username, role: u.role, password, totpSecret });
  }
  return out;
}
