import { isLoopbackHost } from "./loopback.ts";

/**
 * Synthetic sessions exist only in a dev build on a loopback host.
 * `import.meta.env.DEV` is false in a production bundle, so this cannot be turned on by an env var alone.
 */
export function syntheticSessionsAllowed(input: { devBuild: boolean; host: string; authFlag: string | undefined; dataFlag?: string | undefined }): boolean {
  return input.devBuild === true && input.authFlag === "1" && isLoopbackHost(input.host);
}

export function syntheticDataAllowed(input: { devBuild: boolean; host: string; authFlag: string | undefined; dataFlag: string | undefined }): boolean {
  return syntheticSessionsAllowed(input) && input.dataFlag === "1";
}
