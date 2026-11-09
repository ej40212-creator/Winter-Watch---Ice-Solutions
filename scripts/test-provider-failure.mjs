import assert from 'node:assert/strict';
import { buildFailureRecord, buildOutlookRecord } from '../lib/cache-policy.ts';

const now = Date.parse('2026-01-01T00:00:00Z');
const address = buildFailureRecord({ siteKey: 'site-a', sourceAddress: '1 Main', error: 'Address could not be matched; location needs review.', now });
assert.equal(address.failureKind, 'address');
assert.equal(address.status, 'error');
assert.equal(address.minTemp, null);
assert.ok(address.nextRetry > now);
const stale = buildOutlookRecord({
  siteKey: 'site-b',
  grid: 'BOU/1,1',
  alertPoint: '39.0000,-104.0000',
  periods: [],
  pointAlerts: [],
  issued: new Date(now - 13 * 3600000).toISOString(),
  weatherOk: true,
  alertsOk: true,
  now,
});
assert.equal(stale.status, 'stale');
assert.equal(stale.complete, false);
const partial = buildOutlookRecord({
  siteKey: 'site-c',
  grid: 'BOU/1,1',
  alertPoint: '39.0000,-104.0000',
  periods: [],
  pointAlerts: [],
  issued: null,
  weatherOk: false,
  alertsOk: false,
  now,
});
assert.equal(partial.status, 'partial');
assert.equal(partial.error, 'Hourly forecast unavailable.');
assert.equal(partial.alertsChecked, false);
console.log('Passed: provider failure, stale issue time, and partial forecast states do not invent a clear reading.');
