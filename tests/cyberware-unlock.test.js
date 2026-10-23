// 义体安装 / 拆除 5 级解锁（issue #315）：不到 5 级诊所不给装、不给拆（不执行、不扣钱、写原因，预览给同样的原因），
// 联机玩家发来的请求在房主那边一样被拦；诊所按钮灰掉、写「5 级解锁」，目录、图鉴照常能看；
// 不到 5 级但已经装着的义体照常生效；血量层改造（growth.js · cyberPlan）1 级照样能用。
// 追加（主人：「不同档位的义体也是得到了对应等级才可以安装」，推翻 issue 正文第 7 点）：装一件义体还要等级 ≥ 它的档位
// （.vol1 5 / .vol2 10 / .vol3 15 / .vol4 20 级，以新换旧看新的那件），原因「需要 10 级才能安装 .vol2 义体」、按钮写「需要 10 级」；
// 拆除不看档位（5 级起什么档都能拆）；图鉴写明每档的等级要求
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
/** 档位等级的原因（cyberware.js · cyberwareInstallPreview）：「需要 10 级才能安装 .vol2 义体」 */
const NEED = (lv, vol) => `需要 ${lv} 级才能安装 .vol${vol} 义体`;
const NEED_RE = (lv, vol) => new RegExp(`需要 ${lv} 级才能安装 \\.vol${vol} 义体`);
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

test("配置：档位等级直接用义体自己的档位数（等级 ≥ def.tier），不另写一张表；每档要几级 = 档位和 5 级总开关取高的", () => {
  const c = H.load();
  assert.deepEqual(J([5, 10, 15, 20].map(t => c.cyberwareInstallLevel(t))), [5, 10, 15, 20]);
  assert.deepEqual(J(c.cyberwareCatalog().map(d => c.cyberwareInstallLevel(d.tier))), [5, 10, 15, 20, 5, 10, 15, 20]);
  const src = read("cyberware.js");
  const start = src.indexOf("function cyberwareTierNeed");
  assert.ok(start > 0);
  const fn = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(fn, /cyberwareInstallLevel\(d\.tier\)/, "读义体自己的档位");
  assert.match(fn, /CYBERWARE_UNLOCK_LEVEL/);
  assert.doesNotMatch(fn, /\b(5|10|15|20)\b/, "档位等级不写死在逻辑里");
  assert.match(src, /function cyberwareInstallLevel\(tier\) \{ return Math\.max\(CYBERWARE_UNLOCK_LEVEL, /);
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

test("预览给出同样的原因：4 级时 cyberwareInstallPreview / 诊所目录 / 单局、跑团发出去的 previews 写「5 级解锁义体安装 / 拆除」（.vol2 起写要的等级更高的档位原因）；改造率照常算好", () => {
  const c = H.load();
  const pv = J(c.cyberwareInstallPreview(hero(4), "strike_v1"));
  assert.equal(pv.ok, false); assert.equal(pv.error, LOCK); assert.equal(pv.locked, true);
  assert.equal(pv.cost, 3000); assert.equal(pv.rateAfter, 30.6, "4 级原生命上限 32：5/32 + 15%");
  let thrown = "";
  try { c.cyberwareInstall(hero(4), "strike_v1", { kuizhi: 1e6 }); } catch (e) { thrown = e.message; }
  assert.equal(thrown, pv.error, "安装时报的原因和预览一样");
  // 等级门槛排在冲突、超上限前面（4 级看 .vol4：两道都没过，写要的等级更高的档位原因——到了 5 级它还是装不了）
  assert.equal(J(c.cyberwareInstallPreview(hero(4), "strike_v4")).error, NEED(20, 4));
  // 诊所目录：每件都写着原因（.vol1 写「5 级解锁…」，.vol2 起写档位的）；视图带 locked / unlockLevel
  const shop = J(c.cyberwareShopView(hero(4)));
  assert.equal(shop.length, 8);
  assert.ok(shop.every(r => r.canInstall === false && r.locked === true && r.error === (r.tier === 5 ? LOCK : NEED(r.tier, r.vol))));
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

/* ---------- 档位等级（追加）：装一件义体要等级 ≥ 它的档位 ---------- */
test("档位等级：9 级不能装 .vol2、10 级能装；5 级能装 .vol1、不能装 .vol2——不执行、不扣钱，原因「需要 10 级才能安装 .vol2 义体」", () => {
  const c = H.load();
  const purse = { kuizhi: 1e6 };
  const u9 = hero(9);
  assert.throws(() => c.cyberwareInstall(u9, "strike_v2", purse), NEED_RE(10, 2));
  assert.deepEqual(ids(u9), []); assert.equal(purse.kuizhi, 1e6, "不扣钱");
  const u10 = hero(10);
  c.cyberwareInstall(u10, "strike_v2", purse);
  assert.deepEqual(ids(u10), ["strike_v2"]); assert.equal(purse.kuizhi, 1e6 - 6000);
  const u5 = hero(5);
  assert.throws(() => c.cyberwareInstall(u5, "shot_v2", purse), NEED_RE(10, 2));
  assert.deepEqual(ids(u5), []); assert.equal(purse.kuizhi, 1e6 - 6000);
  c.cyberwareInstall(u5, "shot_v1", purse);
  assert.deepEqual(ids(u5), ["shot_v1"]); assert.equal(purse.kuizhi, 1e6 - 9000);
  // 每一档：差 1 级装不了（.vol1 差的是 5 级总开关），到了档位的等级就没有等级原因（.vol3 / .vol4 要 15 / 20 级）
  for (const d of c.cyberwareCatalog()) {
    const short = J(c.cyberwareInstallPreview(hero(d.tier - 1), d.id)), enough = J(c.cyberwareInstallPreview(hero(d.tier), d.id));
    assert.equal(short.ok, false, d.id);
    assert.equal(short.error, d.tier > 5 ? NEED(d.tier, d.vol) : LOCK, d.id);
    assert.equal(short.needLevel, d.tier > 5 ? d.tier : 0, d.id);
    assert.equal(enough.ok, true, d.id); assert.equal(enough.error, null, d.id);
    assert.equal(enough.needLevel, 0, d.id); assert.equal(enough.locked, false, d.id);
  }
  // 单局诊所（rogue.js · installCyberware）：9 级的柯尔特装不了 .vol2，钱和档案都不动；10 级照常
  const r = rogue("CW315-TIER");
  r.kolt.level = 9;
  assert.throws(() => r.c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "strike_v2" }, { run: r.run }), NEED_RE(10, 2));
  assert.equal(r.c.S.state.kuizhi, 100000); assert.deepEqual(J(r.kolt.cyberware || []), []);
  r.kolt.level = 10;
  r.c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "strike_v2" }, { run: r.run });
  assert.equal(r.c.S.state.kuizhi, 94000); assert.deepEqual(J(r.kolt.cyberware), [{ id: "strike_v2" }]);
});

test("以新换旧：新的那件也要满足档位等级——不够时整个不做（旧的不拆、钱不扣、不记账）；够了照常拆旧装新；换回低档只看新的那件", () => {
  const c = H.load();
  const purse = { kuizhi: 1e6 };
  const u = hero(5, { cyberware: [{ id: "strike_v1" }] });
  const pv = J(c.cyberwareInstallPreview(u, "strike_v2"));
  assert.equal(pv.replaces, "strike_v1"); assert.equal(pv.ok, false);
  assert.equal(pv.error, NEED(10, 2)); assert.equal(pv.needLevel, 10); assert.equal(pv.locked, false);
  assert.throws(() => c.cyberwareInstall(u, "strike_v2", purse), NEED_RE(10, 2));
  assert.deepEqual(ids(u), ["strike_v1"], "旧的没拆"); assert.equal(purse.kuizhi, 1e6, "钱没扣");
  u.level = 10;
  c.cyberwareInstall(u, "strike_v2", purse);
  assert.deepEqual(ids(u), ["strike_v2"]); assert.equal(purse.kuizhi, 1e6 - 7000, "拆除费 1000 + 新的 6000");
  // 换回低档：新的 .vol1 只要 5 级；身上那件 .vol3 照常拆掉（拆除不看档位）
  const g = hero(5, { cyberware: [{ id: "strike_v3" }] });
  const back = J(c.cyberwareInstallPreview(g, "strike_v1"));
  assert.equal(back.ok, true); assert.equal(back.replaces, "strike_v3"); assert.equal(back.cost, 3000 + 3000);
  c.cyberwareInstall(g, "strike_v1", purse);
  assert.deepEqual(ids(g), ["strike_v1"]); assert.equal(purse.kuizhi, 1e6 - 7000 - 6000);
  // 单局诊所：被拦时队伍的钱、档案里的义体、记录都不动
  const r = rogue("CW315-SWAP");
  r.kolt.level = 5;
  r.R.installCyberware(r.run, "kolt", "shot_v1");
  assert.equal(r.c.S.state.kuizhi, 97000);
  const logLen = r.run.log.length;
  assert.throws(() => r.c.Commands.dispatch({ type: "run", action: "installCyberware", kit: "kolt", id: "shot_v2" }, { run: r.run }), NEED_RE(10, 2));
  assert.equal(r.c.S.state.kuizhi, 97000); assert.deepEqual(J(r.kolt.cyberware), [{ id: "shot_v1" }]);
  assert.equal(r.run.log.length, logLen, "没有记一笔以新换旧");
});

test("拆除不看档位：5 级能拆一件 .vol3（旧存档 / 主持人给的、比现在等级高档的）；装着时照常生效；4 级还是拆不了", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 1 }], seed: "CW315-V3" });
  const a = c.findKit("kolt", c.S.state.units);
  a.level = 5; c.applyLevelStats(a);
  const inner = () => a.layers[a.layers.length - 1].max;
  const hp0 = inner();
  a.cyberware = [{ id: "strike_v3" }]; c.applyLevelStats(a);
  assert.equal(inner(), hp0 - 15, "生命上限照扣");
  assert.ok(c.skillList(a).some(s => s.id === "cw_strike_v3"), "技能列表里有");
  a.shp = 10;
  assert.ok(c.cyberwareDayTick(a) >= 2, "每天照常消耗");
  assert.equal(J(c.cyberwareFire(a, "strike_v3", () => 0)).ok, true, "照常发动");
  assert.equal(J(c.cyberwareView(a)).installed[0].id, "strike_v3");
  const purse = { kuizhi: 1e6 };
  a.level = 4;
  assert.throws(() => c.cyberwareRemove(a, "strike_v3", purse), LOCK_RE);
  assert.deepEqual(ids(a), ["strike_v3"]); assert.equal(purse.kuizhi, 1e6);
  a.level = 5;
  // 装看档位、拆不看：5 级换成 .vol4 不行（有专长也不行），拆掉身上的 .vol3 可以
  a.cyberOverinstall = true;
  assert.throws(() => c.cyberwareInstall(a, "strike_v4", purse), NEED_RE(20, 4));
  assert.deepEqual(ids(a), ["strike_v3"]); assert.equal(purse.kuizhi, 1e6);
  c.cyberwareRemove(a, "strike_v3", purse);
  assert.deepEqual(ids(a), []); assert.equal(purse.kuizhi, 1e6 - 3000, "拆除费 3000");
  assert.equal(inner(), hp0, "生命上限还回来");
  // 单局诊所：5 级的柯尔特身上那件 .vol4 也能拆
  const r = rogue("CW315-RMV4");
  r.kolt.level = 5; r.kolt.cyberware = [{ id: "shot_v4" }];
  r.c.Commands.dispatch({ type: "run", action: "removeCyberware", kit: "kolt", id: "shot_v4" }, { run: r.run });
  assert.equal(r.c.S.state.kuizhi, 96000); assert.deepEqual(J(r.kolt.cyberware), []);
});

test("档位原因在预览、诊所目录、单局 / 跑团发出去的包里都一样：needLevel = 要的等级；4 级看 .vol1 写「5 级解锁…」，看 .vol2 起写「需要 N 级…」", () => {
  const c = H.load();
  // 5 级：.vol1 能装，.vol2–.vol4 写档位原因
  for (const r of J(c.cyberwareShopView(hero(5)))) {
    if (r.tier === 5) assert.deepEqual([r.canInstall, r.needLevel, r.error], [true, 0, null], r.id);
    else assert.deepEqual([r.canInstall, r.needLevel, r.error, r.locked], [false, r.tier, NEED(r.tier, r.vol), false], r.id);
  }
  const pv = J(c.cyberwareInstallPreview(hero(9), "shot_v2"));
  assert.deepEqual([pv.ok, pv.error, pv.needLevel, pv.locked], [false, NEED(10, 2), 10, false]);
  assert.equal(pv.cost, 6000); assert.ok(pv.rateAfter > 0, "改造率照常算好");
  let thrown = "";
  try { c.cyberwareInstall(hero(9), "shot_v2", { kuizhi: 1e6 }); } catch (e) { thrown = e.message; }
  assert.equal(thrown, pv.error, "安装时报的原因和预览一样");
  // 4 级：两道都没过，写要的等级更高的那道（到了 5 级 .vol2 还是装不了）
  const p1 = J(c.cyberwareInstallPreview(hero(4), "strike_v1")), p2 = J(c.cyberwareInstallPreview(hero(4), "strike_v2"));
  assert.deepEqual([p1.error, p1.locked, p1.needLevel], [LOCK, true, 0]);
  assert.deepEqual([p2.error, p2.locked, p2.needLevel], [NEED(10, 2), true, 10]);
  // 等级原因排在超上限前面：5 级没专长看 .vol4，写的是档位，不是超上限
  assert.equal(J(c.cyberwareInstallPreview(hero(5), "strike_v4")).error, NEED(20, 4));
  // 主持人免费安排（opt.free）不看档位
  assert.equal(J(c.cyberwareInstallPreview(hero(1, { cyberOverinstall: true }), "strike_v4", { free: true })).ok, true);
  // 单局：query("cyberwarePreview")、cyberwarePacketFor 的 previews / shop
  const { R, run, kolt } = rogue("CW315-TPV");
  kolt.level = 10;
  assert.equal(J(R.cyberwarePreviewFor(run, "kolt", "strike_v3")).error, NEED(15, 3));
  const pk = J(R.cyberwarePacketFor(run, "kolt"));
  assert.equal(pk.previews.shot_v4.error, NEED(20, 4)); assert.equal(pk.previews.shot_v4.needLevel, 20);
  assert.equal(pk.previews.shot_v2.ok, true);
  assert.equal(pk.shop.find(x => x.id === "strike_v3").needLevel, 15);
  // 跑团：trpgCyberwarePacket
  const t = H.load();
  t.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CW315-TTPV" });
  t.S.TRPG.active = true; t.S.TRPG.clinicOpen = true;
  const tu = t.findKit("kolt", t.S.state.units);
  tu.level = 5; t.applyLevelStats(tu);
  const tp = J(t.trpgCyberwarePacket("kolt"));
  assert.equal(tp.previews.strike_v2.error, NEED(10, 2)); assert.equal(tp.previews.strike_v1.ok, true);
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
  // 诊所：拆不掉、不能以新换旧，钱不动（4 级看 .vol2：写要的等级更高的档位原因）
  const purse = { kuizhi: 1e6 };
  assert.throws(() => c.cyberwareRemove(a, "strike_v1", purse), LOCK_RE);
  assert.throws(() => c.cyberwareInstall(a, "strike_v2", purse), NEED_RE(10, 2));
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
  // 档位等级一样不看：1 级也能被安排一件 .vol4（超上限照旧要专长）
  const w = hero(1, { cyberOverinstall: true });
  c.cyberwareInstall(w, "strike_v4", null, { free: true });
  assert.deepEqual(ids(w), ["strike_v4"]);
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
  assert.ok(mine.shop.every(r => r.canInstall === false && r.locked === true && r.error === (r.tier === 5 ? LOCK : NEED(r.tier, r.vol))));
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

test("联机单局：玩家发 rogue.act 装 .vol2，9 级时房主照档位拦下、钱包不动（以新换旧也拦，旧的不拆）；发给玩家的包带 needLevel 和原因（过白名单）；10 级照常", () => {
  const { c, run, helu } = rogue("CW315-TON");
  c.S.state.kuizhi = 0;
  c.RunFlow = { current: () => run, actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }) };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(read("online-rogue.js"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2" });
  const d = O.data(run); d.purse = { kolt: 0, helu: 50000 };
  const act = command => O.handle("p2", { type: "rogue.act", command });
  helu.level = 9;
  assert.throws(() => act({ action: "installCyberware", kit: "helu", id: "strike_v2" }), NEED_RE(10, 2));
  assert.equal(d.purse.helu, 50000); assert.deepEqual(J(helu.cyberware || []), []);
  const pkt = V.projectPacket({ type: "result", cyberware: J(O.cyberwareFor("p2")) }, { recipientId: "p2", gmId: "host" });
  const mine = pkt.cyberware.heroes.find(x => x.kit === "helu");
  assert.equal(mine.view.locked, false);
  const row = mine.shop.find(r => r.id === "strike_v2");
  assert.deepEqual([row.canInstall, row.needLevel, row.error, row.locked], [false, 10, NEED(10, 2), false]);
  assert.equal(mine.previews.strike_v2.needLevel, 10); assert.equal(mine.previews.strike_v2.error, NEED(10, 2));
  assert.equal(mine.previews.strike_v1.ok, true); assert.equal(mine.previews.strike_v1.needLevel, 0);
  assert.doesNotMatch(JSON.stringify(pkt.cyberware), /shp|Shp|坚毅/);
  // 以新换旧：先装 .vol1，再换 .vol2 被拦——旧的不拆、钱不扣
  act({ action: "installCyberware", kit: "helu", id: "strike_v1" });
  assert.equal(d.purse.helu, 47000);
  assert.throws(() => act({ action: "installCyberware", kit: "helu", id: "strike_v2" }), NEED_RE(10, 2));
  assert.equal(d.purse.helu, 47000); assert.deepEqual(J(helu.cyberware), [{ id: "strike_v1" }]);
  // 10 级：照常以新换旧（拆除费 1000 + 新的 6000）
  helu.level = 10;
  act({ action: "installCyberware", kit: "helu", id: "strike_v2" });
  assert.equal(d.purse.helu, 40000); assert.deepEqual(J(helu.cyberware), [{ id: "strike_v2" }]);
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

test("联机跑团：玩家发 cyberwareInstall，9 级装 .vol2 被房主照档位拦下、钱包不动；包里写着原因；10 级照常；拆除不看档位，5 级能拆 .vol3", () => {
  const { c, helu, send } = trpgTable();
  helu.level = 9; c.applyLevelStats(helu);
  let r = send("p2", { type: "cyberwareInstall", kit: "helu", id: "shot_v2" });
  assert.equal(r.ok, false); assert.equal(r.error, NEED(10, 2));
  assert.equal(c.trpgPurse("helu"), 50000); assert.deepEqual(ids(helu), []);
  const pkt = V.projectPacket({ type: "view", cyberware: { heroes: [J(c.trpgCyberwarePacket("helu"))] } }, { recipientId: "p2", gmId: "p1" });
  const mine = pkt.cyberware.heroes[0];
  assert.equal(mine.previews.shot_v2.error, NEED(10, 2)); assert.equal(mine.previews.shot_v2.needLevel, 10);
  assert.equal(mine.shop.find(x => x.id === "shot_v2").needLevel, 10);
  helu.level = 10; c.applyLevelStats(helu);
  r = send("p2", { type: "cyberwareInstall", kit: "helu", id: "shot_v2" });
  assert.equal(r.ok, true); assert.equal(c.trpgPurse("helu"), 44000); assert.deepEqual(ids(helu), ["shot_v2"]);
  // 主持人给的 .vol3（比现在等级高档）：5 级就能拆，从自己的钱包出拆除费
  helu.cyberware = [{ id: "strike_v3" }]; helu.level = 5; c.applyLevelStats(helu);
  r = send("p2", { type: "cyberwareRemove", kit: "helu", id: "strike_v3" });
  assert.equal(r.ok, true); assert.equal(c.trpgPurse("helu"), 41000); assert.deepEqual(ids(helu), []);
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
  // .vol2 起写这一档要的等级（到了 5 级它还是装不了）
  assert.match(shopRow(html, "strike_v2"), /以新换旧<small>需要 10 级<\/small><\/button>/);
  assert.match(shopRow(html, "shot_v4"), /安装<small>需要 20 级<\/small><\/button>/);
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

test("诊所浮层（单机 / 联机一样）：等级不够的那几件照样列出来，按钮灰掉、写「需要 10 级」之类，原因和预览一样；拆除不看档位，5 级装着 .vol3 也能拆", () => {
  const { U, kolt, model, online } = clinicUi("CW315-UITIER");
  kolt.level = 5; kolt.cyberware = [{ id: "strike_v3" }];   // 旧存档 / 主持人给的：比现在等级高档
  const NEED_ROWS = [["shot_v2", 10, 2, "安装"], ["shot_v3", 15, 3, "安装"], ["shot_v4", 20, 4, "安装"], ["strike_v2", 10, 2, "以新换旧"], ["strike_v4", 20, 4, "以新换旧"]];
  for (const m of [model, online]) {
    U.state.confirm = "";
    const html = U.html(m());
    assert.equal(pickBtns(html).length, 7, "目录照常能看：没装的 7 件都在");
    // .vol1 能点（以新换旧换回低档也行），不写等级
    for (const [id, label] of [["shot_v1", "安装"], ["strike_v1", "以新换旧"]]) {
      const row = shopRow(html, id);
      assert.ok(!/\bdisabled\b/.test(row), id); assert.ok(row.includes(`>${label}</button>`), id); assert.doesNotMatch(row, /需要 \d+ 级/, id);
    }
    // .vol2–.vol4：灰掉、写「需要 N 级」；原因（悬停提示、行里的说明）是房主算好的
    for (const [id, lv, vol, label] of NEED_ROWS) {
      const row = shopRow(html, id);
      assert.ok(row.includes(`data-cw-pick="${id}" disabled title="${NEED(lv, vol)}">${label}<small>需要 ${lv} 级</small></button>`), `${id}：${row}`);
      assert.ok(row.includes(`<small class="ws-need">${NEED(lv, vol)}</small>`), id);
    }
    // 拆除不看档位：身上那件 .vol3 照样能拆
    const rm = removeBtn(html);
    assert.ok(!/\bdisabled\b/.test(rm), rm); assert.match(rm, /拆除<small>3000 奎支<\/small>/);
    assert.doesNotMatch(html, /级解锁/, "5 级了：不再写「5 级解锁」");
    assert.doesNotMatch(html, /坚毅|shp/i);
  }
  // 确认框（界面状态里留着上次选的）：写原因、确认按钮灰掉
  U.state.confirm = "strike_v2";
  for (const m of [model, online]) {
    const html = U.html(m());
    assert.ok(html.includes(`<p class="ws-need big">${NEED(10, 2)}</p>`));
    assert.match(html, /disabled>确认以新换旧<\/button>/);
  }
  U.state.confirm = "";
  // 10 级：.vol2 能点了，.vol3 起还是灰的
  kolt.level = 10;
  for (const m of [model, online]) {
    const html = U.html(m());
    assert.ok(!/\bdisabled\b/.test(shopRow(html, "shot_v2")));
    assert.match(shopRow(html, "shot_v3"), /安装<small>需要 15 级<\/small><\/button>/);
    assert.match(shopRow(html, "strike_v4"), /以新换旧<small>需要 20 级<\/small><\/button>/);
  }
});

/* ---------- 图鉴 ---------- */
test("图鉴「义体」写明每档的等级要求：每件的诊所说明先写这件几级起能装（.vol1 5 级起能装能拆；.vol2 起写档位的等级、5 级起能拆）；以新换旧要够新的那件（固定的规则文字，不读角色）", () => {
  const c = H.load();
  const all = J(c.codexCyberwareEntries());
  assert.equal(all.length, 8);
  for (const e of all) {
    const first = e.tier === 5 ? "5 级起可以在诊所安装 / 拆除。" : `${e.tier} 级起可以在诊所安装（角色等级要到这件义体的等级）；5 级起就能拆除（拆除不看档位）。`;
    assert.equal(e.clinic[0], first, e.cwId);
    assert.ok(e.lines.includes(first), "搜索 / 详情的文字里也有");
    assert.match(e.clinic.join("\n"), /换等级要在诊所以新换旧（付旧的拆除费 \+ 新的价格），新的那件也要角色等级够。/, e.cwId);
  }
  assert.deepEqual(all.filter(e => e.tier > 5).map(e => e.clinic[0].slice(0, 6)), ["10 级起可", "15 级起可", "20 级起可", "10 级起可", "15 级起可", "20 级起可"]);
  // 只写这一件的等级，不列别的档位：搜「.vol2」照旧只搜出 .vol2
  assert.ok(all.every(e => !/\.vol\d/.test(e.clinic.join(""))));
  assert.deepEqual(all.filter(e => c.codexMatch(e, ".vol2")).map(e => e.cwId), ["strike_v2", "shot_v2"]);
});

test("图鉴「规则」·义体与改造率：「义体」一节写 5 级起才能在诊所装 / 拆、装哪一件还要等级到它的档位、拆除不看档位，血量层改造 1 级就能做；档位表多一列「角色几级能装」", () => {
  const c = H.load();
  vm.runInContext(read("rulebook.js"), c, { filename: "rulebook.js" });   // 和 tests/rulebook.test.js 一样另外加载
  const e = c.rulebookEntries().find(x => x.chapter === "cyber");
  const sec = e.sections.find(s => s.title === "义体");
  const lines = J(sec.lines);
  assert.ok(lines.includes("角色 5 级起才能在诊所安装 / 拆除义体；装哪一件还要角色等级到它的档位（下表「角色几级能装」，以新换旧看新的那件），拆除不看档位。还不到 5 级时已经装着的义体照常生效，只是不能拆。血量层改造没有这个限制，1 级就能做。"), lines.join("\n"));
  assert.match(read("rulebook.js"), /`角色 \$\{CYBERWARE_UNLOCK_LEVEL\} 级起才能在诊所安装 \/ 拆除义体；[^`]*还不到 \$\{CYBERWARE_UNLOCK_LEVEL\} 级时/, "数字从配置读");
  assert.deepEqual(J(sec.table.head), ["等级", "名字后缀", "生命上限", "固定占用", "角色几级能装"]);
  assert.deepEqual(J(sec.table.rows.map(r => r[4])), ["5 级", "10 级", "15 级", "20 级"]);
  assert.match(read("rulebook.js"), /`\$\{cyberwareInstallLevel\(t\)\} 级`/, "每档要几级读 cyberware.js · cyberwareInstallLevel");
});

/* ---------- README ---------- */
test("README：规则改动记录里有这次改动（#315）这一条，写了以前怎样、现在怎样，档位等级也写进去了", () => {
  const readme = read("README.md");
  const start = readme.indexOf("## 规则改动记录");
  assert.ok(start >= 0);
  // 后来的改动会排在它上面：找写着 #315 的那一条，不要求一定在最上面
  const first = readme.slice(start).split(/\n(?=- \*\*)/).find(e => /issue #315|#315）|（#315/.test(e.split("\n")[0])) || "";
  assert.match(first, /#315/);
  assert.match(first, /5 级/); assert.match(first, /以前/); assert.match(first, /现在/);
  assert.match(first, /血量层改造/);
  // 追加的档位等级
  assert.match(first, /\.vol2[^\n]*10 级/); assert.match(first, /\.vol4[^\n]*20 级/);
  assert.match(first, /需要 10 级才能安装 \.vol2 义体/); assert.match(first, /以新换旧/); assert.match(first, /拆除不看档位/);
});
