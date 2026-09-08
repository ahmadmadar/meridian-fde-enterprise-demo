// Meridian FDE Demo — get_renewal_risk
//
// Portfolio-list tool, same shape as search_tickets: accounts renewing
// within a window, with a derived risk_level (high/medium/low) based on
// health score and usage trend. Both signals are stored columns
// (Account.healthScore, ProductUsage.usageTrend), so — per the
// search_tickets/sla_risk precedent — risk_level filtering is translated
// into a Prisma where clause rather than computed in JS after fetching.
// Doing it in JS after `take: limit` would risk returning fewer results
// than requested (or missing later-sorted matches) once account volume
// grows past a small seeded set — the same correctness concern
// sla_risk's range-query treatment exists to avoid.

import { z } from "zod";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";

const RISK_LEVELS = ["high", "medium", "low"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];

const RENEWAL_WINDOW_DAYS_DEFAULT = 90;
const LOW_HEALTH_SCORE_THRESHOLD = 50;

export const getRenewalRiskInputSchema = z.object({
  account_id: z.string().min(1).optional(),
  within_days: z.number().int().positive().default(RENEWAL_WINDOW_DAYS_DEFAULT),
  risk_level: z.enum(RISK_LEVELS).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type GetRenewalRiskInput = z.infer<typeof getRenewalRiskInputSchema>;

function computeRiskLevel(healthScore: number, usageTrend: string | undefined): RiskLevel {
  const lowHealth = healthScore < LOW_HEALTH_SCORE_THRESHOLD;
  const downTrend = usageTrend === "down";
  if (lowHealth && downTrend) return "high";
  if (lowHealth || downTrend) return "medium";
  return "low";
}

// Mirrors computeRiskLevel above as a Prisma where fragment, so filtering
// by risk_level stays a real query instead of an in-memory pass.
function riskLevelWhere(riskLevel: RiskLevel): Record<string, unknown> {
  const lowHealth = { healthScore: { lt: LOW_HEALTH_SCORE_THRESHOLD } };
  const notLowHealth = { healthScore: { gte: LOW_HEALTH_SCORE_THRESHOLD } };
  const downTrend = { usage: { usageTrend: "down" } };
  const notDownTrend = { OR: [{ usage: { is: null } }, { usage: { usageTrend: { not: "down" } } }] };

  if (riskLevel === "high") return { AND: [lowHealth, downTrend] };
  if (riskLevel === "low") return { AND: [notLowHealth, notDownTrend] };
  return { OR: [{ AND: [lowHealth, notDownTrend] }, { AND: [notLowHealth, downTrend] }] };
}

export async function getRenewalRisk(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "read:accounts");

  const input = getRenewalRiskInputSchema.parse(rawInput);

  const now = new Date();
  const windowEnd = new Date(now.getTime() + input.within_days * 24 * 60 * 60 * 1000);

  const where: Record<string, unknown> = {
    renewalDate: { gte: now, lte: windowEnd },
  };
  if (input.account_id) where.id = input.account_id;
  if (input.risk_level) Object.assign(where, riskLevelWhere(input.risk_level));

  const accounts = await prisma.account.findMany({
    where,
    include: { usage: true },
    orderBy: { renewalDate: "asc" },
    take: input.limit,
  });

  const scored = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    plan_tier: a.planTier,
    mrr_usd: a.mrr / 100,
    health_score: a.healthScore,
    renewal_date: a.renewalDate.toISOString().slice(0, 10),
    seat_utilization: `${a.seatsUsed}/${a.seatsLicensed}`,
    usage_trend: a.usage?.usageTrend ?? null,
    risk_level: computeRiskLevel(a.healthScore, a.usage?.usageTrend),
  }));

  const highRiskCount = scored.filter((a) => a.risk_level === "high").length;

  logger.info(
    {
      tool: "get_renewal_risk",
      actor: record.name,
      withinDays: input.within_days,
      riskLevelFilter: input.risk_level,
      resultCount: scored.length,
    },
    "tool call"
  );

  return {
    accounts: scored,
    count: scored.length,
    high_risk_count: highRiskCount,
  };
}
