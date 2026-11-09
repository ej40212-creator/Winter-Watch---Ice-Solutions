import { refuseInactiveSite } from "../../../lib/activated-guard";
import { currentWeather } from "../../../lib/current-weather";
import { syntheticCurrent } from "../../../lib/synthetic-demo";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { NOT_RUN, prepareRead } from "../../../lib/api-access";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "Choose a site." }, { status: 400, headers: PRIVATE_NO_STORE });
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  if (!gate.synthetic) {
    const inactive = await refuseInactiveSite(key);
    if (inactive) return inactive;
  }
  if (gate.synthetic) {
    const row = syntheticCurrent(key);
    if (!row) return Response.json({ status: "unavailable", execution: "simulation", error: "Unknown synthetic site." }, { status: 404, headers: PRIVATE_NO_STORE });
    return Response.json(row, { headers: PRIVATE_NO_STORE });
  }
  if (!gate.allowLive) return Response.json({ status: "unavailable", temperature: null, ...NOT_RUN }, { headers: PRIVATE_NO_STORE });
  try {
    return Response.json(await currentWeather(key, true), { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ status: "unavailable", temperature: null, error: "Current observations are unavailable. The site address may need review, or nearby stations may not be reporting. Try again shortly." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
