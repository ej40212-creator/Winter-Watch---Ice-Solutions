import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const deployVarNames = ["ACCESS_AUD", "ACCESS_ISSUER", "ACCESS_TEAM_DOMAIN", "ACCESS_JWKS_URL", "ADMIN_EMAILS", "ADMIN_GROUPS", "SCHEDULER_ENABLED", "PROVIDER_REFRESH", "PROVIDER_BUDGET", "OPERATOR_RATE_LIMIT_PER_MINUTE", "REFRESH_DUE_AFTER_MS", "ACCUWEATHER_RIGHTS_CONFIRMED", "PILOT_PUBLIC_ORIGIN"] as const;
const devOnlyVarNames = ["PILOT_SYNTHETIC_AUTH", "PILOT_SYNTHETIC_DATA", "PILOT_SYNTHETIC_PRIVATE_JWK", "ACCESS_JWKS_JSON"] as const;

export default defineConfig(async ({ command }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  const names = command === "serve" ? [...deployVarNames, ...devOnlyVarNames] : deployVarNames;
  const vars = Object.fromEntries(names.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []));
  const localBindingConfig = {
    main: "./build/sites-worker.ts",
    // nodejs_compat and workers_dev live only in wrangler.jsonc. Repeating the
    // flag here makes Miniflare refuse to start.
    workers_dev: false,
    vars,
  };
  return {
    server: {
      host: "127.0.0.1",
      ...(managedLinux
        ? { allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: false }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        configPath: "./wrangler.jsonc",
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
