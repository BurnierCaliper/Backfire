// Local tests run the same Worker/SQLite Durable Objects in workerd. This module
// is a development helper only; game.html never imports it or any npm package.
"use strict";
const path = require("node:path");
async function createLocalRelayServer(options = {}) {
  const { Miniflare, convertV4MiniflareOptions } = require("miniflare");
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, rootPath: __dirname, cf: false, scriptPath: path.join(__dirname, "worker.js"), compatibilityDate: "2026-09-30",
    host: "127.0.0.1", port: options.port == null ? 0 : options.port,
    durableObjects: { ROOMS: { className: "Room", useSQLite: true }, ADMISSION: { className: "Admission", useSQLite: true } },
    // Miniflare 5 uses a shared resource persistence root; the legacy
    // durableObjectsPersist option is no longer forwarded by its converter.
    ...(options.persistPath ? { resourcePersistencePath: path.resolve(options.persistPath) } : {}),
    bindings: { ALLOWED_ORIGINS: (options.origins || ["null", "http://localhost:8080", "http://127.0.0.1:8080"]).join(","), ROOM_TTL_SECONDS: String(options.ttlSeconds || 86400), ...(options.seatConfirmMs ? { SEAT_CONFIRM_MS: String(options.seatConfirmMs) } : {}) }
  }));
  try { const address = await runtime.ready; return { url: address.origin, runtime, close: () => runtime.dispose() }; }
  catch (error) { await runtime.dispose(); throw error; }
}
module.exports = { createLocalRelayServer };
if (require.main === module) {
  createLocalRelayServer({ port: Number(process.env.PORT) || 8787 }).then(server => {
    console.log("Backfire local relay: " + server.url);
    for (const event of ["SIGINT", "SIGTERM"]) process.once(event, () => server.close().then(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
