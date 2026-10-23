// 义体安装 / 拆除 5 级解锁（issue #315）：不到 5 级诊所不给装、不给拆（不执行、不扣钱、写原因，预览给同样的原因），
// 联机玩家发来的请求在房主那边一样被拦；诊所按钮灰掉、写「5 级解锁」，目录、图鉴照常能看；
// 不到 5 级但已经装着的义体照常生效；血量层改造（growth.js · cyberPlan）1 级照样能用；.vol1–.vol4 不另加等级要求
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const J = v => JSON.parse(JSON.stringify(v));
const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const LOCK = "5 级解锁义体安装 / 拆除";
const LOCK_RE = /5 级解锁义体安装 \/ 拆除/;
// 6 体质 6 智力：改造率上限 60%（和 tests/cyberware.test.js 一样）
const hero = (lv, extra) => Object.assign({ kit: "t", name: "测试", attrs: { str: 5, con: 6, dex: 5, wil: 6, int: 6, sta: 5 }, level: lv, shp: 20, shpMax: 20, cyberware: [] }, extra || {});
const ids = u => J((u.cyberware || []).map(x => x.id));
/** 单局：营地诊所，队伍的钱 */
function rogue(seed) {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["kolt", "helu"], seed: seed || "CW315" });
  run.stage = "camp";
  c.S.state.kuizhi = 100000;
  return { c, R, run, kolt: run.party.find(h => h.kit === "kolt"), helu: run.party.find(h => h.kit === "helu") };
}

test("配置：解锁等级是 cyberware.js 顶部的 CYBERWARE_UNLOCK_LEVEL = 5，判断等级的地方只读它", () => {
  const c = H.load();
  assert.equal(vm.runInContext("CYBERWARE_UNLOCK_LEVEL", c), 5);
  const src = read("cyberware.js");
  assert.match(src, /^const CYBERWARE_UNLOCK_LEVEL = 5;/m);
  const start = src.indexOf("function cyberwareLockWhy");
  const fn = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(fn, /< CYBERWARE_UNLOCK_LEVEL/);
  assert.doesNotMatch(fn, /\b5\b/, "门槛不写死在逻辑里");
});

test("规则层：4 级不能装、不能拆——不执行、不扣钱，原因「5 级解锁义体安装 / 拆除」；5 级能装能拆", () => {
  const c = H.load();
  const purse = { kuizhi: 50000 };
  const u4 = hero(4);
  assert.throws(() => c.cyberwareInstall(u4, "strike_v1", purse), LOCK_RE);
  assert.deepEqual(ids(u4), []); assert.equal(purse.kuizhi, 50000, "不扣钱");
  // 4 级就装着的（旧存档 / 主持人给的）：拆不掉
  const w4 = hero(4, { cyberware: [{ id: "strike_v1" }] });
  assert.throws(() => c.cyberwareRemove(w4, "strike_v1", purse), LOCK_RE);
  assert.deepEqual(ids(w4), ["strike_v1"]); assert.equal(purse.kuizhi, 50000, "不扣拆除费");
  // 1 级、没有 level 字段（按 1 级算）一样拦
  assert.throws(() => c.cyberwareInstall(hero(1), "shot_v1", purse), LOCK_RE);
  const noLv = hero(1); delete noLv.level;
  assert.throws(() => c.cyberwareInstall(noLv, "shot_v1", purse), LOCK_RE);
  assert.equal(purse.kuizhi, 50000);
  // 5 级：照常装、照常拆（花钱）
  const u5 = hero(5);
  c.cyberwareInstall(u5, "strike_v1", purse);
  assert.deepEqual(ids(u5), ["strike_v1"]); assert.equal(purse.kuizhi, 47000);
  c.cyberwareRemove(u5, "strike_v1", purse);
  assert.deepEqual(ids(u5), []); assert.equal(purse.kuizhi, 46000);
  // 单局诊所（rogue.js · installCyberware / removeCyberware）：1 级的柯尔特装不了，钱不动；到 5 级照常
  const r = rogue("CW315-RULE");
  assert.equal(r.kolt.level || 1, 1);
  assert.throws(() => r.R.installCyberware(r.run, "kolt", "strike_v1"), LOCK_RE);
  assert.equal(r.c.S.state.kuizhi, 100000); assert.deepEqual(J(r.kolt.cyberware || []), []);
  r.kolt.level = 5;
  r.c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "strike_v1" }, { run: r.run });
  assert.equal(r.c.S.state.kuizhi, 97000); assert.deepEqual(J(r.kolt.cyberware), [{ id: "strike_v1" }]);
  r.kolt.level = 4;
  assert.throws(() => r.R.removeCyberware(r.run, "kolt", "strike_v1"), LOCK_RE);
  assert.equal(r.c.S.state.kuizhi, 97000); assert.deepEqual(J(r.kolt.cyberware), [{ id: "strike_v1" }]);
});

test("预览给出同样的原因：cyberwareInstallPreview / 诊所目录 / 单局、跑团发出去的 previews 都写「5 级解锁义体安装 / 拆除」；改造率照常算好", () => {
  const c = H.load();
  const pv = J(c.cyberwareInstallPreview(hero(4), "strike_v1"));
  assert.equal(pv.ok, false); assert.equal(pv.error, LOCK); assert.equal(pv.locked, true);
  assert.equal(pv.cost, 3000); assert.equal(pv.rateAfter, 30.6, "4 级原生命上限 32：5/32 + 15%");
  let thrown = "";
  try { c.cyberwareInstall(hero(4), "strike_v1", { kuizhi: 1e6 }); } catch (e) { thrown = e.message; }
  assert.equal(thrown, pv.error, "安装时报的原因和预览一样");
  // 等级门槛排在冲突、超上限前面
  assert.equal(J(c.cyberwareInstallPreview(hero(4), "strike_v4")).error, LOCK);
  // 诊所目录：每件都写着原因；视图带 locked / unlockLevel
  const shop = J(c.cyberwareShopView(hero(4)));
  assert.equal(shop.length, 8);
  assert.ok(shop.every(r => r.canInstall === false && r.error === LOCK && r.locked === true));
  assert.deepEqual([J(c.cyberwareView(hero(4))).locked, J(c.cyberwareView(hero(4))).unlockLevel], [true, 5]);
  // 5 级：没有等级原因
  const ok = J(c.cyberwareInstallPreview(hero(5), "strike_v1"));
  assert.equal(ok.ok, true); assert.equal(ok.locked, false); assert.equal(ok.error, null);
  assert.equal(J(c.cyberwareView(hero(5))).locked, false);
  // 单局：query("cyberwarePreview") 和 cyberwarePacketFor 的 previews
  const { R, run } = rogue("CW315-PV");
  assert.equal(J(R.cyberwarePreviewFor(run, "kolt", "strike_v1")).error, LOCK);
  assert.equal(J(R.cyberwarePacketFor(run, "kolt")).previews.shot_v1.error, LOCK);
  // 跑团：trpgCyberwarePacket 的 previews
  const t = H.load();
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CW315-TRPG" });
  t.S.TRPG.active = true; t.S.TRPG.clinicOpen = true;
  assert.equal(J(t.trpgCyberwarePacket("kolt")).previews.strike_v1.error, LOCK);
});

test(".vol1–.vol4 不另加等级要求：5 级的角色看任何一档都没有等级原因（高档只看改造率，有专长就能装）", () => {
  const c = H.load();
  const u = hero(5, { cyberOverinstall: true });
  for (const d of c.cyberwareCatalog()) {
    const pv = J(c.cyberwareInstallPreview(u, d.id));
    assert.equal(pv.locked, false, d.id); assert.equal(pv.ok, true, d.id);
  }
  // 没专长时 .vol4 装不了的原因还是超上限，不是等级
  assert.match(J(c.cyberwareInstallPreview(hero(5), "strike_v4")).error, /超出改造率上限/);
});

test("血量层改造（cyberPlan）1 级照样能用：单局 modifyHero、跑团 trpgModifyHero 照常扣钱生效、额度不变；同一个 1 级角色的义体装不了", () => {
  const { c, R, run, kolt } = rogue("CW315-LAYER");
  assert.equal(kolt.level || 1, 1);
  const info = J(R.cyberInfo(run, "kolt"));
  const pv = J(R.cyberPreview(run, "kolt", { armor: 3 }));
  assert.equal(pv.error, null); assert.ok(pv.cost > 0);
  assert.equal(pv.limit, info.limit, "血量层改造的额度不受等级门槛影响");
  R.modifyHero(run, "kolt", { armor: 3 });
  assert.equal(kolt.cyber.armor, 3);
  assert.equal(c.S.state.kuizhi, 100000 - pv.cost);
  // 共用的改造率照旧：义体诊所的视图把这 3 点算进血量层改造
  const v = J(R.cyberwarePacketFor(run, "kolt")).view;
  assert.ok(v.layerRate > 0); assert.equal(v.locked, true);
  // 同一个 1 级角色：义体不给装，钱不动
  assert.throws(() => R.installCyberware(run, "kolt", "strike_v1"), LOCK_RE);
  assert.equal(c.S.state.kuizhi, 100000 - pv.cost);
  // 跑团：1 级的柯尔特做血量层改造照常；义体不给装
  const t = H.load();
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CW315-TLAYER" });
  t.S.TRPG.active = true; t.S.TRPG.clinicOpen = true;
  t.S.state.kuizhi = 10000;
  const u = t.findKit("kolt", t.S.state.units);
  assert.equal(u.level, 1);
  const notes = t.trpgModifyHero("kolt", { armor: 2 }, false);
  assert.match(notes[0], /^义体改造：/);
  assert.equal(u.cyberPlan.armor, 2);
  assert.ok(t.S.state.kuizhi < 10000);
  t.LEDGER.purse = { kolt: 50000 };
  assert.throws(() => t.trpgCyberwareInstall("kolt", "strike_v1"), LOCK_RE);
  assert.equal(t.trpgPurse("kolt"), 50000);
});

test("不到 5 级但已经装着的义体（旧存档 / 主持人给的）照常生效：扣生命上限、进技能列表、能发动、每天照常消耗坚毅；只是诊所拆不掉、不能以新换旧", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "CW315-OLD" });
  const a = c.findKit("kolt", c.S.state.units);
  a.level = 4; c.applyLevelStats(a);
  const inner = () => a.layers[a.layers.length - 1].max;
  const hp0 = inner();
  a.cyberware = [{ id: "strike_v1" }]; c.applyLevelStats(a);
  assert.equal(inner(), hp0 - 5, "生命上限照扣");
  assert.ok(c.skillList(a).some(s => s.id === "cw_strike_v1"), "技能列表里有");
  a.shp = 10;
  assert.equal(c.cyberwareDayTick(a), 2, "每天照常消耗");
  assert.equal(a.shp, 8);
  assert.equal(J(c.cyberwareFire(a, "strike_v1", () => 0)).ok, true, "照常发动");
  // 诊所：拆不掉、不能以新换旧，钱不动
  const purse = { kuizhi: 1e6 };
  assert.throws(() => c.cyberwareRemove(a, "strike_v1", purse), LOCK_RE);
  assert.throws(() => c.cyberwareInstall(a, "strike_v2", purse), LOCK_RE);
  assert.deepEqual(ids(a), ["strike_v1"]); assert.equal(purse.kuizhi, 1e6);
  assert.equal(inner(), hp0 - 5);
  const view = J(c.cyberwareView(a));
  assert.equal(view.installed[0].id, "strike_v1"); assert.equal(view.locked, true);
  // 到 5 级就能拆
  a.level = 5;
  c.cyberwareRemove(a, "strike_v1", purse);
  assert.deepEqual(ids(a), []); assert.equal(purse.kuizhi, 1e6 - 1000);
});

test("主持人免费安排（opt.free）不受等级限制：那是主持人的权力；诊所里正常的买、装、拆才看等级", () => {
  const c = H.load();
  const u = hero(1);
  c.cyberwareInstall(u, "strike_v1", null, { free: true });
  assert.deepEqual(ids(u), ["strike_v1"]);
  assert.throws(() => c.cyberwareRemove(u, "strike_v1", { kuizhi: 1e6 }), LOCK_RE);
  c.cyberwareRemove(u, "strike_v1", null, { free: true });
  assert.deepEqual(ids(u), []);
});

/* ---------- 联机：玩家的请求走房主的规则 ---------- */
test("联机单局：玩家发 rogue.act 装 / 拆，4 级时房主拦下、钱包不动；发给玩家的包写着原因（过白名单）；5 级照常", () => {
  const { c, run, helu } = rogue("CW315-ON");
  c.S.state.kuizhi = 0;
  c.RunFlow = { current: () => run, actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }) };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(read("online-rogue.js"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2" });
  const d = O.data(run); d.purse = { kolt: 0, helu: 50000 };
  const act = command => O.handle("p2", { type: "rogue.act", command });
  helu.level = 4;
  assert.throws(() => act({ action: "installCyberware", kit: "helu", id: "strike_v1" }), LOCK_RE);
  assert.equal(d.purse.helu, 50000); assert.deepEqual(J(helu.cyberware || []), []);
  const pkt = V.projectPacket({ type: "result", cyberware: J(O.cyberwareFor("p2")) }, { recipientId: "p2", gmId: "host" });
  const mine = pkt.cyberware.heroes.find(x => x.kit === "helu");
  assert.equal(mine.view.locked, true); assert.equal(mine.view.unlockLevel, 5);
  assert.ok(mine.shop.every(r => r.canInstall === false && r.error === LOCK && r.locked === true));
  assert.equal(mine.previews.strike_v1.error, LOCK); assert.equal(mine.previews.strike_v1.locked, true);
  assert.doesNotMatch(JSON.stringify(pkt.cyberware), /shp|Shp|坚毅/);
  // 4 级就装着的：拆也被拦
  helu.cyberware = [{ id: "strike_v1" }];
  assert.throws(() => act({ action: "removeCyberware", kit: "helu", id: "strike_v1" }), LOCK_RE);
  assert.equal(d.purse.helu, 50000); assert.deepEqual(J(helu.cyberware), [{ id: "strike_v1" }]);
  // 5 级：照常拆、装，从自己的钱包出
  helu.level = 5;
  act({ action: "removeCyberware", kit: "helu", id: "strike_v1" });
  assert.equal(d.purse.helu, 49000);
  act({ action: "installCyberware", kit: "helu", id: "shot_v1" });
  assert.equal(d.purse.helu, 46000); assert.deepEqual(J(helu.cyberware), [{ id: "shot_v1" }]);
});

/** 同屏 / 联机跑团：真的房主命令通道（hotseat-game.js，和 tests/hotseat-bridge.test.js 一样无界面加载） */
function trpgTable() {
  const c = H.load();
  const party = ["kolt", "helu"];
  c.BattleSim.setup({ party, enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "CW315-HOT" });
  c.location = { search: "?hotseat=1" }; c.URLSearchParams = URLSearchParams;
  c.document = { getElementById() { return null; } };
  c.setInterval = () => 1; c.setTimeout = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {} };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "hotseat-game.js"]) vm.runInContext(read(f), c, { filename: f });
  const [kolt, helu] = party.map(k => c.findKit(k, c.S.state.units));
  assert.equal(c.HotseatGame.configure({ mode: "trpg", players: [{ id: "p1", name: "主持人", gm: true }, { id: "p2", name: "玩家 2" }],
    assignments: { [kolt.id]: "p1", [helu.id]: "p2" } }).ok, true);
  c.S.TRPG.active = true; c.S.TRPG.clinicOpen = true;
  c.LEDGER.purse = { kolt: 50000, helu: 50000 };
  const send = (id, command) => { c.HotseatGame.switchPlayer(id); return J(c.HotseatGame.submit(command)); };
  return { c, helu, send };
}
test("联机跑团：玩家发 cyberwareInstall / cyberwareRemove，房主（hotseat-game.js）照规则拦下 4 级的角色、钱包不动；5 级照常", () => {
  const { c, helu, send } = trpgTable();
  helu.level = 4; c.applyLevelStats(helu);
  let r = send("p2", { type: "cyberwareInstall", kit: "helu", id: "strike_v1" });
  assert.equal(r.ok, false); assert.equal(r.error, LOCK);
  assert.equal(c.trpgPurse("helu"), 50000); assert.deepEqual(ids(helu), []);
  // 发给玩家的包（online-game.js · trpgCyberwareFor 的形状）：写着原因
  const pkt = V.projectPacket({ type: "view", cyberware: { heroes: [J(c.trpgCyberwarePacket("helu"))] } }, { recipientId: "p2", gmId: "p1" });
  assert.equal(pkt.cyberware.heroes[0].view.locked, true);
  assert.equal(pkt.cyberware.heroes[0].previews.strike_v1.error, LOCK);
  // 5 级：装上；再回到 4 级（主持人后台调了等级）就拆不掉
  helu.level = 5; c.applyLevelStats(helu);
  r = send("p2", { type: "cyberwareInstall", kit: "helu", id: "strike_v1" });
  assert.equal(r.ok, true); assert.equal(c.trpgPurse("helu"), 47000); assert.deepEqual(ids(helu), ["strike_v1"]);
  helu.level = 4;
  r = send("p2", { type: "cyberwareRemove", kit: "helu", id: "strike_v1" });
  assert.equal(r.ok, false); assert.equal(r.error, LOCK);
  assert.equal(c.trpgPurse("helu"), 47000); assert.deepEqual(ids(helu), ["strike_v1"]);
});

/* ---------- 诊所浮层（cyberware-ui.js，单机和联机共用） ---------- */
const shopRow = (html, id) => (html.match(new RegExp(`<li class="cw-row[^"]*">(?:(?!</li>)[\\s\\S])*data-cw-pick="${id}"[\\s\\S]*?</li>`)) || [""])[0];
const removeBtn = html => (html.match(/<button[^>]*data-cw-cmd="[^"]*removeCyberware[^"]*"[^>]*>[\s\S]*?<\/button>/) || [""])[0];
const pickBtns = html => [...html.matchAll(/<button[^>]*data-cw-pick="[^"]+"[^>]*>/g)].map(m => m[0]);
function clinicUi(seed) {
  const r = rogue(seed);
  vm.runInContext(read("cyberware-ui.js"), r.c, { filename: "cyberware-ui.js" });
  const U = r.c.CyberwareUI; U.reset();
  const q = (action, f) => r.c.dispatch(Object.assign({ type: "run.query", action }, f), { run: r.run });
  const model = () => U.localModel({ heroes: [{ kit: "kolt", name: "柯尔特" }], packetOf: kit => q("cyberware", { kit }),
    previewOf: (kit, id) => q("cyberwarePreview", { kit, id }), money: () => r.c.S.state.kuizhi });
  // 联机玩家：房主的包（每人 purse + previews）过 online-view 白名单
  const online = () => U.viewModel(V.projectPacket({ type: "view", cyberware: { heroes: [Object.assign({}, q("cyberware", { kit: "kolt" }), { purse: 100000 })] } },
    { recipientId: "p2", gmId: "host" }));
  return Object.assign(r, { U, model, online });
}

test("诊所浮层：不到 5 级时目录照常列出，安装 / 拆除按钮都灰掉、写「5 级解锁」；5 级就能点", () => {
  const { U, kolt, model } = clinicUi("CW315-UI");
  kolt.level = 4; kolt.cyberware = [{ id: "strike_v1" }];   // 旧存档：4 级就装着一件
  let html = U.html(model());
  const picks = pickBtns(html);
  assert.equal(picks.length, 7, "目录照常能看：没装的 7 件都在");
  assert.ok(picks.every(b => /\bdisabled\b/.test(b)), "安装按钮都灰掉");
  const row = shopRow(html, "shot_v1");
  assert.match(row, /安装<small>5 级解锁<\/small><\/button>/);
  assert.match(row, /title="5 级解锁义体安装 \/ 拆除"/);
  assert.match(row, /<small class="ws-need">5 级解锁义体安装 \/ 拆除<\/small>/);
  assert.match(shopRow(html, "strike_v2"), /以新换旧<small>5 级解锁<\/small><\/button>/);
  const rm = removeBtn(html);
  assert.match(rm, /disabled title="5 级解锁义体安装 \/ 拆除"/);
  assert.match(rm, /拆除<small>1000 奎支 · 5 级解锁<\/small>/);
  assert.match(html, /5 级解锁义体安装 \/ 拆除：现在可以先看目录；已经装着的义体照常生效。/);
  // 改造率条（义体 + 血量层改造）照常
  assert.match(html, /义体 [\d.]+% <i class="cw-sw ly"><\/i>血量层改造 0%/);
  assert.doesNotMatch(html, /坚毅|shp/i);
  // 5 级：都能点，不再写「5 级解锁」
  kolt.level = 5;
  html = U.html(model());
  assert.doesNotMatch(html, /级解锁/);
  assert.ok(!/\bdisabled\b/.test(shopRow(html, "shot_v1")));
  assert.ok(!/\bdisabled\b/.test(removeBtn(html)));
});

test("联机诊所：玩家看到的浮层（房主的包过 online-view 白名单）一样灰掉、写「5 级解锁」；5 级就能点", () => {
  const { U, kolt, online } = clinicUi("CW315-UION");
  kolt.level = 4; kolt.cyberware = [{ id: "strike_v1" }];
  const m = online();
  assert.equal(m.net, true);
  assert.equal(m.packet.view.locked, true); assert.equal(m.packet.view.unlockLevel, 5);
  let html = U.html(m);
  assert.equal(pickBtns(html).length, 7);
  assert.ok(pickBtns(html).every(b => /\bdisabled\b/.test(b)));
  assert.match(shopRow(html, "shot_v1"), /安装<small>5 级解锁<\/small><\/button>/);
  assert.match(removeBtn(html), /disabled title="5 级解锁义体安装 \/ 拆除"/);
  assert.match(removeBtn(html), /拆除<small>1000 奎支 · 5 级解锁<\/small>/);
  // 确认框（就算界面状态里留着上次选的）：写原因、确认按钮灰掉
  U.state.confirm = "shot_v1";
  html = U.html(online());
  assert.match(html, /<p class="ws-need big">5 级解锁义体安装 \/ 拆除<\/p>/);
  assert.match(html, /disabled>确认安装<\/button>/);
  U.state.confirm = "";
  kolt.level = 5;
  html = U.html(online());
  assert.doesNotMatch(html, /级解锁/);
  assert.ok(!/\bdisabled\b/.test(shopRow(html, "shot_v1")));
  assert.ok(!/\bdisabled\b/.test(removeBtn(html)));
});

/* ---------- 图鉴 ---------- */
test("图鉴「义体」：每件的诊所说明多一句「5 级起可以在诊所安装 / 拆除。」（固定的规则文字，不读角色）", () => {
  const c = H.load();
  const all = J(c.codexCyberwareEntries());
  assert.equal(all.length, 8);
  for (const e of all) {
    assert.equal(e.clinic[0], "5 级起可以在诊所安装 / 拆除。", e.cwId);
    assert.ok(e.lines.includes("5 级起可以在诊所安装 / 拆除。"), "搜索 / 详情的文字里也有");
  }
});

test("图鉴「规则」·义体与改造率：「义体」一节写角色 5 级起才能在诊所装 / 拆（读 CYBERWARE_UNLOCK_LEVEL），血量层改造 1 级就能做", () => {
  const c = H.load();
  vm.runInContext(read("rulebook.js"), c, { filename: "rulebook.js" });   // 和 tests/rulebook.test.js 一样另外加载
  const e = c.rulebookEntries().find(x => x.chapter === "cyber");
  const lines = J(e.sections.find(s => s.title === "义体").lines);
  assert.ok(lines.includes("角色 5 级起才能在诊所安装 / 拆除义体；还不到 5 级时已经装着的义体照常生效，只是不能拆。血量层改造没有这个限制，1 级就能做。"), lines.join("\n"));
  assert.match(read("rulebook.js"), /`角色 \$\{CYBERWARE_UNLOCK_LEVEL\} 级起才能在诊所安装 \/ 拆除义体；还不到 \$\{CYBERWARE_UNLOCK_LEVEL\} 级时/, "数字从配置读");
});

/* ---------- README ---------- */
test("README：规则改动记录最上面一条是这次改动（#315），写了以前怎样、现在怎样", () => {
  const readme = read("README.md");
  const start = readme.indexOf("## 规则改动记录");
  assert.ok(start >= 0);
  const first = readme.slice(start).split(/\n(?=- \*\*)/)[1] || "";
  assert.match(first, /#315/);
  assert.match(first, /5 级/); assert.match(first, /以前/); assert.match(first, /现在/);
  assert.match(first, /血量层改造/);
});
