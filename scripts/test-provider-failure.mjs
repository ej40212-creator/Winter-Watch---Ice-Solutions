import assert from 'node:assert/strict';
import { buildFailureRecord, buildOutlookRecord, providerFailureMessage } from '../lib/cache-policy.ts';

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
const alertsOnly = buildOutlookRecord({
  siteKey: 'site-d',
  grid: 'BOU/1,1',
  alertPoint: '39.0000,-104.0000',
  periods: [{ startTime: new Date(now).toISOString(), endTime: new Date(now + 3600000).toISOString(), temperature: 30, temperatureUnit: 'F', dewpoint: { value: -10 }, relativeHumidity: { value: 40 }, probabilityOfPrecipitation: { value: 0 }, shortForecast: 'Clear', windSpeed: '10 mph', isDaytime: true }],
  pointAlerts: [],
  issued: new Date(now).toISOString(),
  weatherOk: true,
  alertsOk: false,
  now,
});
assert.equal(alertsOnly.status, 'partial');
assert.equal(alertsOnly.error, 'NWS alert check unavailable.');
assert.equal(providerFailureMessage({ aborted: true }).includes('timed out'), true);
assert.equal(providerFailureMessage({ status: 429 }).includes('rate limit'), true);
console.log('Passed: provider failure, stale issue time, alerts-only partial, timeout, and 429 states do not invent a clear reading.');
