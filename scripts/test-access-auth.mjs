import assert from 'node:assert/strict';
import { authenticate, loadAccessConfig, signAccessJwt, SYNTHETIC_AUDIENCE, SYNTHETIC_ISSUER } from '../lib/access-auth.ts';
import { guardRequest } from '../lib/request-guard.ts';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', publicKey);
const privateJwk = await crypto.subtle.exportKey('jwk', privateKey);
publicJwk.kid = privateJwk.kid = 'test-key';
publicJwk.alg = privateJwk.alg = 'RS256';
const env = {
  PILOT_SYNTHETIC_AUTH: '1',
  ACCESS_AUD: SYNTHETIC_AUDIENCE,
  ACCESS_ISSUER: SYNTHETIC_ISSUER,
  ACCESS_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
  ADMIN_EMAILS: 'admin@synthetic.winter-watch.invalid',
  ADMIN_GROUPS: 'winter-watch-admins',
};
const loaded = loadAccessConfig(env);
assert.equal(loaded.ok, true);
const config = loaded.config;
const now = Date.parse('2026-11-09T17:00:00Z');

async function token(extra = {}) {
  return signAccessJwt(privateJwk, {
    sub: 'operator-1',
    email: 'operator@synthetic.winter-watch.invalid',
    aud: SYNTHETIC_AUDIENCE,
    iss: SYNTHETIC_ISSUER,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
    ...extra,
  });
}

const missing = await authenticate(null, config, now);
assert.equal(missing.status, 401);
const forgedHeader = new Request('https://pilot.local/api/refresh', { headers: { 'oai-authenticated-user-id': 'forged-admin', 'cf-access-authenticated-user-email': 'admin@synthetic.winter-watch.invalid' } });
const forged = await guardRequest(forgedHeader, env, now);
assert.equal(forged?.status, 401);

const bad = await token();
const forgedSig = `${bad.slice(0, -4)}aaaa`;
assert.equal((await authenticate(forgedSig, config, now)).status, 401);
assert.equal((await authenticate(await token({ aud: 'other-app' }), config, now)).status, 401);
assert.equal((await authenticate(await token({ iss: 'https://evil.example' }), config, now)).status, 401);
assert.equal((await authenticate(await token({ exp: Math.floor(now / 1000) - 120 }), config, now)).status, 401);
const none = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/g, '')}.${btoa(JSON.stringify({ sub: 'x', email: 'a@b.c' })).replace(/=+$/g, '')}.`;
assert.equal((await authenticate(none, config, now)).status, 401);

const operator = await authenticate(await token(), config, now);
assert.equal(operator.ok && operator.identity.admin, false);
const admin = await authenticate(await token({ email: 'admin@synthetic.winter-watch.invalid', sub: 'admin-1' }), config, now);
assert.equal(admin.ok && admin.identity.admin, true);
const grouped = await authenticate(await token({ groups: ['winter-watch-admins'] }), config, now);
assert.equal(grouped.ok && grouped.identity.admin, true);

async function asRole(pathname, jwt) {
  return guardRequest(new Request(`https://pilot.local${pathname}`, { headers: { 'cf-access-jwt-assertion': jwt } }), env, now);
}
assert.equal((await asRole('/api/performance', await token()))?.status, 403);
assert.equal((await asRole('/mcp', await token()))?.status, 403);
assert.equal((await asRole('/api/refresh', await token()))?.status, 403);
assert.equal(await asRole('/api/performance', await token({ email: 'admin@synthetic.winter-watch.invalid', sub: 'admin-1' })), null);
assert.equal(await asRole('/', await token()), null);

const noPolicy = loadAccessConfig({ ...env, ADMIN_EMAILS: '', ADMIN_GROUPS: '' });
assert.equal(noPolicy.ok, true);
const closed = await guardRequest(new Request('https://pilot.local/api/admin/review', { headers: { 'cf-access-jwt-assertion': await token({ email: 'admin@synthetic.winter-watch.invalid', sub: 'admin-1' }) } }), { ...env, ADMIN_EMAILS: '', ADMIN_GROUPS: '' }, now);
assert.equal(closed?.status, 403);
const unconfigured = await guardRequest(new Request('https://pilot.local/'), {}, now);
assert.equal(unconfigured?.status, 503);
const mixed = loadAccessConfig({ PILOT_SYNTHETIC_AUTH: '1', ACCESS_ISSUER: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'real-aud', ACCESS_JWKS_JSON: env.ACCESS_JWKS_JSON });
assert.equal(mixed.ok, false);
assert.equal(mixed.status, 503);
console.log('Passed: forged and missing identity, wrong audience and issuer, expiry, unsigned alg, role denial, and fail-closed config.');
