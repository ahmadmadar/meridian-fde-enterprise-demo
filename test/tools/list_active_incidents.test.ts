import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount, createIncident } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";

describe("list_active_incidents", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to non-RESOLVED statuses, excluding RESOLVED", async () => {
    const investigating = await createIncident({ status: "INVESTIGATING" });
    const identified = await createIncident({ status: "IDENTIFIED" });
    const monitoring = await createIncident({ status: "MONITORING" });
    const resolved = await createIncident({ status: "RESOLVED" });

    const result = await callTool("list_active_incidents", {}, API_KEYS.agent);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const ids = result.data.incidents.map((i: any) => i.id);
    expect(ids).toEqual(expect.arrayContaining([investigating.id, identified.id, monitoring.id]));
    expect(ids).not.toContain(resolved.id);
    expect(result.data.count).toBe(3);
  });

  it("an explicit status filter overrides the active-subset default, not narrows it", async () => {
    const resolved = await createIncident({ status: "RESOLVED" });
    await createIncident({ status: "INVESTIGATING" });

    const result = await callTool("list_active_incidents", { status: "RESOLVED" }, API_KEYS.agent);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.incidents.map((i: any) => i.id)).toEqual([resolved.id]);
  });

  it("filters by severity and orders SEV1 first", async () => {
    const sev3 = await createIncident({ severity: "SEV3", startedAt: new Date(Date.now() - 1000) });
    const sev1 = await createIncident({ severity: "SEV1", startedAt: new Date() });

    const all = await callTool("list_active_incidents", {}, API_KEYS.agent);
    expect(all.kind === "success" ? all.data.incidents.map((i: any) => i.id) : null).toEqual([sev1.id, sev3.id]);
    expect(all.kind === "success" ? all.data.sev1_count : null).toBe(1);

    const filtered = await callTool("list_active_incidents", { severity: "SEV3" }, API_KEYS.agent);
    expect(filtered.kind === "success" ? filtered.data.incidents.map((i: any) => i.id) : null).toEqual([sev3.id]);
  });

  it("reports exact affected_account_count and total_mrr_impacted_usd", async () => {
    const a = await createAccount({ mrr: 300_000 });
    const b = await createAccount({ mrr: 150_000 });
    const unaffected = await createAccount({ mrr: 1_000_000 });

    const incident = await createIncident({}, [a.id, b.id]);

    const result = await callTool("list_active_incidents", {}, API_KEYS.agent);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const row = result.data.incidents.find((i: any) => i.id === incident.id);
    expect(row.affected_account_count).toBe(2);
    expect(row.total_mrr_impacted_usd).toBe(4_500); // (300000 + 150000) / 100
    expect(unaffected).toBeTruthy();
  });

  it("rejects a bad API key with UNAUTHORIZED", async () => {
    const result = await callTool("list_active_incidents", {}, "not-a-real-key");
    expect(result).toEqual({
      kind: "tool_error",
      code: "UNAUTHORIZED",
      message: "Invalid or missing API key",
    });
  });
});
