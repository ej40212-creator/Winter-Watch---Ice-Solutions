import { cached } from "../../../lib/weather";
import { PRIVATE_NO_STORE } from "../../../lib/http";
import { prepareRead } from "../../../lib/api-access";

export async function GET(request: Request) {
  const gate = await prepareRead(request);
  if (gate instanceof Response) return gate;
  if (gate.synthetic) {
    return Response.json({ lastRun: null, execution: "simulation", message: "No background batch has run. Unattended refresh is not configured." }, { headers: PRIVATE_NO_STORE });
  }
  try {
    return Response.json(await cached("background-status", false) || { lastRun: null }, { headers: PRIVATE_NO_STORE });
  } catch {
    return Response.json({ lastRun: null, error: "Background status is unavailable because D1 is not configured." }, { status: 503, headers: PRIVATE_NO_STORE });
  }
}
