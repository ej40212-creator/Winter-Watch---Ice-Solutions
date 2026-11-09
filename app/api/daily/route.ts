import { dailyForecast } from "../../../lib/daily-weather";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { NOT_RUN, prepareRead } from "../../../lib/api-access";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const provider = url.searchParams.get("provider") || "nws";
  if (!key || !["nws", "accuweather"].includes(provider)) return Response.json({ error: "Choose a valid site and provider." }, { status: 400, headers: PRIVATE_NO_STORE });
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  if (gate.synthetic) {
    return Response.json({ provider, status: "unavailable", execution: "simulation", error: "Synthetic mode did not call a forecast provider." }, { headers: PRIVATE_NO_STORE });
  }
  try {
    return Response.json(await dailyForecast(key, provider as "nws" | "accuweather", gate.allowLive), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ provider, status: "unavailable", ...NOT_RUN }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
