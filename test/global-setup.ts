// Meridian FDE Demo — vitest global setup
//
// Runs once before the whole test run: applies the Prisma schema to the
// test DB (idempotent — safe even if already applied), then spawns the
// actual server (src/server.ts) as a child process against that DB so
// tests exercise the real HTTP/SSE transport and the real MCP SDK
// validation layer, not an in-process shortcut that would bypass both.
// Torn down after the run via the exported teardown().
//
// vitest.config.ts loads .env.test into process.env before this file
// runs (globalSetup executes in the same root process as the config),
// so process.env already has the test DATABASE_URL/PORT/keys here.

import { execSync, spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

let serverProcess: ChildProcess | undefined;

function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server did not start listening on port ${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

export async function setup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const port = Number(process.env.PORT ?? 3002);

  serverProcess = spawn("npx", ["tsx", "src/server.ts"], {
    env: process.env,
    stdio: "inherit",
  });

  await waitForPort(port);
}

export async function teardown() {
  serverProcess?.kill();
}
