// Meridian FDE Demo — search_tickets
//
// Cross-account ticket search: filter by SLA risk, priority, or category
// instead of forcing the caller to pull every account's tickets and filter
// client-side. SLA risk isn't a stored column — it's derived from
// slaDeadline the same way get_account_360 derives sla_breached — but it's
// translated into a real where clause so it stays queryable at volume.

import { z } from "zod";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";
import { TICKET_STATUSES, TICKET_PRIORITIES, ACTIVE_TICKET_STATUSES } from "./constants.js";

const SLA_RISK_LEVELS = ["breached", "at_risk", "ok"] as const;

const AT_RISK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export const searchTicketsInputSchema = z.object({
  account_id: z.string().min(1).optional(),
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.string().min(1).optional(),
  sla_risk: z.enum(SLA_RISK_LEVELS).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type SearchTicketsInput = z.infer<typeof searchTicketsInputSchema>;

export async function searchTickets(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "read:tickets");

  const input = searchTicketsInputSchema.parse(rawInput);

  const now = Date.now();

  const where: Record<string, unknown> = {
    status: input.status ? input.status : { in: ACTIVE_TICKET_STATUSES },
  };

  if (input.account_id) where.accountId = input.account_id;
  if (input.priority) where.priority = input.priority;
  if (input.category) where.category = input.category;

  if (input.sla_risk === "breached") {
    where.slaDeadline = { lt: new Date(now) };
  } else if (input.sla_risk === "at_risk") {
    where.slaDeadline = { gte: new Date(now), lt: new Date(now + AT_RISK_WINDOW_MS) };
  } else if (input.sla_risk === "ok") {
    where.slaDeadline = { gte: new Date(now + AT_RISK_WINDOW_MS) };
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: { account: { select: { name: true } } },
    orderBy: { slaDeadline: "asc" },
    take: input.limit,
  });

  const slaBreachCount = tickets.filter((t) => t.slaDeadline.getTime() < now).length;

  logger.info(
    { tool: "search_tickets", actor: record.name, filters: input, resultCount: tickets.length },
    "tool call"
  );

  return {
    tickets: tickets.map((t) => ({
      id: t.id,
      account_id: t.accountId,
      account_name: t.account.name,
      priority: t.priority,
      status: t.status,
      category: t.category,
      sla_deadline: t.slaDeadline.toISOString(),
      sla_breached: t.slaDeadline.getTime() < now,
    })),
    count: tickets.length,
    sla_breach_count: slaBreachCount,
  };
}
