import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { enforceIdentityLimit } from '../lib/api-access.ts';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { rateLimitPerMinute, SAFETY_RATE_LIMIT_PER_MINUTE } from '../lib/provider-policy.ts';

assert.equal(SAFETY_RATE_LIMIT_PER_MINUTE, 150);
assert.equal(rateLimitPerMinute({}).limit, 150);
assert.equal(rateLimitPerMinute({ OPERATOR_RATE_LIMIT_PER_MINUTE: '40' }).limit, 40);

function asD1(database) {
  return {
    prepare(statement) {
      return {
        bind(...params) {
          return {
            async run() {
              const result = database.prepare(statement).run(...params);
              return { meta: { changes: Number(result.changes) } };
            },
            async first() {
              return database.prepare(statement).get(...params) ?? null;
            },
            async all() {
              return { results: database.prepare(statement).all(...params) };
            },
          };
        },
      };
    },
  };
}

const sql = new DatabaseSync(':memory:');
await ensurePilotSchema({
  async exec(text) { sql.exec(text); },
  async run() { return { changes: 0 }; },
  async get() { return undefined; },
  async all() { return []; },
});
const database = asD1(sql);
assert.equal(await enforceIdentityLimit(database, 'operator-1', 1_700_000_000_000, 2), null);
assert.equal(await enforceIdentityLimit(database, 'operator-1', 1_700_000_000_000, 2), null);
const limited = await enforceIdentityLimit(database, 'operator-1', 1_700_000_000_000, 2);
assert.equal(limited?.status, 429);

const missing = asD1(new DatabaseSync(':memory:'));
const unavailable = await enforceIdentityLimit(missing, 'operator-1', 1_700_000_000_000, 150);
assert.equal(unavailable?.status, 503);
const body = await unavailable.json();
assert.equal(body.error, 'configuration_required');
console.log('Passed: the default identity limit is 150, a spent durable counter returns 429, and a missing rate table is 503.');
