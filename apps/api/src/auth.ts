import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK, type CryptoKey } from 'jose';

/**
 * DURCHSTICH: Simple token service. Real login (Better Auth, invitations, one-time links) comes later.
 * The same JWT authenticates against our API and against the PowerSync service (audience 'powersync').
 */
const KEY_FILE = fileURLToPath(new URL('../../../storage/keys/jwt-dev.json', import.meta.url));
const ALG = 'ES256';
const KID = 'bap-dev-1';
const AUDIENCE = ['powersync', 'bap-api'];
const ISSUER = 'bau-akte-pro';

let privateKey: CryptoKey;
let publicJwk: JWK;

export async function initKeys() {
  try {
    const stored = JSON.parse(await readFile(KEY_FILE, 'utf8')) as { priv: JWK; pub: JWK };
    privateKey = (await importJWK(stored.priv, ALG)) as CryptoKey;
    publicJwk = stored.pub;
  } catch {
    const pair = await generateKeyPair(ALG, { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: ALG, use: 'sig' };
    await mkdir(fileURLToPath(new URL('.', `file://${KEY_FILE}`)), { recursive: true });
    await writeFile(KEY_FILE, JSON.stringify({ priv: await exportJWK(pair.privateKey), pub: publicJwk }));
  }
}

export const jwks = () => ({ keys: [publicJwk] });

export async function issueToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(privateKey);
}

export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, (await importJWK(publicJwk, ALG)) as CryptoKey, {
    issuer: ISSUER,
    audience: 'bap-api',
  });
  if (!payload.sub) throw new Error('no subject');
  return payload.sub;
}
