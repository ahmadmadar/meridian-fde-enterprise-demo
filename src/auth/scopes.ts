// Meridian FDE Demo — API key auth + scope enforcement
//
// Real integrations don't trust the model or the caller — every tool call
// carries a scope, and the server enforces it before touching the DB.

export type Scope = "read:accounts" | "read:tickets" | "write:tickets" | "read:incidents" | "admin";

interface ApiKeyRecord {
  name: string;
  scopes: Scope[];
}

// In a real deployment these come from env vars / a secrets manager, not source.
// No fallback values — if an env var is missing, that key simply won't exist,
// so auth fails closed instead of silently accepting a known string.
if (!process.env.MCP_KEY_AGENT || !process.env.MCP_KEY_DASHBOARD) {
  throw new Error(
    "Missing required env vars: MCP_KEY_AGENT and MCP_KEY_DASHBOARD must both be set"
  );
}

const API_KEYS: Record<string, ApiKeyRecord> = {
  [process.env.MCP_KEY_AGENT]: {
    name: "claude-agent-prod",
    scopes: ["read:accounts", "read:tickets", "write:tickets", "read:incidents", "admin"],
  },
  [process.env.MCP_KEY_DASHBOARD]: {
    name: "dashboard-readonly",
    scopes: ["read:accounts", "read:tickets", "read:incidents"],
  },
};

export class ScopeError extends Error {
  code = "FORBIDDEN_SCOPE";
  constructor(required: Scope) {
    super(`Missing required scope: ${required}`);
  }
}

export function authenticate(apiKey: string | undefined): ApiKeyRecord {
  if (!apiKey || !API_KEYS[apiKey]) {
    const err = new Error("Invalid or missing API key");
    (err as any).code = "UNAUTHORIZED";
    throw err;
  }
  return API_KEYS[apiKey];
}

export function requireScope(record: ApiKeyRecord, scope: Scope) {
  if (!record.scopes.includes(scope) && !record.scopes.includes("admin" as Scope)) {
    throw new ScopeError(scope);
  }
}
