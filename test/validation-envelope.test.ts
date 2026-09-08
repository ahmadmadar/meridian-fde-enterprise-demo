// Cross-cutting checks, not tool-specific — no DB fixtures needed here.
//
// 1. Codifies the SDK-validation-bypass finding as a checked invariant:
//    the MCP SDK validates inputSchema.shape itself and short-circuits
//    with a JSON-RPC -32602 error before our handler (and its own
//    ZodError catch) ever runs. If the SDK's behavior ever changes and
//    VALIDATION_ERROR starts actually firing, this test catches it
//    instead of the fact quietly rotting in a doc.
// 2. A loop over every registered tool confirming a bogus API key gets
//    UNAUTHORIZED — a cheap wiring-correctness check that a future new
//    tool didn't skip authenticate().

import { describe, it, expect } from "vitest";
import { callTool } from "./helpers.js";

// Minimal schema-valid args per tool, so the SDK's own inputSchema
// validation lets the call through to our handler — where authenticate()
// then rejects the bad key. Without valid args, the -32602 short-circuit
// would fire first and we'd never reach our own auth check.
const VALID_ARGS: [string, unknown][] = [
  ["get_account_360", { account_id: "x" }],
  ["update_ticket_status", { ticket_id: "x", new_status: "CLOSED" }],
  ["search_tickets", {}],
  ["create_ticket", { account_id: "x", issue: "x", priority: "P1", category: "x" }],
  ["check_incident_impact", { incident_id: "x" }],
  ["get_renewal_risk", {}],
  ["get_audit_log", {}],
];

describe("cross-cutting validation and auth wiring", () => {
  it("returns the SDK's own -32602 shape for invalid enum input, not our VALIDATION_ERROR envelope", async () => {
    const result = await callTool("update_ticket_status", { ticket_id: "x", new_status: "BOGUS" }, "irrelevant-key");
    expect(result.kind).toBe("sdk_validation_error");
    if (result.kind === "sdk_validation_error") {
      expect(result.raw).toContain("-32602");
    }
  });

  it.each(VALID_ARGS)("rejects a bogus API key with UNAUTHORIZED for %s", async (toolName, args) => {
    const result = await callTool(toolName, args, "totally-bogus-key");
    expect(result).toEqual({ kind: "tool_error", code: "UNAUTHORIZED", message: "Invalid or missing API key" });
  });
});
