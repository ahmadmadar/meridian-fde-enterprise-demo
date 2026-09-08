// Meridian FDE Demo — MCP test client
//
// Wraps the JSON-RPC POST + SSE `data:` line parsing every manual curl
// test this build has hand-rolled all along, so test files call one
// typed function instead of re-deriving this each time. Distinguishes
// three outcomes, not two, because the SDK's own schema validation
// short-circuits before our handler runs for ordinary bad input (see
// docs/ai-assisted-delivery.md, the SDK-validation-bypass finding) —
// that path returns a plain "MCP error -32602: ..." string, not our
// { error: { code, message } } envelope, so it can't be JSON.parsed the
// same way a real tool result or a real thrown error can.

const BASE_URL = `http://localhost:${process.env.PORT ?? 3002}/mcp`;

export const API_KEYS = {
  agent: process.env.MCP_KEY_AGENT ?? "",
  dashboard: process.env.MCP_KEY_DASHBOARD ?? "",
};

export type ToolCallResult =
  | { kind: "success"; data: any }
  | { kind: "tool_error"; code: string; message: string }
  | { kind: "sdk_validation_error"; raw: string };

let nextId = 1;

export async function callTool(name: string, args: unknown, apiKey?: string): Promise<ToolCallResult> {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const raw = await res.text();
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  const jsonText = dataLine ? dataLine.slice("data: ".length) : raw;
  const envelope = JSON.parse(jsonText);

  const text: string | undefined = envelope.result?.content?.[0]?.text;
  if (text === undefined) {
    throw new Error(`Unexpected response shape from ${name}: ${jsonText}`);
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) {
      return { kind: "tool_error", code: parsed.error.code, message: parsed.error.message };
    }
    return { kind: "success", data: parsed };
  } catch {
    return { kind: "sdk_validation_error", raw: text };
  }
}
