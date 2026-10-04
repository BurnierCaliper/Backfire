"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { createLocalRelayServer } = require("../relay/local-server.cjs");
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
const pw = playwright();
let browser;
test.before(async () => {
  try { if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); }
  catch (error) { if (process.env.REQUIRE_UI === "1") throw error; }
});
test.after(async () => { if (browser) await browser.close(); });

test("D3 real relay browsers: private traffic, mobile viewport, 30-second host interruption and saved-token resume", { timeout: 90000 }, async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const script = fs.readFileSync(path.resolve(__dirname, "../relay-transport.js"));
  const website = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/relay-transport.js" ? "application/javascript" : "text/html");
    res.end(req.url === "/relay-transport.js" ? script : '<!doctype html><meta charset="utf-8"><title>Relay integration</title><script src="/relay-transport.js"></script>');
  });
  await new Promise(resolve => website.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => website.close(resolve)));
  const origin = "http://127.0.0.1:" + website.address().port;
  const server = await createLocalRelayServer({ origins: [origin] }); t.after(() => server.close());
  const contexts = [], pages = [], errors = [], frames = [];
  for (const width of [1440, 1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } }); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", error => errors.push(error.message));
    page.on("websocket", ws => { for (const event of ["framesent", "framereceived"]) ws.on(event, frame => { let kind; try { kind = JSON.parse(frame.payload).kind; } catch (_) {} frames.push({ event, kind, bytes: Buffer.byteLength(frame.payload) }); }); });
    await page.goto(origin);
  }
  t.after(async () => { for (const context of contexts) await context.close(); });
  const [gm, alice, bob] = pages;
  const roomCode = await gm.evaluate(async url => {
    window.endpoint = await RelayTransport.createHost({ url, name: "GM", protocol: 1, build: "browser-test", autoReconnect: false });
    localStorage.setItem("saved-transport", JSON.stringify(endpoint.credentials()));
    window.received = []; endpoint.onMessage((message, from) => received.push({ message, from }));
    await endpoint.setReady(true); return endpoint.identity.roomCode;
  }, server.url);
  for (const [page, name] of [[alice, "Alice"], [bob, "Bob"]]) await page.evaluate(async options => {
    window.endpoint = await RelayTransport.join({ ...options, protocol: 1, build: "browser-test", autoReconnect: false });
    localStorage.setItem("saved-transport", JSON.stringify(endpoint.credentials()));
    window.received = []; endpoint.onMessage((message, from) => received.push({ message, from }));
  }, { url: server.url, roomCode, name });
  const aliceId = await alice.evaluate(() => endpoint.identity.id);
  await alice.evaluate(() => endpoint.send({ action: "move", sender: "host" }));
  await gm.waitForFunction(() => received.length === 1);
  assert.equal(await gm.evaluate(() => received[0].from), aliceId);
  await gm.evaluate(id => endpoint.send({ private: "GM to Alice" }, id), aliceId);
  await alice.waitForFunction(() => received.length === 1);
  await gm.evaluate(() => endpoint.send({ public: "all players" }));
  await bob.waitForFunction(() => received.length === 1);
  assert.deepEqual(await bob.evaluate(() => received.map(m => m.message)), [{ public: "all players" }]);
  await gm.evaluate(id => endpoint.send({ resync: "中文🙂".repeat(30000) }, id), aliceId);
  await alice.waitForFunction(() => received.length === 3);
  assert.equal(await alice.evaluate(() => received[2].message.resync.length), "中文🙂".repeat(30000).length);

  const disconnectedAt = Date.now();
  await gm.evaluate(() => endpoint.close());
  for (const page of [alice, bob]) await page.waitForFunction(() => endpoint.status().paused && !endpoint.status().hostOnline);
  assert.match(await alice.evaluate(async () => { try { await endpoint.send({ action: "forbidden while paused" }); return "sent"; } catch (error) { return error.message; } }), /暂停/);
  // Real wall-clock interruption; no mocked clock or fake WebSocket. The host
  // page is reloaded, so only the explicitly saved token can restore its seat.
  await gm.reload();
  while (Date.now() - disconnectedAt < 30000) await gm.waitForTimeout(Math.max(20, 30000 - (Date.now() - disconnectedAt)));
  assert.ok(Date.now() - disconnectedAt >= 30000);
  await gm.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem("saved-transport"));
    window.endpoint = await RelayTransport.resumeHost({ ...saved, hostToken: saved.token, autoReconnect: false });
    window.received = []; endpoint.onMessage((message, from) => received.push({ message, from }));
  });
  await alice.waitForFunction(() => endpoint.status().hostOnline);
  assert.equal(await alice.evaluate(() => endpoint.status().paused), true);
  await gm.evaluate(() => endpoint.setReady(true));
  await alice.waitForFunction(() => !endpoint.status().paused);
  await alice.evaluate(() => endpoint.send({ afterReconnect: true })); await gm.waitForFunction(() => received.length === 1);
  assert.equal(await gm.evaluate(() => received[0].from), aliceId);

  const bobIdentity = await bob.evaluate(() => endpoint.identity);
  await bob.evaluate(() => endpoint.close()); await bob.reload();
  await bob.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem("saved-transport"));
    window.endpoint = await RelayTransport.join({ ...saved, name: "Cannot impersonate a new nickname", resumeToken: saved.token, autoReconnect: false });
    endpoint.onMessage(() => {});
  });
  assert.deepEqual(await bob.evaluate(() => endpoint.identity), bobIdentity);
  assert.equal(await bob.evaluate(() => innerWidth), 390);
  assert.ok(frames.some(frame => frame.kind === "chunk" && frame.event === "framesent"));
  assert.ok(frames.some(frame => frame.kind === "chunk" && frame.event === "framereceived"));
  assert.ok(Math.max(...frames.map(frame => frame.bytes)) <= 50 * 1024);
  assert.deepEqual(errors, []);
  for (const page of pages) await page.evaluate(() => endpoint.close());
});
