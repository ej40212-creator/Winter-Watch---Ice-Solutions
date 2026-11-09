import assert from 'node:assert/strict';
import { acceptGridForecast, buildOutlookRecord, planForecastFetches } from '../lib/cache-policy.ts';
import { fetchProviderJson } from '../lib/forecast-run.ts';

const now = Date.parse('2026-01-01T00:00:00Z');
const hourly = 'https://api.weather.gov/gridpoints/BOU/1,1/forecast/hourly';
const periods = [{
  startTime: new Date(now).toISOString(),
  endTime: new Date(now + 3600000).toISOString(),
  temperature: 30,
  temperatureUnit: 'F',
  dewpoint: { value: -10 },
  relativeHumidity: { value: 40 },
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Clear',
  windSpeed: '10 mph',
  isDaytime: true,
}];
const calls = [];
const fetchImpl = async (url) => {
  calls.push(url);
  if (String(url).includes('alerts')) {
    const event = String(url).includes('39.0000,-105.0000') ? 'Ice Storm Warning' : 'Winter Weather Advisory';
    return new Response(JSON.stringify({ features: [{ properties: { status: 'Actual', messageType: 'Alert', event, onset: new Date(now + 3600000).toISOString(), expires: new Date(now + 5 * 3600000).toISOString() } }] }), { status: 200 });
  }
  return new Response(JSON.stringify({ properties: { periods, updateTime: new Date(now).toISOString() } }), { status: 200 });
};
const planA = planForecastFetches(hourly, 39, -105);
const planB = planForecastFetches(hourly, 40, -105);
const grid = await fetchProviderJson({ url: hourly, allowLive: true, fetchImpl });
const stored = acceptGridForecast(planA.gridKey, grid);
const alertsA = await fetchProviderJson({ url: planA.alertUrl, allowLive: true, fetchImpl });
const alertsB = await fetchProviderJson({ url: planB.alertUrl, allowLive: true, fetchImpl });
const props = (body) => body.features.map((feature) => feature.properties);
const outlookA = buildOutlookRecord({ siteKey: 'a', grid: 'BOU/1,1', alertPoint: '39.0000,-105.0000', periods: grid.properties.periods, pointAlerts: props(alertsA), issued: grid.properties.updateTime, weatherOk: true, alertsOk: true, now });
const outlookB = buildOutlookRecord({ siteKey: 'b', grid: 'BOU/1,1', alertPoint: '40.0000,-105.0000', periods: grid.properties.periods, pointAlerts: props(alertsB), issued: grid.properties.updateTime, weatherOk: true, alertsOk: true, now });
assert.equal(planA.gridKey, planB.gridKey);
assert.notEqual(planA.alertUrl, planB.alertUrl);
assert.equal(JSON.stringify(stored.body).includes('Ice Storm'), false);
assert.equal(outlookA.alerts[0].event, 'Ice Storm Warning');
assert.equal(outlookB.alerts[0].event, 'Winter Weather Advisory');
assert.throws(() => acceptGridForecast(planA.gridKey, alertsA));
let fetches = 0;
await assert.rejects(fetchProviderJson({
  url: hourly,
  allowLive: true,
  fetchImpl: () => { fetches += 1; throw new DOMException('The operation was aborted.', 'AbortError'); },
}), /timed out/);
assert.equal(fetches, 2);
let charges = 0;
await assert.rejects(fetchProviderJson({
  url: hourly,
  allowLive: true,
  consume: async () => { charges += 1; return true; },
  fetchImpl: () => { throw new DOMException('The operation was aborted.', 'AbortError'); },
}), /timed out/);
assert.equal(charges, 2);
await assert.rejects(fetchProviderJson({
  url: hourly,
  allowLive: true,
  fetchImpl: async () => new Response('', { status: 429 }),
}), /rate limit/);
let consumed = false;
await assert.rejects(fetchProviderJson({ url: hourly, allowLive: true, consume: async () => false, fetchImpl: () => { consumed = true; return new Response('{}'); } }), /budget/);
assert.equal(consumed, false);
console.log('Passed: shared-grid fetch keeps alerts off the grid document, and timeout, 429, and budget refusal use the real fetch helper.');
