import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount, createTicket } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";

describe("search_tickets", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to active statuses only (excludes RESOLVED/CLOSED)", async () => {
    const account = await createAccount();
    await createTicket(account.id, { status: "OPEN" });
    await createTicket(account.id, { status: "INVESTIGATING" });
    await createTicket(account.id, { status: "ESCALATED" });
    await createTicket(account.id, { status: "RESOLVED" });
    await createTicket(account.id, { status: "CLOSED" });

    const result = await callTool("search_tickets", {}, API_KEYS.agent);

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.count).toBe(3);
    const statuses = result.data.tickets.map((t: any) => t.status).sort();
    expect(statuses).toEqual(["ESCALATED", "INVESTIGATING", "OPEN"]);
  });

  it("partitions sla_risk correctly at the 24h boundary", async () => {
    const account = await createAccount();
    const now = Date.now();

    const breached = await createTicket(account.id, { slaDeadline: new Date(now - 5_000) });
    const atRisk = await createTicket(account.id, { slaDeadline: new Date(now + 5_000) });
    const justUnder24h = await createTicket(account.id, { slaDeadline: new Date(now + 24 * 3_600_000 - 5_000) });
    const justOver24h = await createTicket(account.id, { slaDeadline: new Date(now + 24 * 3_600_000 + 5_000) });

    const breachedResult = await callTool("search_tickets", { sla_risk: "breached" }, API_KEYS.agent);
    const atRiskResult = await callTool("search_tickets", { sla_risk: "at_risk" }, API_KEYS.agent);
    const okResult = await callTool("search_tickets", { sla_risk: "ok" }, API_KEYS.agent);

    expect(breachedResult.kind === "success" ? breachedResult.data.tickets.map((t: any) => t.id) : null).toEqual([
      breached.id,
    ]);
    expect(
      atRiskResult.kind === "success" ? atRiskResult.data.tickets.map((t: any) => t.id).sort() : null
    ).toEqual([atRisk.id, justUnder24h.id].sort());
    expect(okResult.kind === "success" ? okResult.data.tickets.map((t: any) => t.id) : null).toEqual([
      justOver24h.id,
    ]);
  });

  it("filters by priority, category, and account_id, individually and combined, and respects limit", async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();

    await createTicket(accountA.id, { priority: "P1", category: "billing", status: "OPEN" });
    await createTicket(accountA.id, { priority: "P2", category: "bug", status: "OPEN" });
    await createTicket(accountB.id, { priority: "P1", category: "billing", status: "OPEN" });

    const byPriority = await callTool("search_tickets", { priority: "P1" }, API_KEYS.agent);
    expect(byPriority.kind === "success" ? byPriority.data.count : null).toBe(2);

    const byAccount = await callTool("search_tickets", { account_id: accountA.id }, API_KEYS.agent);
    expect(byAccount.kind === "success" ? byAccount.data.count : null).toBe(2);

    const combined = await callTool(
      "search_tickets",
      { account_id: accountA.id, priority: "P1", category: "billing" },
      API_KEYS.agent
    );
    expect(combined.kind === "success" ? combined.data.count : null).toBe(1);

    const limited = await callTool("search_tickets", { limit: 1 }, API_KEYS.agent);
    expect(limited.kind === "success" ? limited.data.tickets.length : null).toBe(1);
  });
});
