// Meridian FDE Demo — get_audit_log
//
// List/search tool over AuditLog, gated behind the "admin" scope rather
// than one of the domain read scopes (read:accounts/read:tickets/
// read:incidents) — audit rows expose before/after mutation snapshots
// across every entity type, not one domain, so they get the privileged
// tier scopes.ts already anticipated but hadn't assigned to anything yet.
//
// No "active subset" default exists here the way search_tickets has
// OPEN/INVESTIGATING/ESCALATED — audit rows are immutable history, not
// stateful entities. The equivalent default is most-recent-N, ordered
// desc, bounded by limit — never an unbounded dump.

import { z } from "zod";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";

export const getAuditLogInputSchema = z.object({
  entity_type: z.string().min(1).optional(),
  entity_id: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type GetAuditLogInput = z.infer<typeof getAuditLogInputSchema>;

export async function getAuditLog(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "admin");

  const input = getAuditLogInputSchema.parse(rawInput);

  const where: Record<string, unknown> = {};
  if (input.entity_type) where.entityType = input.entity_type;
  if (input.entity_id) where.entityId = input.entity_id;
  if (input.account_id) where.accountId = input.account_id;
  if (input.actor) where.actor = input.actor;
  if (input.action) where.action = input.action;
  if (input.since) where.createdAt = { gte: new Date(input.since) };

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });

  logger.info(
    { tool: "get_audit_log", actor: record.name, filters: input, resultCount: entries.length },
    "tool call"
  );

  return {
    entries: entries.map((e) => ({
      id: e.id,
      entity_type: e.entityType,
      entity_id: e.entityId,
      account_id: e.accountId,
      actor: e.actor,
      action: e.action,
      before: e.before,
      after: e.after,
      created_at: e.createdAt.toISOString(),
    })),
    count: entries.length,
  };
}
