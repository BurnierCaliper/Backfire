// #193 / #196 审查补充：检定申请的回滚、说明、保留待处理；不在场角色在主持人变更时的归属
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const { Hotseat } = require("../hotseat");
const plain = x => JSON.parse(JSON.stringify(x));
const OPS = [{ id: "gm", name: "主持人" }, { id: "a", name: "甲" }];
const UNITS = [{ id: "ruby", kit: "ruby", name: "瑞比", isPlayer: true, layers: [{ current: 10, max: 10 }] }];
const session = random => Hotseat.create({ operators: OPS, gmId: "gm", mode: "trpg", assignments: { ruby: "a" }, getUnits: () => UNITS, canStand: () => true, random });
const spec = () => ({ prof: "侦察", diff: "easy", diffName: "简单", note: "", targets: [{ unitId: "ruby", name: "瑞比", base: 0.5, level: 1 }] });

test("同意检定申请时掷骰出错：撤掉刚建的检定和频道记录，申请仍待处理", () => {
  let boom = true;
  const s = session(() => { if (boom) throw new Error("骰子坏了"); return 0.1; });
  s.requestCheck("a", "ruby", "侦察", "", "瑞比");
  const before = plain(s.snapshot());
  const req = before.table.checkReqs[0];
  assert.throws(() => s.decideCheck("gm", req.id, "approve", spec()), /骰子坏了/);
  const after = plain(s.snapshot());
  assert.deepEqual(after.table.checks, before.table.checks, "没有留下开着的检定");
  assert.deepEqual(after.chat, before.chat, "频道没多记录");
  assert.equal(after.table.checkReqs[0].status, "pending");
  assert.equal(after.table.checkReqs[0].checkId, undefined);
  boom = false;
  s.decideCheck("gm", req.id, "approve", spec());
  const ok = plain(s.snapshot());
  assert.equal(ok.table.checkReqs[0].status, "approved");
  assert.ok(ok.table.checks.at(-1).targets[0].result);
});

test("不同意 / 撤回检定申请：小队频道写一行说明", () => {
  const s = session(() => 0.5);
  s.requestCheck("a", "ruby", "侦察", "", "瑞比");
  s.decideCheck("gm", s.snapshot().table.checkReqs[0].id, "reject");
  assert.match(s.snapshot().chat.at(-1).text, /没有同意 瑞比 的「侦察」检定申请/);
  s.requestCheck("a", "ruby", "运动", "", "瑞比");
  s.decideCheck("a", s.snapshot().table.checkReqs.at(-1).id, "cancel");
  assert.match(s.snapshot().chat.at(-1).text, /瑞比 的「运动」检定申请已撤回/);
});

test("检定申请超过 20 条：先丢最旧的已处理记录，待处理的不丢（含存档恢复）", () => {
  const units = Array.from({ length: 3 }, (_, i) => ({ id: "h" + i, kit: "h" + i, name: "角色" + i, isPlayer: true }));
  const isHero = u => !!u.isPlayer;
  const s = Hotseat.create({ operators: OPS, gmId: "gm", mode: "trpg", assignments: { h0: "a", h1: "a", h2: "a" }, isHero, getUnits: () => units, canStand: () => true, random: () => 0.5 });
  s.requestCheck("a", "h0", "侦察", "最早的", "角色0");   // 一直待处理
  for (let i = 0; i < 25; i++) { s.requestCheck("a", "h1", "运动", "", "角色1"); s.decideCheck("a", s.snapshot().table.checkReqs.at(-1).id, "cancel"); }
  const reqs = s.snapshot().table.checkReqs;
  assert.equal(reqs.length, 20);
  assert.ok(reqs.some(r => r.note === "最早的" && r.status === "pending"), "最早的待处理申请还在");
  const restored = Hotseat.create({ operators: OPS, gmId: "gm", mode: "trpg", assignments: {}, isHero, getUnits: () => units, canStand: () => true, table: plain(s.snapshot().table) });
  assert.ok(restored.snapshot().table.checkReqs.some(r => r.note === "最早的"));
});

test("不在场角色：重新配置时，记在（新）主持人名下的不当作玩家分配保留（prevOwners[kit] === nextGm 分支）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "GMCHANGE" });
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f });
  const byKit = k => c.S.state.units.find(u => u.kit === k && !u.weaponOf);
  const owners = () => Object.fromEntries(c.HotseatGame.getView().heroes.map(h => [c.S.state.units.find(u => u.id === h.id).kit, h.owner]));
  const P = (gm, ...ids) => [{ id: gm, name: gm, gm: true }, ...ids.map(id => ({ id, name: id }))];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players: P("host", "p2"), assignments: { [byKit("ruby").id]: "p2" } }).ok, true);
  c.BattleSim.setup({ party: ["helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "GMCHANGE-2" });   // 瑞比不在场
  // p2 成了主持人：瑞比（记在 p2 名下）不再作为「玩家分配」保留
  const r1 = c.HotseatGame.enableOnline({ mode: "trpg", players: P("p2", "host"), assignments: {} });
  assert.equal(r1.ok, true, r1.error);
  // 瑞比不在场、原来记在 p2 名下，p2 现在是主持人：不留成显式分配（按职业的归属表里没有它，默认归主持人）
  const saved = plain(c.HotseatGame.checkpoint());
  assert.equal(saved.ownerByKit.ruby, undefined, JSON.stringify(saved.ownerByKit));
  assert.equal(saved.ownerByKit.helu, "p2", "在场的赫露没分配，归新主持人");
});
