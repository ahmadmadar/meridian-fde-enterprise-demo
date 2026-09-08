import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount, createTicket, createProductUsage, createIncident } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";

describe("get_account_360", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("assembles the composite view: billing, usage, open tickets, active incidents", async () => {
    const account = await createAccount({
      name: "Composite Co",
      planTier: "ENTERPRISE",
      mrr: 1_000_000,
      healthScore: 88,
      seatsLicensed: 100,
      seatsUsed: 60,
    });
    await createProductUsage(account.id, { usageTrend: "up" });

    const openTicket = await createTicket(account.id, {
      status: "OPEN",
      priority: "P2",
      category: "bug",
      slaDeadline: new Date(Date.now() - 1_000), // already breached
    });
    await createTicket(account.id, { status: "CLOSED" });

    const activeIncident = await createIncident({ status: "INVESTIGATING" }, [account.id]);
    await createIncident({ status: "RESOLVED" }, [account.id]);

    const result = await callTool("get_account_360", { account_id: account.id }, API_KEYS.agent);

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.account).toMatchObject({
      id: account.id,
      name: "Composite Co",
      plan_tier: "ENTERPRISE",
      mrr_usd: 10_000,
      health_score: 88,
      seat_utilization: "60/100",
    });
    expect(result.data.usage.trend).toBe("up");

    expect(result.data.open_tickets).toHaveLength(1);
    expect(result.data.open_tickets[0].id).toBe(openTicket.id);
    expect(result.data.sla_breach_count).toBe(1);

    expect(result.data.active_incidents).toHaveLength(1);
    expect(result.data.active_incidents[0].id).toBe(activeIncident.id);
  });

  it("returns NOT_FOUND for a nonexistent account_id", async () => {
    const result = await callTool("get_account_360", { account_id: "does-not-exist" }, API_KEYS.agent);
    expect(result).toEqual({
      kind: "tool_error",
      code: "NOT_FOUND",
      message: "No account found for id does-not-exist",
    });
  });
});
