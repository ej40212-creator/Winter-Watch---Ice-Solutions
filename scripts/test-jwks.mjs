import assert from 'node:assert/strict';
import { authenticate, loadAccessConfig, resetJwksCache, signAccessJwt } from '../lib/access-auth.ts';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', publicKey);
const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
publicJwk.kid = privateJwk.kid = 'rotated';
publicJwk.alg = privateJwk.alg = 'RS256';
publicJwk.use = 'sig';
const now = Date.parse('2026-11-09T18:00:00Z');
const env = {
  ACCESS_AUD: 'aud',
  ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_JWKS_JSON: JSON.stringify({ keys: [{ ...publicJwk, kid: 'stale' }] }),
};
const loaded = loadAccessConfig(env, { devBuild: false });
assert.equal(loaded.ok, true);
assert.equal(loaded.config.jwks.keys.length, 0);
assert.match(loaded.config.jwksUrl, /cdn-cgi\/access\/certs$/);
const token = await signAccessJwt(privateJwk, {
  sub: 'operator-1',
  email: 'operator@example.com',
  aud: 'aud',
  iss: 'https://team.cloudflareaccess.com',
  iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 600,
});
let fetches = 0;
resetJwksCache();
const rotating = async () => {
  fetches += 1;
  const kid = fetches === 1 ? 'old' : 'rotated';
  return { ok: true, json: async () => ({ keys: [{ ...publicJwk, kid }] }) };
};
const first = await authenticate(token, loaded.config, now, rotating);
assert.equal(first.ok, true);
assert.equal(fetches, 2);
fetches = 0;
const cached = await authenticate(token, loaded.config, now, rotating);
assert.equal(cached.ok, true);
assert.equal(fetches, 0);
resetJwksCache();
const hanging = (_url, init) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
});
const timedOut = await authenticate(token, loaded.config, now, hanging);
assert.equal(timedOut.ok, false);
assert.equal(timedOut.status, 401);
const noKid = token.split('.');
const header = JSON.parse(Buffer.from(noKid[0], 'base64url').toString());
delete header.kid;
noKid[0] = Buffer.from(JSON.stringify(header)).toString('base64url');
const missingKid = await authenticate(noKid.join('.'), loaded.config, now, rotating);
assert.equal(missingKid.ok, false);
console.log('Passed: JWKS URL wins over static JSON, unknown kid refetches once, cache TTL skips a second fetch, timeout fails closed, and kid is required.');
