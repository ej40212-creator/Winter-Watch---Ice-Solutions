import { refuseInactiveSite } from "../../../lib/activated-guard";
import { radar } from "../../../lib/noaa";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { NOT_RUN, prepareRead } from "../../../lib/api-access";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return Response.json({ error: "Choose a site." }, { status: 400, headers: PRIVATE_NO_STORE });
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  if (gate.synthetic) return Response.json({ error: "Synthetic mode did not call NOAA radar.", execution: "simulation" }, { status: 503, headers: PRIVATE_NO_STORE });
  const inactive = await refuseInactiveSite(key);
  if (inactive) return inactive;
  if (!gate.allowLive) return Response.json({ ...NOT_RUN }, { status: 409, headers: PRIVATE_NO_STORE });
  try {
    return Response.json(await radar(key, true), { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Radar unavailable.", execution: "provider" }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
