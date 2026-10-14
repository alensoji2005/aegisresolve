import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import FabricCAServices from 'fabric-ca-client';
import { User } from 'fabric-common';
import type { Role } from '../../../chaincode/aegis-cc/src/types.js';
import type { Config } from '../config.js';
import { orgFor, orgInfo, type OrgKey } from './fabricOrgs.js';

const ATTRS = ['role', 'unit', 'depot', 'pseudo'] as const;
const registrars = new Map<OrgKey, Promise<{ ca: FabricCAServices; admin: User }>>();

function caFor(cfg: Config, key: OrgKey) {
  let p = registrars.get(key);
  if (!p) {
    p = (async () => {
      const o = orgInfo(cfg, key);
      // Dev network: CA TLS uses the test-network self-signed cert whose hostname is not localhost.
      const ca = new FabricCAServices(o.caUrl, { trustedRoots: [readFileSync(o.caCertPath, 'utf8')], verify: false }, o.caName);
      const e = await ca.enroll({ enrollmentID: cfg.FABRIC_CA_ADMIN, enrollmentSecret: cfg.FABRIC_CA_ADMIN_PW });
      const admin = User.createUser(cfg.FABRIC_CA_ADMIN, cfg.FABRIC_CA_ADMIN_PW, o.mspId, e.certificate, e.key.toBytes());
      return { ca, admin };
    })();
    p.catch(() => registrars.delete(key));
    registrars.set(key, p);
  }
  return p;
}

/** The string fabric-shim's ClientIdentity.getID() produces: x509::<subject>::<issuer>, RDNs as /K=V in certificate order. */
export function fabricIdFromCert(certPem: string): string {
  const c = new X509Certificate(certPem);
  const dn = (s: string) => '/' + s.split('\n').filter(Boolean).join('/');
  return `x509::${dn(c.subject)}::${dn(c.issuer)}`;
}

export async function enrollUser(cfg: Config, u: { username: string; role: Role; unit: string; depot: string; pseudo: string }) {
  const key = orgFor(u.role);
  const o = orgInfo(cfg, key);
  const { ca, admin } = await caFor(cfg, key);
  const values: Record<(typeof ATTRS)[number], string> = { role: u.role, unit: u.unit, depot: u.depot, pseudo: u.pseudo };
  const secret = await ca.register({
    enrollmentID: u.username, role: 'client', affiliation: o.affiliation, maxEnrollments: -1,
    attrs: ATTRS.map((name) => ({ name, value: values[name], ecert: true })),
  }, admin);
  const e = await ca.enroll({ enrollmentID: u.username, enrollmentSecret: secret, attr_reqs: ATTRS.map((name) => ({ name, optional: false })) });
  return { certPem: e.certificate, keyPem: e.key.toBytes(), fabricId: fabricIdFromCert(e.certificate), mspId: o.mspId };
}
