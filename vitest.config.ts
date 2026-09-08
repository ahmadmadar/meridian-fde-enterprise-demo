// Meridian FDE Demo — vitest config
//
// Loads .env.test before anything else so the whole vitest process
// (config evaluation, globalSetup, and every test worker) sees the test
// database's DATABASE_URL rather than the dev .env's — this file is the
// single place that env gets loaded, so test/global-setup.ts and
// test/fixtures.ts don't need to re-parse it themselves.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const parsed = loadEnv({ path: path.resolve(__dirname, ".env.test"), quiet: true }).parsed ?? {};

export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    env: parsed,
    hookTimeout: 30_000,
    testTimeout: 15_000,
    // Every test file shares one real Postgres test DB and one spawned
    // server instance — that's the deliberate design (real HTTP + real
    // DB, not mocks/isolated schemas per worker). resetDb() in each
    // file's beforeEach would otherwise race across files running in
    // parallel, truncating tables mid-test for another file. Serializing
    // file execution is the correct fix for a suite this size, not
    // heavier per-worker isolation infra this demo doesn't need.
    fileParallelism: false,
  },
});
