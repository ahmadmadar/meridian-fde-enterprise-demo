import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount, createIncident } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";

describe("check_incident_impact", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reports affected accounts and exact revenue exposure", async () => {
    const accountA = await createAccount({ name: "A", mrr: 500_000, planTier: "ENTERPRISE" });
    const accountB = await createAccount({ name: "B", mrr: 200_000, planTier: "STARTER" });
    const unaffected = await createAccount({ name: "C", mrr: 1_000_000 });

    const incident = await createIncident({ title: "Outage", severity: "SEV1" }, [accountA.id, accountB.id]);

    const result = await callTool("check_incident_impact", { incident_id: incident.id }, API_KEYS.agent);

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.account_count).toBe(2);
    expect(result.data.total_mrr_impacted_usd).toBe(7_000); // (500000 + 200000) / 100

    const ids = result.data.affected_accounts.map((a: any) => a.id).sort();
    expect(ids).toEqual([accountA.id, accountB.id].sort());
    expect(ids).not.toContain(unaffected.id);
  });

  it("returns NOT_FOUND for a nonexistent incident_id", async () => {
    const result = await callTool("check_incident_impact", { incident_id: "does-not-exist" }, API_KEYS.agent);
    expect(result).toEqual({
      kind: "tool_error",
      code: "NOT_FOUND",
      message: "No incident found for id does-not-exist",
    });
  });
});
