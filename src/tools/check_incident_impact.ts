// Meridian FDE Demo — check_incident_impact
//
// Composite lookup tool, same shape as get_account_360 but from the
// incident side: given one incident_id, report which accounts it affects
// and the revenue exposure. There's no incidentId on Ticket in the schema,
// so incidents and tickets are only indirectly related via shared
// accountId — this tool reports account-level business impact, not a
// ticket correlation (that would require guessing at a heuristic link
// that doesn't exist in the data model).

import { z } from "zod";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";

export const checkIncidentImpactInputSchema = z.object({
  incident_id: z.string().min(1, "incident_id is required"),
});

export type CheckIncidentImpactInput = z.infer<typeof checkIncidentImpactInputSchema>;

export async function checkIncidentImpact(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "read:incidents");

  const input = checkIncidentImpactInputSchema.parse(rawInput);

  const incident = await prisma.incident.findUnique({
    where: { id: input.incident_id },
    include: {
      affectedAccounts: {
        include: { account: true },
      },
    },
  });

  if (!incident) {
    const err = new Error(`No incident found for id ${input.incident_id}`);
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const affectedAccounts = incident.affectedAccounts.map((link) => link.account);
  const totalMrrImpactedUsd = affectedAccounts.reduce((sum, a) => sum + a.mrr, 0) / 100;

  logger.info(
    {
      tool: "check_incident_impact",
      actor: record.name,
      incidentId: input.incident_id,
      accountCount: affectedAccounts.length,
    },
    "tool call"
  );

  return {
    incident: {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      started_at: incident.startedAt.toISOString(),
      resolved_at: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    },
    affected_accounts: affectedAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      plan_tier: a.planTier,
      mrr_usd: a.mrr / 100,
      health_score: a.healthScore,
    })),
    account_count: affectedAccounts.length,
    total_mrr_impacted_usd: totalMrrImpactedUsd,
  };
}
