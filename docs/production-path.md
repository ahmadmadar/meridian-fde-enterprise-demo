# Production path

This is my own take on the gap between what I actually built and what a
real production system for a company like Meridian would need. Nothing
here is implemented, it's just me thinking out loud about where the demo
holds up and where it's faking it, and why.

## What holds up versus what's a placeholder

Some of what I built is a real pattern that would just need to grow, not
get rebuilt. Some of it is standing in for something much bigger, not a
smaller version of the real thing. Here's how I'd sort it.

**Holds up as-is:**

| Pattern | Why |
|---|---|
| One fresh server instance per request | This started as a fix for a crash under concurrent traffic, not a scaling decision. But it turned out to be the right fix: no shared state between requests, so it's safe to run several copies of this server at once behind a load balancer. The catch is the free database behind it (below) would bottleneck before this pattern ever would. |
| Every tool follows the same steps | Validate input, check who's calling, check what they're allowed to do, query the database, return a clean result. Tool 9 or tool 50 would follow the same steps. It also means future work like real logins only has to change one or two spots, not every tool. |
| Clear, categorized errors instead of generic failures | "Not found," "not allowed," "invalid input," etc. are already distinct, structured responses. One known gap: some bad input gets caught earlier by the underlying toolkit before my own error-handling gets a chance to run. |
| Every write is logged in the same step as the change itself | So a rejected write can never leave a half-written audit trail behind. That part's solid. What would need to grow is how long that history gets kept and how fast it can be searched once it's large, not the logging itself. |
| Ticket status can only move between specific allowed states | Enforced by the server, not just trusted. The same idea would carry over cleanly to other things that need a status. It's a pattern to copy today, though, not shared code to reuse yet. |
| Each API key only does what it's explicitly allowed to do | Checked by the server on every call, including one key that's intentionally a superuser. That's a legitimate design choice. What's missing is any idea of an individual person behind the key, see below. |

**Standing in for something much bigger:**

| Placeholder | What it's really hiding |
|---|---|
| Two fixed API keys, one for the AI agent and one for the dashboard | This isn't a lightweight version of real user accounts, it's a stand-in for the whole idea. Nothing in this system knows there's more than one person using it. Even the audit trail only records which *key* made a change, not which *person*, so it's only as trustworthy as the identity behind it, which is fake right now. |
| Only one company exists in the data model | Meridian isn't just the only company I seeded data for, it's hardcoded as the only company that could ever exist. Supporting real multiple companies later touches almost every part of the code, not just one new column. |
| A free-tier database with no backups, no extra copies, nothing beyond the basics | This is the real bottleneck. The app itself is built to scale (see above); the database behind it isn't. |
| No limit on how many requests a client can send | A real gap I never got to, not a deliberate cut. Worth noting this matters more here than on a typical app, since the "user" is an AI that could call tools in a rapid loop if something went wrong. |
| No way to trace one chain of tool calls through the logs | If a request kicks off several tool calls in sequence and one fails partway through, there's currently no shared ID connecting them in the logs. Fixing this isn't obvious either, since nothing today marks separate calls as belonging to the same request in the first place. |
| Secret keys just live as env vars in Render's dashboard | Fine for a single project, not a real rotation policy. This already almost went wrong once: a key briefly ended up in a file meant to be committed to the repo, caught just before it was pushed (see the engagement log, Day 6). |

## Identity and auth

**Today:** there are exactly two API keys, both long-lived, both typed
directly into a config file. One is a deliberate superuser, a real
design choice, the other is read-only. Neither one represents a person.
There's no login, no expiry, no way to tell two different humans apart
if they both used the same key. The audit log already records "who made
this change," but all it can actually say is which *key* was used, like
`claude-agent-prod`, not which person was sitting behind it.

**What would need to change:** individual accounts for real people, and
realistically that means plugging into whatever identity system a client
company already uses (Okta, Google Workspace, Microsoft) rather than
building a login system from scratch. Since this is now a multi-tenant
platform, each client's employees need to be tied to that client, so
identity and "which company" end up linked, not two separate problems.
Each person would get a role, support agent, ops manager, admin, that
maps onto roughly the same permissions the two keys draw on today, just
assigned per person instead of per shared secret. Keys/tokens would need
real expiry and rotation instead of living forever in a config file. And
because the actual "caller" here is often an AI acting on a person's
behalf (someone typing a request into Claude Desktop), the system would
need a way to carry "this AI call is happening for this specific
person" through to the server, not just "this is the agent's shared
key," or the audit trail keeps being honest-looking but not actually
accountable to a person.

**Why it matters:** the audit log is one of the parts of this project I'd
call genuinely production-grade, but only if it can say who really did
something. Right now it can't. Real B2B customers, especially anywhere
support/incident data is involved, expect individual accountability, not
"someone on the team used the shared key." That expectation shows up
directly in security reviews and compliance checklists (SOC 2 audits ask
exactly this question), not just as a nice-to-have.

## Client integration at scale

**Today:** the only way to actually use these tools live is Claude
Desktop, a single local install per person, with the server's address
and API key pasted by hand into a personal config file. There's no team
admin controlling who's connected, and no place to use this other than
Claude Desktop itself, not embedded anywhere a team already works. Fine
for one demo, not for how a real company would roll this out to a team.

**What would need to change:** the auth mechanism itself would need to
move off a static header. When I was debugging the connection earlier in
this project, the MCP client actually tried "Discovering OAuth server
configuration..." before falling back to our custom header, so the
ecosystem already expects real, per-person sign-in here, we're just not
implementing it yet. In practice that likely means each employee
authenticating through their own company's login rather than everyone
sharing one pasted key, with an admin managing the connection centrally
instead of every laptop having its own copy.

But the auth mechanism is the smaller half of this. The bigger question
is where this should actually live, and it shouldn't be a brand-new
chat app nobody asked for. It should show up inside the places a team
already works, matched to what each tool actually does. The incident
tools (`list_active_incidents`, `check_incident_impact`) fit naturally
into a Slack or Teams bot, living in the same channel a real ops team
already uses to coordinate a live SEV1 or SEV2. The rest of the tools
(`search_tickets`, `get_account_360`, `create_ticket`,
`update_ticket_status`, `get_renewal_risk`) are things a support or CS
agent would want right inside the CRM or support platform they already
work in all day (Zendesk, Salesforce), as a sidebar, not a second app to
switch to.

That also means revisiting, not reversing, the earlier call not to
build chat into the dashboard (see `docs/architecture.md`, "Chat: scoped
out"). That decision was right for what the demo needed to prove: Claude
Desktop had already shown the chained tool-call trick worked live, so a
second chat surface in the dashboard would have repeated that proof
instead of adding to it, for real added risk. But once real identity and
multiple client companies exist, someone still needs an actual, everyday
way to use these tools. The honest answer isn't "build that missing
piece into the dashboard after all." It's that the dashboard keeps doing
exactly what it already does, a read-only visibility tool, permanently,
while the agent capability lives entirely in the Slack/CRM integration
instead. Two different jobs, staying two different surfaces.

Governance has to grow alongside all of this. The scope system already
built (see `docs/architecture.md`'s scope model) is the right
foundation, it just needs to check a real person's role instead of a
static key's scope list. But once any authorized employee can trigger a
write from a Slack message or a CRM sidebar, not just a single trusted
demo key, I'd want an explicit human-confirmation step (something like a
confirm button on the same message) before a higher-risk write like
`update_ticket_status` or `create_ticket` actually executes, rather than
full autonomy the moment someone's role technically allows it.

**Why it matters:** this is the actual FDE/SE part of the job, more than
any of the backend sections above. The interesting question was never
"can this be built as a chat app." It's figuring out where a working
capability actually belongs inside a company's real workflow, and what
has to change, auth, governance, a confirmation step before a write,
once it's available to a whole team instead of one demo key.

## Multi-tenancy

I'm treating the "real" version of this as a platform that gets sold to
many client companies, not just Meridian, each with their own data kept
separate from everyone else's. That's the standard shape for this kind
of B2B tool, and it's the version of the problem actually worth reasoning
through.

**Today:** there's exactly one company. Meridian isn't just the only
company I loaded sample data for, it's the only company the system knows
how to think about. Nothing in the database, the tools, or the API keys
has any concept of "which company does this belong to."

**What would need to change:** every table that holds company-specific
data (accounts, tickets, incidents, usage, the audit log) needs a company
ID on it, and every single database query in every tool needs to filter
by that company ID, not just the one it's already filtering by (an
account, a ticket, whatever). Right now, for example, `get_account_360`
just checks that the account ID exists. In a multi-tenant world, it also
has to check that account belongs to the company making the request, or
one client could pull up another client's account by ID. That's true for
basically every tool, not just that one. I'd also want the database
itself enforcing that separation as a backstop (Postgres has a feature
for this, row-level security), not just trusting that every tool
remembered to add the right filter. And the API keys/login system would
need to carry "which company is this" alongside "what is this caller
allowed to do," since right now a key only carries the latter.

**Why it matters:** this isn't really a feature, it's a data-breach
concern wearing a feature's clothes. Miss one filter in one tool and a
client could see another client's confidential support tickets or
revenue numbers. For a company selling into other companies, that's the
kind of mistake that ends the relationship, not just a bug ticket.

## Infrastructure and scaling

**Today:** everything runs as one Docker container on Render's free
tier, next to a free Postgres instance with no backups and no extra
copies. I picked Render over Fly.io specifically because it didn't
require a card for the free tier, a completely reasonable call for a
portfolio project, but worth being honest that it was a cost decision,
not a production-readiness one. Database migrations run automatically
every time the container boots, which I chose because Render's free tier
has no shell access to run them separately, but it means a broken
migration could take down a live restart, not just block a deploy. The
free tier also spins down when idle, so the very first request after a
quiet period takes something like 30 seconds instead of under one.

**What would need to change:** a few things, and they're not all the
same kind of change. Getting off the free tier fixes the cold-start
problem and gets real backups, but the more interesting one is
connections. The server is already built the right way for scaling,
each request gets a clean, independent server instance with no shared
memory between requests, so running several copies behind a load
balancer is safe. But every one of those copies opens its own pool of
database connections, and a single free Postgres instance has a low
ceiling on how many connections it'll accept at once. Running more
copies of the server would hit that ceiling fast. The real fix is a
connection pooler sitting between the app and the database, and probably
a read replica too, since a good chunk of what this system does
(searching tickets, checking renewal risk, reading the audit log) is
read-heavy and shouldn't have to compete with writes for the same
connections. I'd also want migrations to run as their own step, tested
against a staging copy first, instead of coupled to every boot.

**Why it matters:** the app code is the part I'd feel good about handing
to a production team as-is. It's the ground underneath it, one database
with no ceiling protection and no redundancy, that would actually break
first under real traffic, and it would break in the most unglamorous way
possible: connections silently running out, not a dramatic outage with
an obvious cause.

## Observability

**Today:** logs are structured (each line is a real JSON object, not
just a text message), but they only exist locally, whatever Render
happens to capture from the container's output. There's no centralized
place to search them, and more importantly, there's no ID connecting log
lines that belong together. Not even within a single tool call, and
definitely not across a chain of them. That last part is the real gap:
when the demo runs `list_active_incidents`, then `check_incident_impact`,
then `get_account_360`, those show up server-side as three completely
unrelated requests. Nothing marks them as one logical sequence, so if
something breaks on the second call, I can't reconstruct which first
call led to it just from the logs.

**What would need to change:** the easy part is giving every incoming
request its own ID and attaching it to every log line that request
produces, that's a small change. The harder part is the multi-call
chain, because the server is stateless on purpose (that's the same
design that makes it safe to run multiple copies of it), so it has no
built-in concept of "these three calls belong to the same conversation."
Solving that actually depends on the calling side, Claude Desktop or
whatever client is making the calls, generating an ID once and passing
it along with every call in that conversation, with the server reading
and logging that same ID each time. That's not purely something I can
fix in this codebase alone. On top of that, I'd want real log search
(something like Grafana or Datadog instead of scrolling through Render's
console) and ideally actual tracing, so a chain of calls shows up as one
visual timeline instead of three log lines I have to line up by hand.

**Why it matters:** there's a specific irony here worth naming. This
system exists to help a support/ops team investigate incidents faster.
Right now, if it has its own incident, a chained tool call failing
partway through, there's no equivalent tooling to investigate that. I'd
be doing exactly what this product is meant to save someone else from
doing: piecing together what happened by hand.

## Security and secrets

**Today:** the two API keys and the database connection string are all
plain environment variables, a gitignored `.env` file locally, and typed
directly into Render's (and Vercel's) dashboard in production. The keys
were generated with a proper random command, not made up by hand, and
recorded in a password manager rather than any file in the repo. There's
already been one real near-miss, not a hypothetical one: the dashboard's
read-only key briefly got pasted into a file meant to be committed
instead of the gitignored one, and it was only caught because I happened
to review the diff before pushing.

**What would need to change:** a real secrets manager instead of pasting
values into a hosting provider's dashboard by hand, so there's one
source of truth instead of the same key living in Render, Vercel, and a
password manager separately. An actual rotation process: right now,
replacing a compromised key means manually generating a new one and then
updating it in every place it's used, one at a time, with no way to do
that without some window where things are inconsistent. And automated
scanning that catches a secret in a commit before a human has to notice
it, since the one near-miss so far was caught by me paying attention, not
by any actual safeguard. Being multi-tenant would add one more thing:
each client's secrets need to stay isolated from every other client's,
not just from the codebase.

**Why it matters:** that near-miss happened under the easiest possible
conditions, two keys, one repo, one person reviewing. That's as good as
it gets for catching a mistake by hand. A real system has more secrets,
more repos, and more people touching them, and needs a safety net that
doesn't rely on someone happening to notice, plus a rotation plan that
doesn't leave things half-updated while it's underway.

## CI/CD

**Today:** there isn't any. No pipeline runs when I push, nothing checks
that the type-checker passes or that the 45-test suite is green before
code goes anywhere. Pushing to `main` through GitHub Desktop and having
Render redeploy automatically are the same action. The tests and type
checks are real, but they only run if I remember to run them myself,
first, before pushing.

**What would need to change:** a pipeline that runs automatically on
every push or pull request, spins up its own throwaway database, runs
the type checker and the full test suite against it, and only allows a
merge to `main` if both pass. Right now getting the test suite running
at all requires a database I set up by hand locally, that would need to
become something CI creates fresh every single run. I'd also want a
staging environment, a second, non-public deployment that changes land
on first, so a broken change gets caught there instead of on the actual
public URL. That connects directly to the migration risk from the
infrastructure section: a staging environment is exactly where a bad
migration should fail loudly before it ever gets the chance to break a
live restart.

**Why it matters:** stepping back, this is the same theme running
through basically every section above. Every "what would need to
change" comes down to replacing something I do by hand, remembering to
test, remembering to review a diff for secrets, remembering to add a
tenant filter, with something the system enforces automatically. That
holds up fine solo. It's exactly the kind of thing that stops holding up
the moment more than one person is touching this, which is the whole
point of a real production system.
