import { describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb, createAccount } from "../fixtures.js";
import { callTool, API_KEYS } from "../helpers.js";
import { prisma } from "../../src/db/client.js";

async function seedAuditRow(
  overrides: Partial<{
    entityType: string;
    entityId: string;
    accountId: string | null;
    actor: string;
    action: string;
    createdAt: Date;
  }> = {}
) {
  return prisma.auditLog.create({
    data: {
      entityType: overrides.entityType ?? "ticket",
      entityId: overrides.entityId ?? "entity-1",
      accountId: overrides.accountId ?? null,
      actor: overrides.actor ?? "test-actor",
      action: overrides.action ?? "create_ticket",
      before: Prisma.DbNull,
      after: { note: "fixture" },
      createdAt: overrides.createdAt ?? new Date(),
    },
  });
}

describe("get_audit_log", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("filters by entity_type, entity_id, account_id, actor, action, and since", async () => {
    const account = await createAccount();

    const older = await seedAuditRow({
      entityType: "ticket",
      entityId: "ticket-A",
      accountId: account.id,
      actor: "claude-agent-prod",
      action: "create_ticket",
      createdAt: new Date(Date.now() - 60 * 60_000),
    });
    const newer = await seedAuditRow({
      entityType: "ticket",
      entityId: "ticket-B",
      accountId: account.id,
      actor: "dashboard-readonly",
      action: "update_ticket_status",
      createdAt: new Date(),
    });

    const byEntityType = await callTool("get_audit_log", { entity_type: "ticket" }, API_KEYS.agent);
    expect(byEntityType.kind === "success" ? byEntityType.data.count : null).toBe(2);

    const byEntityId = await callTool("get_audit_log", { entity_id: "ticket-A" }, API_KEYS.agent);
    expect(byEntityId.kind === "success" ? byEntityId.data.entries.map((e: any) => e.id) : null).toEqual([
      older.id,
    ]);

    const byAccountId = await callTool("get_audit_log", { account_id: account.id }, API_KEYS.agent);
    expect(byAccountId.kind === "success" ? byAccountId.data.count : null).toBe(2);

    const byActor = await callTool("get_audit_log", { actor: "dashboard-readonly" }, API_KEYS.agent);
    expect(byActor.kind === "success" ? byActor.data.entries.map((e: any) => e.id) : null).toEqual([newer.id]);

    const byAction = await callTool("get_audit_log", { action: "update_ticket_status" }, API_KEYS.agent);
    expect(byAction.kind === "success" ? byAction.data.entries.map((e: any) => e.id) : null).toEqual([newer.id]);

    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const bySince = await callTool("get_audit_log", { since }, API_KEYS.agent);
    expect(bySince.kind === "success" ? bySince.data.entries.map((e: any) => e.id) : null).toEqual([newer.id]);
  });

  it("defaults to the most recent entries ordered desc, bounded by limit", async () => {
    await seedAuditRow({ entityId: "e1", createdAt: new Date(Date.now() - 3_000) });
    const middle = await seedAuditRow({ entityId: "e2", createdAt: new Date(Date.now() - 2_000) });
    const mostRecent = await seedAuditRow({ entityId: "e3", createdAt: new Date(Date.now() - 1_000) });

    const result = await callTool("get_audit_log", { limit: 2 }, API_KEYS.agent);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries[0].id).toBe(mostRecent.id);
    expect(result.data.entries[1].id).toBe(middle.id);
  });

  it("rejects the dashboard-readonly key with FORBIDDEN_SCOPE (lacks admin)", async () => {
    const result = await callTool("get_audit_log", {}, API_KEYS.dashboard);
    expect(result).toEqual({
      kind: "tool_error",
      code: "FORBIDDEN_SCOPE",
      message: "Missing required scope: admin",
    });
  });
});
