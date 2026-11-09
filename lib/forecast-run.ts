import { providerFailureMessage } from "./cache-policy.ts";

const BLOCKED = "Live provider refresh is not authorized, or PROVIDER_BUDGET is unset. No provider call was made.";

export async function fetchProviderJson(input: {
  url: string;
  allowLive: boolean;
  fetchImpl?: typeof fetch;
  consume?: () => Promise<boolean>;
}): Promise<unknown> {
  if (!input.allowLive) throw new Error(BLOCKED);
  if (input.consume && !(await input.consume())) throw new Error("Provider budget for this period is exhausted. No further provider call was made.");
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response | undefined;
  let aborted = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(input.url, {
        headers: { "User-Agent": "IceSolutionsWinterWatch (https://myicesolutions.com)", Accept: "application/geo+json, application/json" },
        signal: AbortSignal.timeout(16000),
      });
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
