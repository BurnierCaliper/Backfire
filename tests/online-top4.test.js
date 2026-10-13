// 联机四个修正：主持人接管掉线玩家的角色（战斗中也行）、释放座位、联机单局玩家自己拆改装件 / 做义体改造、空格误触结束行动
"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), http = require("node:http");
const { execSync } = require("node:child_process");
const { Hotseat } = require("../hotseat");
const ROOT = path.resolve(__dirname, "..");

/* ---------- 1. 接管：hotseat.js · takeOver ---------- */
function hero(id, kit, extra = {}) { return { id, kit, name: kit, isPlayer: true, shp: 10, layers: [{ current: 20 }], ...extra }; }
function session() {
  const units = [hero("ruby", "ruby"), hero("hiaki", "hiaki"), hero("w", "niu", { weaponOf: "ruby" })];
  const s = Hotseat.create({ operators: [{ id: "gm", name: "主持人" }, { id: "a", name: "甲" }, { id: "b", name: "乙" }], gmId: "gm",
    assignments: { ruby: "a", hiaki: "b" }, getUnits: () => units, canStand: () => true });
  return s;
}
test("主持人在战斗中接管掉线玩家：角色和武器人都改由主持人操作，顺序不变", () => {
  const s = session();
  s.beginRound(1);
  s.pick("a", "ruby", 0); s.pick("a", "w", 1); s.confirm("a");
  s.pick("b", "hiaki", 2); s.confirm("b");
  assert.equal(s.snapshot().phase, "acting");
  assert.equal(s.snapshot().currentUnitId, "ruby");
  assert.throws(() => s.takeOver("a", "a"), /只有房主/);
  assert.throws(() => s.takeOver("gm", "gm"), /主持人自己/);
  s.takeOver("gm", "a");
  const snap = s.snapshot();
  assert.deepEqual(snap.slots.map(r => [r.unitId, r.operatorId]), [["ruby", "gm"], ["w", "gm"], ["hiaki", "b"]]);
  assert.equal(snap.currentUnitId, "ruby");
  assert.equal(s.assertAction("gm", "ruby"), true);
  assert.throws(() => s.assertAction("a", "ruby"), /不是你的角色/);
  assert.throws(() => s.takeOver("gm", "a"), /没有可接管/);
  // 别人的角色不受影响
  assert.equal(s.ownerOf("hiaki"), "b");
});
test("选顺序阶段接管：被接管玩家的「已确定」作废，由主持人重新确认", () => {
  const s = session();
  s.beginRound(1);
  s.pick("a", "ruby", 0); s.pick("a", "w", 1); s.confirm("a");
  s.takeOver("gm", "a");
  assert.ok(!s.snapshot().confirmed.includes("a"));
  assert.equal(s.snapshot().phase, "selecting");
});

/* ---------- 3. 联机单局：玩家自己拆改装件、做义体改造（online-rogue.js · REMOTE） ---------- */
function rogueSandbox() {
  const acted = [];
  const run = { party: [{ kit: "ruby", weapons: ["niu"] }, { kit: "yuito", weapons: ["naruto"] }], online: { owners: { ruby: "alice", yuito: "bob" } } };
  const ctx = {
    console, setTimeout: fn => 0, Promise, JSON, Object, Array, Math, Number, String, Set, Map, Error,
    state: { kuizhi: 0 },
    Screens: { is: () => false },
    RunFlow: { current: () => run, actRaw: c => acted.push(c), refresh() {} },
    OnlineGame: { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "alice", online: true }, { id: "bob", online: true }] },
    Rogue: { heroName: k => k }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "online-rogue.js"), "utf8"), ctx, { filename: "online-rogue.js" });
  ctx.OnlineRogue.enable(true, "host");
  return { R: ctx.OnlineRogue, acted };
}
test("联机单局玩家可以拆自己武器上的改装件、给自己的角色做义体改造；别人的不行", () => {
  const { R, acted } = rogueSandbox();
  assert.deepEqual({ ...R.handle("alice", { type: "rogue.act", command: { action: "removePart", kit: "niu", slot: 0, smith: "trevor" } }) }, { ok: true });
  assert.deepEqual({ ...R.handle("alice", { type: "rogue.act", command: { action: "modifyHero", kit: "ruby", plan: { armor: 2 } } }) }, { ok: true });
  assert.deepEqual(acted.map(c => c.action), ["removePart", "modifyHero"]);
  assert.throws(() => R.handle("alice", { type: "rogue.act", command: { action: "removePart", kit: "naruto", slot: 0, smith: "trevor" } }), /只能动自己的角色/);
  assert.throws(() => R.handle("alice", { type: "rogue.act", command: { action: "modifyHero", kit: "yuito", plan: { armor: 2 } } }), /只能动自己的角色/);
  // 用 payer 冒名也不行：付钱的人和被改造的人必须是同一个
  assert.throws(() => R.handle("alice", { type: "rogue.act", command: { action: "modifyHero", kit: "yuito", payer: "ruby", plan: { armor: 2 } } }), /只能/);
  assert.equal(acted.length, 2);
});
test("释放座位：这名玩家的角色回到房主", () => {
  const { R } = rogueSandbox();
  R.release("alice");
  assert.equal(R.ownerOf("ruby"), "host");
  assert.equal(R.ownerOf("yuito"), "bob");
});

/* ---------- 4. 空格：焦点在按钮上时不结束行动（online-battle.js · onKey；浏览器测试） ---------- */
function playwright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
}
test("联机战斗画面：焦点在按钮上按空格不结束行动；焦点在空白处才结束", async t => {
  let pw = playwright(), browser;
  try { if (!pw) throw new Error("Playwright is required"); browser = await pw.chromium.launch(); }
  catch (error) { if (process.env.REQUIRE_UI === "1") throw error; t.skip("Playwright/browser unavailable"); return; }
  const website = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, bytes) => { if (error) { res.writeHead(404); res.end(); return; } res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".html": "text/html" })[path.extname(file)] || "application/octet-stream"); res.end(bytes); });
  });
  await new Promise(resolve => website.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await browser.close(); await new Promise(resolve => website.close(resolve)); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${website.address().port}/game.html`);
  await page.waitForFunction(() => !!window.OnlineBattle);
  await page.evaluate(() => {
    window.ended = 0;
    const b = OnlineBattle.create({ onEnd: () => { window.ended++; }, onSkill() {} });
    document.body.appendChild(b.el);
    b.update({ units: [{ id: "u1", name: "瑞比", isPlayer: true, zone: 1, ap: 2, apMax: 2, layers: [] }] },
      { mine: ["u1"], current: "u1", acting: true, skills: [{ value: "slash", label: "斩击" }], hint: "" });
  });
  await page.focus(".ol-battle [data-ob-skill]");
  await page.keyboard.press(" ");
  assert.equal(await page.evaluate(() => window.ended), 0);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press(" ");
  assert.equal(await page.evaluate(() => window.ended), 1);
});
