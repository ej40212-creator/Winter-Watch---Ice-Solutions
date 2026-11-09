# Baseline evidence

Recorded before the private-pilot code changes. The unit tests do not read hosting identity.

Commands, from the repository root, Node v22.23.4, after `pnpm install --frozen-lockfile`:

```bash
node node_modules/typescript/bin/tsc --noEmit
node --experimental-strip-types scripts/test-risk.mjs
node --experimental-strip-types scripts/test-daily.mjs
node --experimental-strip-types scripts/test-coverage.mjs
node --experimental-strip-types scripts/test-observation.mjs
node --experimental-strip-types scripts/test-analytics.mjs
```

All six commands exited 0 on 2026-11-09. The full transcript is `baseline-tests.log` in this directory.

The original ChatGPT Sites project id and `chatgpt.site` origin were removed from the tree before this commit. They were not inputs to these tests. No provider calls, D1 provisioning, or deployment ran.
