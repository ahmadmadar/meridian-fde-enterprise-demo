// Meridian FDE Demo — seed script
// Run: npx prisma db seed

import { PrismaClient, PlanTier, TicketStatus, TicketPriority, IncidentSeverity, IncidentStatus } from "@prisma/client";

const prisma = new PrismaClient();

const COMPANY_NAMES = [
  "Northwind Logistics", "Vantage Retail Group", "BrightPath Health",
  "Cascade Manufacturing", "Ironclad Financial", "Lumen Media",
  "Pinnacle Insurance", "Redwood Analytics", "Solace Hospitality",
  "Trailhead Education", "Meadowbrook Realty", "Fathom Shipping",
  "Granite Construction", "Horizon Telecom", "Juniper Legal",
  "Kestrel Robotics", "Larkspur Nonprofit", "Marlin Aerospace",
  "Nightingale Care", "Overlook Ventures",
];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

async function main() {
  console.log("Seeding Meridian mock data...");

  const accounts = [];
  for (const name of COMPANY_NAMES) {
    const tier = pick([PlanTier.STARTER, PlanTier.GROWTH, PlanTier.ENTERPRISE]);
    const mrr = tier === "ENTERPRISE" ? randInt(15000, 60000) * 100
              : tier === "GROWTH" ? randInt(2000, 15000) * 100
              : randInt(200, 2000) * 100;

    const account = await prisma.account.create({
      data: {
        name,
        planTier: tier,
        mrr,
        healthScore: randInt(20, 98),
        renewalDate: new Date(Date.now() + randInt(-30, 300) * 86400000),
        seatsLicensed: randInt(5, 500),
        seatsUsed: randInt(3, 480),
      },
    });
    accounts.push(account);

    await prisma.productUsage.create({
      data: {
        accountId: account.id,
        featureFlags: { sso: Math.random() > 0.5, api_access: Math.random() > 0.4, advanced_reporting: Math.random() > 0.6 },
        lastActiveAt: new Date(Date.now() - randInt(0, 45) * 86400000),
        usageTrend: pick(["up", "flat", "down"]),
      },
    });
  }

  // Tickets — some deliberately SLA-risky
  const categories = ["billing", "integration", "performance", "bug", "feature_request", "onboarding"];
  for (let i = 0; i < 60; i++) {
    const account = pick(accounts);
    const priority = pick([TicketPriority.P1, TicketPriority.P2, TicketPriority.P3, TicketPriority.P4]);
    const status = pick([TicketStatus.OPEN, TicketStatus.INVESTIGATING, TicketStatus.ESCALATED, TicketStatus.RESOLVED, TicketStatus.CLOSED]);
    await prisma.ticket.create({
      data: {
        accountId: account.id,
        issue: `${pick(categories)} issue reported by ${account.name}`,
        priority,
        status,
        category: pick(categories),
        slaDeadline: new Date(Date.now() + randInt(-3, 10) * 86400000), // some already past due
        assignee: status === "OPEN" ? null : pick(["dana.k", "leo.m", "priya.s"]),
      },
    });
  }

  // One active incident affecting several accounts
  const incident = await prisma.incident.create({
    data: {
      title: "API latency degradation — us-east region",
      severity: IncidentSeverity.SEV2,
      status: IncidentStatus.INVESTIGATING,
    },
  });
  const affected = accounts.sort(() => 0.5 - Math.random()).slice(0, 6);
  for (const account of affected) {
    await prisma.incidentAccount.create({
      data: { incidentId: incident.id, accountId: account.id },
    });
  }

  console.log(`Seeded ${accounts.length} accounts, 60 tickets, 1 active incident affecting ${affected.length} accounts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
