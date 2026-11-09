import assert from 'node:assert/strict';
import { csvCell } from '../lib/csv-cell.ts';
import { allowsWrite } from '../lib/same-origin.ts';
import { summarize } from '../lib/risk.ts';

assert.equal(csvCell('=1+1'), '"\'=1+1"');
assert.equal(csvCell('+42'), '"\'+42"');
assert.equal(csvCell('safe'), '"safe"');

const cookieWrite = new Request('https://pilot.local/api/admin/review', {
  method: 'POST',
  headers: { cookie: 'CF_Authorization=token', 'cf-access-jwt-assertion': 'token' },
});
assert.equal(allowsWrite(cookieWrite), false);
const sameOrigin = new Request('https://pilot.local/api/admin/review', {
  method: 'POST',
  headers: { cookie: 'CF_Authorization=token', origin: 'https://pilot.local' },
});
assert.equal(allowsWrite(sameOrigin), true);
const bearer = new Request('https://pilot.local/api/admin/review', {
  method: 'POST',
  headers: { 'cf-access-jwt-assertion': 'token' },
});
assert.equal(allowsWrite(bearer), true);

const now = Date.parse('2026-01-01T00:00:00Z');
const hour = (index) => ({
  startTime: new Date(now + index * 3600000).toISOString(),
  endTime: new Date(now + (index + 1) * 3600000).toISOString(),
  temperature: 30,
  temperatureUnit: 'F',
  dewpoint: { value: -10 },
  relativeHumidity: { value: 40 },
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Clear',
  windSpeed: '10 mph',
  isDaytime: true,
});
const full = Array.from({ length: 48 }, (_, index) => hour(index));
assert.equal(summarize(full, [], now, 48).complete, true);
const gapped = full.filter((_, index) => index !== 10);
assert.equal(summarize(gapped, [], now, 48).complete, false);
console.log('Passed: CSV formula escaping, cookie CSRF, and a missing interior hour is incomplete.');
