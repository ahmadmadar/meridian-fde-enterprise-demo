// Meridian FDE Demo — get_account_360
//
// The composite/cross-system tool: merges billing, product usage, open
// tickets, and incident exposure for one account in a single call. This is
// the tool that demonstrates the actual value of an MCP integration — the
// model shouldn't have to make four separate calls and reconcile them
// itself when the server can do that join once, correctly.

import { z } from "zod";
import { prisma } from "../db/client";
import { authenticate, requireScope } from "../auth/scopes";
import { logger } from "../logger";

export const getAccountInputSchema = z.object({
  account_id: z.string().min(1, "account_id is required"),
});

export type GetAccountInput = z.infer<typeof getAccountInputSchema>;

export async function getAccount360(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "read:accounts");

  const input = getAccountInputSchema.parse(rawInput); // throws ZodError -> mapped to VALIDATION_ERROR by the server layer

  const account = await prisma.account.findUnique({
    where: { id: input.account_id },
    include: {
      usage: true,
      tickets: {
        where: { status: { in: ["OPEN", "INVESTIGATING", "ESCALATED"] } },
        orderBy: { slaDeadline: "asc" },
      },
      incidentLinks: {
        include: { incident: true },
      },
    },
  });

  if (!account) {
    const err = new Error(`No account found for id ${input.account_id}`);
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const openTickets = account.tickets;
  const now = Date.now();
  const slaBreaches = openTickets.filter((t) => t.slaDeadline.getTime() < now);

  const activeIncidents = account.incidentLinks
    .map((link) => link.incident)
    .filter((i) => i.status !== "RESOLVED");

  logger.info({ tool: "get_account_360", actor: record.name, accountId: input.account_id }, "tool call");

  return {
    account: {
      id: account.id,
      name: account.name,
      plan_tier: account.planTier,
      mrr_usd: account.mrr / 100,
      health_score: account.healthScore,
      renewal_date: account.renewalDate.toISOString().slice(0, 10),
      seat_utilization: `${account.seatsUsed}/${account.seatsLicensed}`,
    },
    usage: account.usage
      ? {
          last_active: account.usage.lastActiveAt.toISOString().slice(0, 10),
          trend: account.usage.usageTrend,
          feature_flags: account.usage.featureFlags,
        }
      : null,
    open_tickets: openTickets.map((t) => ({
      id: t.id,
      priority: t.priority,
      status: t.status,
      category: t.category,
      sla_deadline: t.slaDeadline.toISOString(),
      sla_breached: t.slaDeadline.getTime() < now,
    })),
    sla_breach_count: slaBreaches.length,
    active_incidents: activeIncidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
    })),
  };
}
