// Meridian FDE Demo — update_ticket_status
//
// The business-logic tool: enforces a real state machine for ticket status
// transitions instead of trusting the caller (or the model) to send a valid
// next state. Every successful transition also writes an audit log entry.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { authenticate, requireScope } from "../auth/scopes.js";
import { logger } from "../logger.js";

const TICKET_STATUSES = ["OPEN", "INVESTIGATING", "ESCALATED", "RESOLVED", "CLOSED"] as const;

export const updateTicketStatusInputSchema = z.object({
  ticket_id: z.string().min(1, "ticket_id is required"),
  new_status: z.enum(TICKET_STATUSES),
  note: z.string().optional(),
});

export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusInputSchema>;

// The actual business rule: which transitions are legal from each state.
// OPEN can skip straight to CLOSED (e.g. duplicate/invalid ticket) but
// nothing can jump backwards, and CLOSED is terminal.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["ESCALATED", "RESOLVED"],
  ESCALATED: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [], // terminal
};

export class ConflictError extends Error {
  code = "CONFLICT";
  constructor(from: string, to: string) {
    super(`Illegal transition: ${from} -> ${to}`);
  }
}

export async function updateTicketStatus(rawInput: unknown, apiKey: string | undefined) {
  const record = authenticate(apiKey);
  requireScope(record, "write:tickets");

  const input = updateTicketStatusInputSchema.parse(rawInput);

  const ticket = await prisma.ticket.findUnique({ where: { id: input.ticket_id } });
  if (!ticket) {
    const err = new Error(`No ticket found for id ${input.ticket_id}`);
    (err as any).code = "NOT_FOUND";
    throw err;
  }

  const allowedNext = ALLOWED_TRANSITIONS[ticket.status] ?? [];
  if (!allowedNext.includes(input.new_status)) {
    throw new ConflictError(ticket.status, input.new_status);
  }

  const before = { status: ticket.status };

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await tx.ticket.update({
      where: { id: input.ticket_id },
      data: { status: input.new_status as (typeof TICKET_STATUSES)[number] },
    });

    await tx.auditLog.create({
      data: {
        entityType: "ticket",
        entityId: input.ticket_id,
        accountId: result.accountId,
        actor: record.name,
        action: "update_ticket_status",
        before,
        after: { status: input.new_status, note: input.note ?? null },
      },
    });

    return result;
  });

  logger.info(
    { tool: "update_ticket_status", actor: record.name, ticketId: input.ticket_id, from: before.status, to: input.new_status },
    "tool call"
  );

  return {
    ticket_id: updated.id,
    previous_status: before.status,
    new_status: updated.status,
    updated_at: updated.updatedAt.toISOString(),
  };
}