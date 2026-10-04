#!/usr/bin/env node
"use strict";
// Opt-in only. This runner never logs credentials, deploys a Worker, changes
// Cloudflare configuration, or starts workerd. Four rooms, no load testing.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const relay = process.env.BACKFIRE_PUBLIC_RELAY;
if (!relay) {
  console.error("Set BACKFIRE_PUBLIC_RELAY to the authorized HTTPS relay URL, then run node tools/test-online-public.cjs. BACKFIRE_PUBLIC_TEST_PORT defaults to 8080 and must be free and allowed by that relay. Existing Playwright + Chromium are required; set NODE_PATH if needed.");
  process.exitCode = 2;
} else {
  let url;
  try { url = new URL(relay); } catch (_) {}
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    console.error("BACKFIRE_PUBLIC_RELAY must be an HTTPS URL without credentials, query or fragment."); process.exitCode = 2;
  } else {
    console.log("Opt-in public relay acceptance: " + url.origin + " (4 rooms, 5 display samples, one real 30-second host interruption; no deployment/configuration changes).");
    const result = spawnSync(process.execPath, ["--test", "tests/online-session-ui.test.js"], {
      cwd: path.resolve(__dirname, ".."), env: { ...process.env, REQUIRE_UI: "1" }, stdio: "inherit"
    });
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status == null ? 1 : result.status;
  }
}
