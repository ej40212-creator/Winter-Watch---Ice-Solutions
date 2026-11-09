declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ACCESS_AUD?: string;
    ACCESS_ISSUER?: string;
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_JWKS_JSON?: string;
    ADMIN_EMAILS?: string;
    ADMIN_GROUPS?: string;
    PILOT_SYNTHETIC_AUTH?: string;
    PILOT_SYNTHETIC_PRIVATE_JWK?: string;
    PILOT_SYNTHETIC_DATA?: string;
    PROVIDER_REFRESH?: string;
    SCHEDULER_ENABLED?: string;
    ACCUWEATHER_RIGHTS_CONFIRMED?: string;
    ACCUWEATHER_API_KEY?: string;
    SEED_ENDPOINT_ENABLED?: string;
  }
}
