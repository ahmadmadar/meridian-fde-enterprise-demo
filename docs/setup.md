# Starter slice — how to wire this in

This is the first working end-to-end vertical slice: DB → one tool
(`get_account_360`) → auth → server. Drop these files into your repo at
the paths shown (they already match the structure in your project
guideline), then:

```bash
# 1. Start Postgres (adjust docker-compose.yml if you haven't made one yet - Created now)
docker compose up -d

# 2. Install deps
npm install

# 3. Copy env
cp .env.example .env

# 4. Create tables + generate client
npx prisma migrate dev --name init

# 5. Seed mock data
npm run db:seed

# 6. Run the server
npm run dev
```

Then test it directly (before wiring up any agent) with a raw request:

```bash
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-api-key: demo-agent-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_account_360","arguments":{"account_id":"<paste an id from your seeded data>"}}}'
```

Grab a real `account_id` by checking your DB with TablePlus/DBeaver, or add
a quick `console.log` in the seed script temporarily.

# Used Prisma studio instead of TablePlus/DBeaver
```bash
  npx prisma studio
  ```

  Open in another editor, will open up a browser tab at http://localhost:5555 with a full visual editor for every table.

## What to build next, in order

1. Add `search_tickets`, `create_ticket`, `update_ticket_status` (with the
   state machine validation), `check_incident_impact`, `get_renewal_risk`,
   `get_audit_log` — same pattern as `get_account_360`: schema → auth →
   query → mapped errors
2. Add the audit log write inside every write-tool (`create_ticket`,
   `update_ticket_status`) — this is what makes `get_audit_log` meaningful
3. Wire this server up in Claude Desktop as a remote connector (Settings →
   Connectors → Add custom connector → point at your deployed `/mcp` URL)
   and run your demo script live
4. Log this session in `docs/ai-assisted-delivery.md` — what Claude Code
   generated here, what you changed, anything it got wrong

## Note on the state machine (for `update_ticket_status`, when you build it)

Enforce this transition map server-side, reject anything not listed with a
`CONFLICT` error code:

```
OPEN          -> INVESTIGATING, CLOSED
INVESTIGATING -> ESCALATED, RESOLVED
ESCALATED     -> RESOLVED
RESOLVED      -> CLOSED
CLOSED        -> (terminal)
```

## Deploying to Render

The MCP server deploys via the `render.yaml` Blueprint at the repo
root — it declares a Docker-runtime web service (free plan, `/health`
check) and a free Postgres instance.

1. Push `render.yaml` (and any pending server changes) to `main`.
2. In the Render dashboard: **New → Blueprint**, select this
   repo/branch, review the resource preview, then **Apply**.
3. Render provisions Postgres first, then builds the web service from
   the `Dockerfile`. Schema migrations run automatically on boot
   (`npx prisma migrate deploy` is baked into the container `CMD`) —
   no manual migration step needed.
4. Fill in `MCP_KEY_AGENT` and `MCP_KEY_DASHBOARD` — these are
   `sync: false` in the blueprint, so Render prompts for them directly
   rather than reading a value from the file. Generate real values
   with `openssl rand -hex 32`, save them in a password manager (not
   any repo file, gitignored or not), and paste with no surrounding
   quotes or trailing newline.
5. Seed data once, manually — the free tier has no Shell access, so
   this runs from your machine against the database's **External
   Connection String** (Postgres service → Info tab):
   ```bash
   DATABASE_URL="<external connection string>" npm run db:seed
   ```
6. Verify:
   ```bash
   curl https://<your-service>.onrender.com/health
   curl -X POST https://<your-service>.onrender.com/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -H "x-api-key: <your MCP_KEY_AGENT value>" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```

**Free-tier caveats:** the web service spins down after 15 minutes
idle and cold-starts (~30-60s) on the next request. The free Postgres
instance expires 30-90 days after creation and needs recreating +
re-seeding when it does — see the note in `CLAUDE.md`.
