import { providerFailureMessage } from "./cache-policy.ts";

const BLOCKED = "Live provider refresh is not authorized, or PROVIDER_BUDGET is unset. No provider call was made.";

export async function fetchProviderJson(input: {
  url: string;
  allowLive: boolean;
  fetchImpl?: typeof fetch;
  consume?: () => Promise<boolean>;
  headers?: HeadersInit;
}): Promise<unknown> {
  if (!input.allowLive) throw new Error(BLOCKED);
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers = new Headers(input.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "IceSolutionsWinterWatch (https://myicesolutions.com)");
  if (!headers.has("Accept")) headers.set("Accept", "application/geo+json, application/json");
  let response: Response | undefined;
  let aborted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (input.consume && !(await input.consume())) throw new Error("Provider budget for this period is exhausted. No further provider call was made.");
    try {
      response = await fetchImpl(input.url, { headers, signal: AbortSignal.timeout(16000) });
      aborted = false;
    } catch {
      aborted = true;
      response = undefined;
    }
    if (response?.ok) break;
    if (response && (response.status === 429 || response.status < 500)) break;
  }
  if (!response?.ok) throw new Error(providerFailureMessage({ status: response?.status, aborted }));
  return response.json();
}
