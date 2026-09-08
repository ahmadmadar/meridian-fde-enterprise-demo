// Meridian FDE Demo — create_ticket
//
// Writes a new support ticket for an account. Two things beyond the usual
// write-tool shape: the account_id foreign key is validated up front (a bad
// id would otherwise surface as a raw Prisma FK-constraint error instead of
// a structured NOT_FOUND), and slaDeadline isn't caller-supplied — it's
// derived from priority via a fixed SLA policy, same way
// update_ticket_status derives legality from ALLOWED_TRANSITIONS rather
// than trusting the caller.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";
import { TICKET_PRIORITIES } from "./constants.js";

// Mid-market B2B SaaS support SLA benchmark (wall-clock hours, not
// business-hours-aware — this schema has no timezone/calendar concept to
// hang that on, so treating it as flat wall-clock hours is the deliberate
// simplification here).
const SLA_HOURS_BY_PRIORITY: Record<(typeof TICKET_PRIORITIES)[number], number> = {
  P1: 4,
  P2: 8,
  P3: 48,
  P4: 120,
};

export const createTicketInputSchema = z.object({
  account_id: z.string().min(1, "account_id is required"),
  issue: z.string().min(1, "issue is required"),
  priority: z.enum(TICKET_PRIORITIES),
  category: z.string().min(1, "category is required"),
  assignee: z.string().min(1).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketInputSchema>;

export async function createTicket(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "write:tickets");

  const input = createTicketInputSchema.parse(rawInput);

  const account = await prisma.account.findUnique({ where: { id: input.account_id } });
  if (!account) {
    const err = new Error(`No account found for id ${input.account_id}`);
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const slaHours = SLA_HOURS_BY_PRIORITY[input.priority];
  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ticket = await tx.ticket.create({
      data: {
        accountId: input.account_id,
        issue: input.issue,
        priority: input.priority as (typeof TICKET_PRIORITIES)[number],
        category: input.category,
        slaDeadline,
        assignee: input.assignee ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "ticket",
        entityId: ticket.id,
        accountId: ticket.accountId,
        actor: record.name,
        action: "create_ticket",
        before: Prisma.DbNull,
        after: {
          issue: ticket.issue,
          priority: ticket.priority,
          category: ticket.category,
          status: ticket.status,
          slaDeadline: ticket.slaDeadline.toISOString(),
          assignee: ticket.assignee,
        },
      },
    });

    return ticket;
  });

  logger.info(
    { tool: "create_ticket", actor: record.name, accountId: input.account_id, ticketId: created.id, priority: input.priority },
    "tool call"
  );

  return {
    ticket_id: created.id,
    account_id: created.accountId,
    issue: created.issue,
    priority: created.priority,
    category: created.category,
    status: created.status,
    assignee: created.assignee,
    sla_deadline: created.slaDeadline.toISOString(),
    created_at: created.createdAt.toISOString(),
  };
}
