// Meridian FDE Demo — MCP server entrypoint
//
// Exposes Meridian's simulated internal systems (accounts, tickets, usage,
// incidents) as MCP tools over a remote HTTP/SSE transport, so it can be
// added directly as a connector in Claude Desktop / claude.ai — not just
// called from a hand-rolled client.

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ZodError } from "zod";
import { getAccountInputSchema, getAccount360 } from "./tools/get_account_360.js";
import { updateTicketStatusInputSchema, updateTicketStatus } from "./tools/update_ticket_status.js";
import { searchTicketsInputSchema, searchTickets } from "./tools/search_tickets.js";
import { logger } from "./logger.js";

const server = new McpServer({ name: "meridian-ops", version: "0.1.0" });

// --- Tool registration ---------------------------------------------------
// Each additional tool (search_tickets, create_ticket, check_incident_impact,
// get_renewal_risk, get_audit_log) follows this same shape: zod schema in,
// auth+scope check, prisma query, mapped errors out.

server.registerTool(
  "get_account_360",
  {
    description:
      "Get a full cross-system view of one account: billing, health, product usage, open tickets, and active incident exposure.",
    inputSchema: getAccountInputSchema.shape,
  },
  async (input, extra) => {
    const apiKey = extra?.requestInfo?.headers?.["x-api-key"] as string | undefined;
    try {
      const result = await getAccount360(input, apiKey);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return mapErrorToToolResult(err);
    }
  }
);

server.registerTool(
  "update_ticket_status",
  {
    description:
      "Update a support ticket's status. Enforces the valid state machine (OPEN -> INVESTIGATING/CLOSED, INVESTIGATING -> ESCALATED/RESOLVED, ESCALATED -> RESOLVED, RESOLVED -> CLOSED) and rejects illegal transitions with a CONFLICT error.",
    inputSchema: updateTicketStatusInputSchema.shape,
  },
  async (input, extra) => {
    const apiKey = extra?.requestInfo?.headers?.["x-api-key"] as string | undefined;
    try {
      const result = await updateTicketStatus(input, apiKey);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return mapErrorToToolResult(err);
    }
  }
);

server.registerTool(
  "search_tickets",
  {
    description:
      "Search support tickets across accounts, filtered by SLA risk (breached/at_risk/ok, at_risk = due within 24h), priority, category, status, or account. Defaults to active tickets (OPEN/INVESTIGATING/ESCALATED) unless a status is specified.",
    inputSchema: searchTicketsInputSchema.shape,
  },
  async (input, extra) => {
    const apiKey = extra?.requestInfo?.headers?.["x-api-key"] as string | undefined;
    try {
      const result = await searchTickets(input, apiKey);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return mapErrorToToolResult(err);
    }
  }
);

// --- Error mapping ---------------------------------------------------------
// Real integrations return structured, distinguishable errors — not a
// generic 500 — so the calling agent (and a human debugging it later) can
// tell a bad request apart from a missing record apart from an auth failure.

function mapErrorToToolResult(err: unknown) {
  let code = "INTERNAL_ERROR";
  let message = "Unexpected server error";

  if (err instanceof ZodError) {
    code = "VALIDATION_ERROR";
    message = err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
  } else if (err instanceof Error) {
    code = (err as any).code || code;
    message = err.message;
  }

  logger.warn({ code, message }, "tool call failed");

  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

// --- HTTP transport ----------------------------------------------------

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "Meridian MCP server listening");
});