import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount, createProductUsage } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

describe("get_renewal_risk", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("classifies risk_level correctly at the healthScore=50 and usageTrend boundaries", async () => {
    const high = await createAccount({ healthScore: 49, renewalDate: inDays(10) });
    await createProductUsage(high.id, { usageTrend: "down" });

    // Exactly at the threshold: healthScore < 50 excludes 50, so this
    // should NOT count as low health — only the usageTrend signal fires.
    const mediumAtThreshold = await createAccount({ healthScore: 50, renewalDate: inDays(10) });
    await createProductUsage(mediumAtThreshold.id, { usageTrend: "down" });

    const mediumLowHealthOnly = await createAccount({ healthScore: 30, renewalDate: inDays(10) });
    await createProductUsage(mediumLowHealthOnly.id, { usageTrend: "up" });

    // No usage record at all — downTrend must be treated as false, not
    // thrown or coerced into "risky by default".
    const mediumNoUsageRecord = await createAccount({ healthScore: 30, renewalDate: inDays(10) });

    const low = await createAccount({ healthScore: 80, renewalDate: inDays(10) });
    await createProductUsage(low.id, { usageTrend: "flat" });

    const result = await callTool("get_renewal_risk", {}, API_KEYS.agent);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const byId = new Map<string, string>(result.data.accounts.map((a: any) => [a.id, a.risk_level]));
    expect(byId.get(high.id)).toBe("high");
    expect(byId.get(mediumAtThreshold.id)).toBe("medium");
    expect(byId.get(mediumLowHealthOnly.id)).toBe("medium");
    expect(byId.get(mediumNoUsageRecord.id)).toBe("medium");
    expect(byId.get(low.id)).toBe("low");
    expect(result.data.high_risk_count).toBe(1);
  });

  it("filters by risk_level via the where-clause for all three tiers, not just the JS label", async () => {
    const high = await createAccount({ healthScore: 20, renewalDate: inDays(10) });
    await createProductUsage(high.id, { usageTrend: "down" });

    const medium = await createAccount({ healthScore: 20, renewalDate: inDays(10) });
    await createProductUsage(medium.id, { usageTrend: "up" });

    const low = await createAccount({ healthScore: 90, renewalDate: inDays(10) });
    await createProductUsage(low.id, { usageTrend: "up" });

    const highResult = await callTool("get_renewal_risk", { risk_level: "high" }, API_KEYS.agent);
    expect(highResult.kind === "success" ? highResult.data.accounts.map((a: any) => a.id) : null).toEqual([
      high.id,
    ]);

    const mediumResult = await callTool("get_renewal_risk", { risk_level: "medium" }, API_KEYS.agent);
    expect(mediumResult.kind === "success" ? mediumResult.data.accounts.map((a: any) => a.id) : null).toEqual([
      medium.id,
    ]);

    const lowResult = await callTool("get_renewal_risk", { risk_level: "low" }, API_KEYS.agent);
    expect(lowResult.kind === "success" ? lowResult.data.accounts.map((a: any) => a.id) : null).toEqual([low.id]);
  });

  it("respects the within_days window and the account_id filter", async () => {
    const soon = await createAccount({ renewalDate: inDays(10) });
    const farOut = await createAccount({ renewalDate: inDays(120) });

    const defaultWindow = await callTool("get_renewal_risk", {}, API_KEYS.agent);
    const ids = defaultWindow.kind === "success" ? defaultWindow.data.accounts.map((a: any) => a.id) : [];
    expect(ids).toContain(soon.id);
    expect(ids).not.toContain(farOut.id);

    const widened = await callTool("get_renewal_risk", { within_days: 150 }, API_KEYS.agent);
    const widenedIds = widened.kind === "success" ? widened.data.accounts.map((a: any) => a.id) : [];
    expect(widenedIds).toContain(farOut.id);

    const scoped = await callTool("get_renewal_risk", { account_id: soon.id }, API_KEYS.agent);
    expect(scoped.kind === "success" ? scoped.data.count : null).toBe(1);
  });
});
