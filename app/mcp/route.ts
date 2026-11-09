import { refreshBatch, refreshStatus } from "../../lib/background";

const list = [
  { name: "refresh_weather_batch", description: "Refresh at most 40 due Winter Watch sites when live provider refresh is authorized. Refuses when it is not.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "weather_refresh_status", description: "Read persisted background refresh status. Does not start a provider refresh.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

export async function POST(request: Request) {
  const body = await request.json() as { id?: unknown; method?: string; params?: { name?: string } };
  const reply = (result: unknown, status = 200) => Response.json({ jsonrpc: "2.0", id: body.id, result }, { status, headers: { "cache-control": "private, no-store" } });
  if (body.method === "server/discover") return reply({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  if (body.method === "tools/list") return reply({ tools: list });
  if (body.method === "tools/call") {
    try {
      const data = body.params?.name === "refresh_weather_batch" ? await refreshBatch() : body.params?.name === "weather_refresh_status" ? await refreshStatus() : null;
      if (!data) return reply({ content: [{ type: "text", text: "Unknown tool." }], isError: true });
      return reply({ content: [{ type: "text", text: JSON.stringify(data) }] });
    } catch (error) {
      return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : "Refresh failed." }], isError: true });
    }
  }
  return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }, { headers: { "cache-control": "private, no-store" } });
}
