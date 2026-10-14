import path from 'node:path';
import os from 'node:os';
import type { Role } from '../../../chaincode/aegis-cc/src/types.js';
import type { Config } from '../config.js';

export type OrgKey = 'org1' | 'org2';

export interface OrgInfo {
  key: OrgKey;
  mspId: 'Org1MSP' | 'Org2MSP';
  peerEndpoint: string;
  peerHostAlias: string;
  peerTlsCertPath: string;
  caUrl: string;
  caName: string;
  caCertPath: string;
  affiliation: string;
}

export function orgFor(role: Role): OrgKey {
  return role === 'COMPLAINANT' || role === 'STORE_OFFICER' ? 'org1' : 'org2';
}

export function orgInfo(cfg: Config, key: OrgKey): OrgInfo {
  const base = (cfg.FABRIC_ORGS_DIR || path.join(os.homedir(), 'fabric-samples/test-network/organizations')).replace(/^~/, os.homedir());
  const domain = `${key}.example.com`;
  return {
    key,
    mspId: key === 'org1' ? 'Org1MSP' : 'Org2MSP',
    peerEndpoint: key === 'org1' ? cfg.FABRIC_ORG1_PEER : cfg.FABRIC_ORG2_PEER,
    peerHostAlias: `peer0.${domain}`,
    peerTlsCertPath: path.join(base, 'peerOrganizations', domain, 'peers', `peer0.${domain}`, 'tls', 'ca.crt'),
    caUrl: key === 'org1' ? cfg.FABRIC_ORG1_CA : cfg.FABRIC_ORG2_CA,
    caName: `ca-${key}`,
    caCertPath: path.join(base, 'fabric-ca', key, 'ca-cert.pem'),
    affiliation: `${key}.department1`,
  };
}
