import { spawnSync } from "node:child_process";

const tests = [
  "scripts/test-risk.mjs",
  "scripts/test-daily.mjs",
  "scripts/test-coverage.mjs",
  "scripts/test-observation.mjs",
  "scripts/test-analytics.mjs",
  "scripts/test-access-auth.mjs",
  "scripts/test-import.mjs",
  "scripts/test-cache-isolation.mjs",
  "scripts/test-missing-vs-zero.mjs",
  "scripts/test-horizons.mjs",
  "scripts/test-scheduler.mjs",
  "scripts/test-provider-failure.mjs",
];
let failed = 0;
for (const test of tests) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", test], { stdio: "inherit", env: process.env });
  if (result.status !== 0) failed += 1;
}
if (failed) {
  console.error(`${failed} test file(s) failed`);
  process.exit(1);
}
console.log(`Passed ${tests.length} test files.`);
