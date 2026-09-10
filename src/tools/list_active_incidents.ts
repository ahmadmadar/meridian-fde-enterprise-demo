// Meridian FDE Demo — list_active_incidents
//
// Discovery tool for check_incident_impact: that tool requires a
// caller-supplied incident_id with no way to find one, which is the gap
// the Day 6 demo run surfaced (docs/ai-assisted-delivery.md). This tool
// lists incidents so the model can pick an incident_id, then call
// check_incident_impact for the full account/MRR breakdown — so the
// return shape here stays a summary, not a duplicate of that tool's
// output.
//
// "Active" defaults to every non-RESOLVED status, same override
// convention as search_tickets/ACTIVE_TICKET_STATUSES: an explicit
// status filter replaces the default rather than narrowing it. This is
// the first incident-status filter in the codebase, so — same as
// get_renewal_risk's local RISK_LEVELS — the status list is defined here
// rather than added to constants.ts (that file's own comment reserves
// extraction for when a third tool needs the same constant).

import { z } from "zod";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";

const INCIDENT_STATUSES = ["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"] as const;
const INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3"] as const;
const ACTIVE_INCIDENT_STATUSES = ["INVESTIGATING", "IDENTIFIED", "MONITORING"] as const;

export const listActiveIncidentsInputSchema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type ListActiveIncidentsInput = z.infer<typeof listActiveIncidentsInputSchema>;

export async function listActiveIncidents(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "read:incidents");

  const input = listActiveIncidentsInputSchema.parse(rawInput);

  const where: Record<string, unknown> = {
    status: input.status ? input.status : { in: ACTIVE_INCIDENT_STATUSES },
  };
  if (input.severity) where.severity = input.severity;

  const incidents = await prisma.incident.findMany({
    where,
    include: { affectedAccounts: { include: { account: true } } },
    orderBy: [{ severity: "asc" }, { startedAt: "desc" }],
    take: input.limit,
  });

  const summarized = incidents.map((incident) => {
    const affectedAccounts = incident.affectedAccounts.map((link) => link.account);
    return {
      id: incident.id,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      started_at: incident.startedAt.toISOString(),
      affected_account_count: affectedAccounts.length,
      total_mrr_impacted_usd: affectedAccounts.reduce((sum, a) => sum + a.mrr, 0) / 100,
    };
  });

  const sev1Count = summarized.filter((i) => i.severity === "SEV1").length;

  logger.info(
    {
      tool: "list_active_incidents",
      actor: record.name,
      filters: input,
      resultCount: summarized.length,
    },
    "tool call"
  );

  return {
    incidents: summarized,
    count: summarized.length,
    sev1_count: sev1Count,
  };
}
