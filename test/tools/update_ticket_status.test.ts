import { describe, it, expect, beforeEach } from "vitest";
import type { TicketStatus } from "@prisma/client";
import { resetDb, createAccount, createTicket } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";
import { prisma } from "../../src/db/client.js";

const LEGAL_TRANSITIONS: [TicketStatus, TicketStatus][] = [
  ["OPEN", "INVESTIGATING"],
  ["OPEN", "CLOSED"],
  ["INVESTIGATING", "ESCALATED"],
  ["INVESTIGATING", "RESOLVED"],
  ["ESCALATED", "RESOLVED"],
  ["RESOLVED", "CLOSED"],
];

// Not exhaustive over every illegal pair — ALLOWED_TRANSITIONS already
// fully defines what's legal, so one representative illegal attempt per
// non-terminal state plus the CLOSED-terminal case covers the rule
// without redundant combinations.
const ILLEGAL_TRANSITIONS: [TicketStatus, TicketStatus][] = [
  ["OPEN", "RESOLVED"],
  ["INVESTIGATING", "CLOSED"],
  ["ESCALATED", "OPEN"],
  ["CLOSED", "OPEN"],
];

describe("update_ticket_status", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it.each(LEGAL_TRANSITIONS)("allows %s -> %s and records one audit entry", async (from, to) => {
    const account = await createAccount();
    const ticket = await createTicket(account.id, { status: from });

    const result = await callTool("update_ticket_status", { ticket_id: ticket.id, new_status: to }, API_KEYS.agent);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.data.previous_status).toBe(from);
      expect(result.data.new_status).toBe(to);
    }

    const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(updated.status).toBe(to);

    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: ticket.id, action: "update_ticket_status" },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].before).toEqual({ status: from });
    expect((auditRows[0].after as { status: string }).status).toBe(to);
  });

  it.each(ILLEGAL_TRANSITIONS)(
    "rejects %s -> %s with CONFLICT and leaves the ticket/audit log untouched",
    async (from, to) => {
      const account = await createAccount();
      const ticket = await createTicket(account.id, { status: from });

      const result = await callTool("update_ticket_status", { ticket_id: ticket.id, new_status: to }, API_KEYS.agent);

      expect(result.kind).toBe("tool_error");
      if (result.kind === "tool_error") {
        expect(result.code).toBe("CONFLICT");
      }

      const unchanged = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(unchanged.status).toBe(from);

      const auditRows = await prisma.auditLog.findMany({ where: { entityId: ticket.id } });
      expect(auditRows).toHaveLength(0);
    }
  );

  it("returns NOT_FOUND for a nonexistent ticket_id", async () => {
    const result = await callTool(
      "update_ticket_status",
      { ticket_id: "does-not-exist", new_status: "CLOSED" },
      API_KEYS.agent
    );
    expect(result).toEqual({
      kind: "tool_error",
      code: "NOT_FOUND",
      message: "No ticket found for id does-not-exist",
    });
  });

  it("rejects the dashboard-readonly key with FORBIDDEN_SCOPE and writes nothing", async () => {
    const account = await createAccount();
    const ticket = await createTicket(account.id, { status: "OPEN" });

    const result = await callTool(
      "update_ticket_status",
      { ticket_id: ticket.id, new_status: "INVESTIGATING" },
      API_KEYS.dashboard
    );

    expect(result).toEqual({
      kind: "tool_error",
      code: "FORBIDDEN_SCOPE",
      message: "Missing required scope: write:tickets",
    });

    const unchanged = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(unchanged.status).toBe("OPEN");
  });
});
