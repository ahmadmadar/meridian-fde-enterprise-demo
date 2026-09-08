// Meridian FDE Demo — deterministic test fixtures
//
// prisma/seed.ts is randomized (Math.random() throughout, no fixed
// seed) — fine for local dev/demo data, but useless as a base for
// automated tests that need exact expected result sets. These helpers
// create small, known rows directly instead, so every test controls
// its own data rather than depending on whatever the bulk seed produced
// this run. resetDb() gives each test (or test file) a clean slate.
//
// Reuses the same Prisma singleton the server itself uses
// (src/db/client.ts) — vitest.config.ts loads .env.test before this
// module is ever imported, so that singleton is already pointed at the
// test database by the time it's constructed.

import { prisma } from "../src/db/client.js";
import type {
  Account,
  Ticket,
  Incident,
  ProductUsage,
  PlanTier,
  TicketStatus,
  TicketPriority,
  IncidentSeverity,
  IncidentStatus,
} from "@prisma/client";

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "AuditLog", "IncidentAccount", "Ticket", "ProductUsage", "Incident", "Account" CASCADE;`
  );
}

let counter = 0;
function unique(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export async function createAccount(
  overrides: Partial<{
    name: string;
    planTier: PlanTier;
    mrr: number;
    healthScore: number;
    renewalDate: Date;
    seatsLicensed: number;
    seatsUsed: number;
  }> = {}
): Promise<Account> {
  return prisma.account.create({
    data: {
      name: overrides.name ?? `Test Account ${unique()}`,
      planTier: overrides.planTier ?? "GROWTH",
      mrr: overrides.mrr ?? 500_000,
      healthScore: overrides.healthScore ?? 75,
      renewalDate: overrides.renewalDate ?? new Date(Date.now() + 30 * 86_400_000),
      seatsLicensed: overrides.seatsLicensed ?? 50,
      seatsUsed: overrides.seatsUsed ?? 30,
    },
  });
}

export async function createTicket(
  accountId: string,
  overrides: Partial<{
    issue: string;
    priority: TicketPriority;
    status: TicketStatus;
    category: string;
    slaDeadline: Date;
    assignee: string | null;
  }> = {}
): Promise<Ticket> {
  return prisma.ticket.create({
    data: {
      accountId,
      issue: overrides.issue ?? "Test issue",
      priority: overrides.priority ?? "P3",
      status: overrides.status ?? "OPEN",
      category: overrides.category ?? "bug",
      slaDeadline: overrides.slaDeadline ?? new Date(Date.now() + 48 * 3_600_000),
      assignee: overrides.assignee ?? null,
    },
  });
}

export async function createProductUsage(
  accountId: string,
  overrides: Partial<{
    featureFlags: Record<string, boolean>;
    lastActiveAt: Date;
    usageTrend: string;
  }> = {}
): Promise<ProductUsage> {
  return prisma.productUsage.create({
    data: {
      accountId,
      featureFlags: overrides.featureFlags ?? { sso: false, api_access: false, advanced_reporting: false },
      lastActiveAt: overrides.lastActiveAt ?? new Date(),
      usageTrend: overrides.usageTrend ?? "flat",
    },
  });
}

export async function createIncident(
  overrides: Partial<{
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    startedAt: Date;
    resolvedAt: Date | null;
  }> = {},
  affectedAccountIds: string[] = []
): Promise<Incident> {
  const incident = await prisma.incident.create({
    data: {
      title: overrides.title ?? "Test incident",
      severity: overrides.severity ?? "SEV2",
      status: overrides.status ?? "INVESTIGATING",
      startedAt: overrides.startedAt ?? new Date(),
      resolvedAt: overrides.resolvedAt ?? null,
    },
  });

  if (affectedAccountIds.length > 0) {
    await prisma.incidentAccount.createMany({
      data: affectedAccountIds.map((accountId) => ({ incidentId: incident.id, accountId })),
    });
  }

  return incident;
}
