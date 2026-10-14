import { z } from 'zod';

const b64 = (name: string, bytes: number) =>
  z.string({ required_error: `${name} is required` }).transform((s, ctx) => {
    const buf = Buffer.from(s, 'base64');
    if (buf.length !== bytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be ${bytes} bytes base64 (got ${buf.length})` });
      return z.NEVER;
    }
    return buf;
  });

const schema = z.object({
  DATABASE_URL: z.string().url(),
  /** When set, evidence ciphertext is stored on disk here instead of S3/MinIO. */
  BLOB_DIR: z.string().optional(),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_BUCKET: z.string().default('aegis-evidence'),
  S3_ACCESS_KEY: z.string().default('aegis'),
  S3_SECRET_KEY: z.string().default('aegis-secret'),
  AEGIS_KEK: b64('AEGIS_KEK', 32),
  PSEUDONYM_SECRET: b64('PSEUDONYM_SECRET', 32),
  JWT_SECRET: b64('JWT_SECRET', 64),
  WALLET_KEK: b64('WALLET_KEK', 32),
  LEDGER_MODE: z.enum(['fabric', 'fake']).default('fabric'),
  FABRIC_CHANNEL: z.string().default('aegischannel'),
  FABRIC_CHAINCODE: z.string().default('aegis-cc'),
  FABRIC_ORGS_DIR: z.string().default(''),
  FABRIC_ORG1_PEER: z.string().default('localhost:7051'),
  FABRIC_ORG2_PEER: z.string().default('localhost:9051'),
  FABRIC_ORG1_CA: z.string().default('https://localhost:7054'),
  FABRIC_ORG2_CA: z.string().default('https://localhost:8054'),
  FABRIC_CA_ADMIN: z.string().default('admin'),
  FABRIC_CA_ADMIN_PW: z.string().default('adminpw'),
  AI_SERVICE_URL: z.string().url().default('http://localhost:8001'),
  AI_SHARED_SECRET: z.string().default(''),
  PORT: z.coerce.number().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) throw new Error('Invalid config: ' + r.error.issues.map((i) => i.message || i.path.join('.')).join('; '));
  return r.data;
}
