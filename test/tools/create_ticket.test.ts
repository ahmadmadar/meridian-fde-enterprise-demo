import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, createAccount } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";
import { prisma } from "../../src/db/client.js";

const SLA_HOURS: [string, number][] = [
  ["P1", 4],
  ["P2", 8],
  ["P3", 48],
  ["P4", 120],
];

describe("create_ticket", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a ticket and an audit log entry atomically", async () => {
    const account = await createAccount();

    const result = await callTool(
      "create_ticket",
      { account_id: account.id, issue: "Login broken", priority: "P2", category: "bug" },
      API_KEYS.agent
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.status).toBe("OPEN");
    expect(result.data.account_id).toBe(account.id);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: result.data.ticket_id } });
    expect(ticket.issue).toBe("Login broken");

    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: ticket.id, action: "create_ticket" },
    });
    expect(auditRows).toHaveLength(1);
    // Confirms Prisma.DbNull round-trips as a real SQL NULL, not a
    // stored JSON "null" value.
    expect(auditRows[0].before).toBeNull();
  });

  it.each(SLA_HOURS)("sets the SLA deadline the correct window out for priority %s", async (priority, hours) => {
    const account = await createAccount();

    const result = await callTool(
      "create_ticket",
      { account_id: account.id, issue: "x", priority, category: "bug" },
      API_KEYS.agent
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const deadline = new Date(result.data.sla_deadline).getTime();
    const createdAt = new Date(result.data.created_at).getTime();
    const delta = deadline - createdAt;
    const expectedMs = hours * 3_600_000;

    // slaDeadline is computed via JS Date.now() before the transaction
    // starts; createdAt is set by Postgres's own now() at insert time —
    // two different clocks with a small round-trip gap between them, so
    // this asserts "correct within a generous tolerance," not exact
    // millisecond equality.
    expect(delta).toBeLessThanOrEqual(expectedMs);
    expect(delta).toBeGreaterThan(expectedMs - 5_000);
  });

  it("returns NOT_FOUND for a nonexistent account_id and writes nothing", async () => {
    const before = await prisma.ticket.count();

    const result = await callTool(
      "create_ticket",
      { account_id: "does-not-exist", issue: "x", priority: "P1", category: "bug" },
      API_KEYS.agent
    );

    expect(result).toEqual({
      kind: "tool_error",
      code: "NOT_FOUND",
      message: "No account found for id does-not-exist",
    });
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("rejects the dashboard-readonly key with FORBIDDEN_SCOPE and writes nothing", async () => {
    const account = await createAccount();
    const before = await prisma.ticket.count();

    const result = await callTool(
      "create_ticket",
      { account_id: account.id, issue: "x", priority: "P1", category: "bug" },
      API_KEYS.dashboard
    );

    expect(result).toEqual({
      kind: "tool_error",
      code: "FORBIDDEN_SCOPE",
      message: "Missing required scope: write:tickets",
    });
    expect(await prisma.ticket.count()).toBe(before);
  });
});
