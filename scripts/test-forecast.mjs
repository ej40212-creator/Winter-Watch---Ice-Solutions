import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { env } from 'cloudflare:workers';
import { ensurePilotSchema } from '../lib/pilot-schema.ts';
import { outlookCacheKey } from '../lib/cache-policy.ts';
import { forecast } from '../lib/weather.ts';

const sql = new DatabaseSync(':memory:');
await ensurePilotSchema({
  async exec(text) { sql.exec(text); },
  async run() { return { changes: 0 }; },
  async get() { return undefined; },
  async all() { return []; },
});
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
env.DB = asD1(sql);
env.PROVIDER_REFRESH = 'authorized';
env.PROVIDER_BUDGET = '20';

const now = Date.now();
const hourly = 'https://api.weather.gov/gridpoints/BOU/1,1/forecast/hourly';
const periods = [0, 1].map((hour) => ({
  startTime: new Date(now + hour * 3600000).toISOString(),
  endTime: new Date(now + (hour + 1) * 3600000).toISOString(),
  temperature: 30,
  temperatureUnit: 'F',
  dewpoint: { value: -10 },
  relativeHumidity: { value: 40 },
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Clear',
  windSpeed: '10 mph',
  isDaytime: true,
}));
const calls = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const target = String(url);
  calls.push(target);
  if (target.includes('geocoder')) {
    const lat = target.includes('North') ? 40 : 39;
    return new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: -105, y: lat }, addressComponents: { state: 'CO' }, matchedAddress: 'Example' }] } }), { status: 200 });
  }
  if (target.includes('/points/')) {
    return new Response(JSON.stringify({ properties: { forecastHourly: hourly, forecast: 'https://api.weather.gov/gridpoints/BOU/1,1/forecast', timeZone: 'America/Denver', gridId: 'BOU', gridX: 1, gridY: 1 } }), { status: 200 });
  }
  if (target.includes('alerts')) {
    const event = target.includes('39.0000,-105.0000') ? 'Ice Storm Warning' : 'Winter Weather Advisory';
    return new Response(JSON.stringify({ features: [{ properties: { status: 'Actual', messageType: 'Alert', event, onset: new Date(now + 3600000).toISOString(), expires: new Date(now + 5 * 3600000).toISOString() } }] }), { status: 200 });
  }
  if (target === hourly) {
    return new Response(JSON.stringify({ properties: { periods, updateTime: new Date(now).toISOString() } }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const sites = [
  { key: 'site-a', id: 'A', region: 'CO', address: 'South Campus, Example City, CO 80014', state: 'CO', classification: 'Event', demo: false },
  { key: 'site-b', id: 'B', region: 'CO', address: 'North Campus, Example City, CO 80014', state: 'CO', classification: 'Event', demo: false },
];
try {
  const first = await forecast('site-a', { allowLive: true, sites });
  const second = await forecast('site-b', { allowLive: true, sites });
  const cached = await forecast('site-a', { allowLive: true, sites });
  assert.equal(first.alerts[0].event, 'Ice Storm Warning');
  assert.equal(second.alerts[0].event, 'Winter Weather Advisory');
  assert.equal(calls.filter((url) => url === hourly).length, 1);
  const grid = sql.prepare("SELECT value FROM weather_cache WHERE key LIKE 'grid-forecast-v1:%'").get();
  assert.equal(String(grid.value).includes('Ice Storm'), false);
  assert.equal(cached.execution, 'cache');
  assert.equal(sql.prepare('SELECT key FROM weather_cache WHERE key = ?').get(outlookCacheKey('site-a')).key, outlookCacheKey('site-a'));
  const before = calls.length;
  await forecast('site-a', { allowLive: true, sites });
  assert.equal(calls.length, before);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Passed: forecast() shares one grid fetch across two sites and keeps their alerts apart.');
