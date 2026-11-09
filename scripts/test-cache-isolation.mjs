import assert from 'node:assert/strict';
import { buildOutlookRecord, gridCacheKey, pointAlertCacheKey, sharedCacheAllows } from '../lib/cache-policy.ts';

const now = Date.parse('2026-01-01T00:00:00Z');
const periods = Array.from({ length: 48 }, (_, index) => ({
  startTime: new Date(now + index * 3600000).toISOString(),
  endTime: new Date(now + (index + 1) * 3600000).toISOString(),
  temperature: 30,
  temperatureUnit: 'F',
  dewpoint: { value: -20 },
  relativeHumidity: { value: 40 },
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Clear',
  windSpeed: '10 mph',
  isDaytime: true,
}));
const gridUrl = 'https://api.weather.gov/gridpoints/BOU/1,1/forecast/hourly';
const gridBody = { properties: { periods, updateTime: new Date(now).toISOString() } };
assert.equal(sharedCacheAllows(gridCacheKey(gridUrl), gridBody), true);
assert.equal(sharedCacheAllows(gridCacheKey(gridUrl), { features: [{ properties: { event: 'Ice Storm Warning' } }] }), false);
const alertA = [{ status: 'Actual', messageType: 'Alert', event: 'Ice Storm Warning', onset: new Date(now + 3600000).toISOString(), expires: new Date(now + 5 * 3600000).toISOString() }];
const shared = buildOutlookRecord({ siteKey: 'site-a', grid: 'BOU/1,1', alertPoint: '39.0000,-105.0000', periods, pointAlerts: alertA, issued: new Date(now).toISOString(), weatherOk: true, alertsOk: true, now });
const quiet = buildOutlookRecord({ siteKey: 'site-b', grid: 'BOU/1,1', alertPoint: '40.0000,-105.0000', periods, pointAlerts: [], issued: new Date(now).toISOString(), weatherOk: true, alertsOk: true, now });
assert.equal(shared.grid, quiet.grid);
assert.equal(shared.alerts.length, 1);
assert.equal(quiet.alerts.length, 0);
assert.notEqual(shared.alertPoint, quiet.alertPoint);
assert.equal(pointAlertCacheKey(39, -105), 'point-alerts-v1:39.0000,-105.0000');
assert.ok(!JSON.stringify(gridBody).includes('Ice Storm'));
console.log('Passed: shared grid forecast does not carry another site’s point alerts.');
