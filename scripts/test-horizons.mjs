import assert from 'node:assert/strict';
import { summarize } from '../lib/risk.ts';

const now = Date.parse('2026-01-01T00:00:00Z');
const periods = Array.from({ length: 169 }, (_, index) => ({
  startTime: new Date(now + index * 3600000).toISOString(),
  endTime: new Date(now + (index + 1) * 3600000).toISOString(),
  temperature: 40,
  temperatureUnit: 'F',
  dewpoint: { value: -10 },
  relativeHumidity: { value: 30 },
  probabilityOfPrecipitation: { value: 0 },
  shortForecast: 'Clear',
  windSpeed: '10 mph',
  isDaytime: true,
}));
periods[24].shortForecast = 'Snow';
periods[48].shortForecast = 'Freezing Rain';
periods[72].shortForecast = 'Snow';
assert.equal(summarize(periods, [], now, 24).priority, 0);
assert.equal(summarize(periods, [], now, 48).priority, 2);
assert.equal(summarize(periods, [], now, 72).priority, 3);
assert.equal(summarize(periods, [], now, 168).priority, 3);
assert.equal(summarize(periods, [], now, 24).hours.length, 24);
assert.equal(summarize(periods, [], now, 48).hours.length, 48);
assert.equal(summarize(periods, [], now, 72).hours.length, 72);
assert.equal(summarize(periods, [], now, 168).hours.length, 168);
assert.equal(summarize(periods, [], now, 168).hours.at(-1).end, periods[167].endTime);
console.log('Passed: 24/48/72/168-hour windows keep their own hazards and cutoffs.');
