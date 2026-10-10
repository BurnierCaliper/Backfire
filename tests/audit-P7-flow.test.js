// P7-flow：单局 / 跑团 / 存档 / 成长 / 补给 / 工具 / 图鉴文字的一批规则修正（README「规则改动记录」）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const src = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");

/** 跑团的场上队伍：柯尔特（扭矩）+ Helumica（Ecmo） */
function trpg() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "P7" });
  c.S.TRPG.active = true;
  return { c, st: c.S.state, kolt: c.findKit("kolt", c.S.state.units), helu: c.findKit("helu", c.S.state.units) };
}
function rogue(seed, party) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: party || ["kolt", "helu"], seed });
  c.S.state.kuizhi = 1e6;
  return { c, R, run };
}
const heroesOf = c => c.S.state.units.filter(u => u.isPlayer && !c.isWeaponUnit(u));

/* ---------- 1. 单局装减耐久的图纸 ---------- */
test("单局装大杀器：当前耐久立刻压到新上限（以前 9/5，要等下次长休）", () => {
  const { c, R, run } = rogue("P7-BPDUR");
  run.stage = "board"; run.smiths = ["zekahr"]; run.blueprints = ["bp_trevor_bigkill"];
  const h = run.party[0];
  h.weaponLevels.torque = 6;
  const full = R.heroView(run, h).weapons[0].durMax;
  c.S.LEDGER.dur.torque = full;
  R.installBlueprint(run, "bp_trevor_bigkill", "torque", "zekahr");
  const w = R.heroView(run, h).weapons[0];
  assert.ok(w.durMax < full, "大杀器耐久减半");
  assert.equal(w.dur, w.durMax);
  assert.equal(c.S.LEDGER.dur.torque, w.durMax);
});

/* ---------- 2. 客制化图纸武器 4 级才解锁 ---------- */
test("客制化图纸：武器 4 级才能装（单局 / 跑团，主持人直接装也一样）", () => {
  const { R, run } = rogue("P7-BPLV");
  run.stage = "board"; run.smiths = ["zekahr"]; run.blueprints = ["bp_zekahr_fool"];
  const k0 = 1e6;
  assert.throws(() => R.installBlueprint(run, "bp_zekahr_fool", "ecmo", "zekahr"), /4 级才能装客制化图纸（现在 1 级）/);
  assert.equal(run.blueprints.length, 1, "图纸还在手里");
  run.party[1].weaponLevels.ecmo = 4;
  R.installBlueprint(run, "bp_zekahr_fool", "ecmo", "zekahr");
  assert.equal(run.installed.ecmo, "bp_zekahr_fool");
  assert.ok(k0 > 0);

  const { c, kolt } = trpg();
  c.bagAdd("bp_zekahr_fool", 1);
  assert.match(c.trpgInstallBlueprint("kolt", "torque", "bp_zekahr_fool", 0, false).join(""), /4 级才能装客制化图纸（现在 1 级）/);
  assert.match(c.trpgInstallBlueprint("kolt", "torque", "bp_zekahr_fool", 0, true).join(""), /4 级/);
  assert.equal(c.bagCount("bp_zekahr_fool"), 1);
  assert.equal(kolt.weaponBlueprints, undefined);
  c.setOwnedWeaponLevel(kolt, "torque", 4);
  c.trpgInstallBlueprint("kolt", "torque", "bp_zekahr_fool", 0, false);
  assert.equal(kolt.weaponBlueprints.torque, "bp_zekahr_fool");
  assert.ok(c.S.state.weaponMods.torque);
});

test("装在不到 4 级武器上的图纸（旧存档 / 后台降级）不生效，升回 4 级又生效", () => {
  // 单局旧存档：1 级扭矩上装着大杀器
  const { c: c1, R, run } = rogue("P7-BPOLD");
  run.installed = { torque: "bp_trevor_bigkill" };
  run.party[0].weaponLevels.torque = 3;
  assert.deepEqual(plain(R.weaponModsOf(run)), {});
  const v = R.heroView(run, run.party[0]).weapons[0];
  assert.equal(v.bpOff, true, "界面能标出不生效");
  assert.equal(v.durMax, c1.weaponBaseDur("torque", 3), "耐久上限不吃大杀器");
  c1.S.LEDGER.dur.torque = v.durMax;
  // 升到 4 级：图纸开始生效，当前耐久跟着压到新上限
  run.stage = "board"; run.smiths = ["zekahr"];
  R.upgradeWeapon(run, "torque", "zekahr");
  assert.ok(R.weaponModsOf(run).torque.bigKill);
  const v4 = R.heroView(run, run.party[0]).weapons[0];
  assert.equal(v4.bpOff, false);
  assert.ok(v4.durMax < c1.weaponBaseDur("torque", 4));
  assert.equal(v4.dur, v4.durMax);

  // 规则读加成的地方（mods.js · bpUnlocked）：直接写进 state.weaponMods 也不生效
  const { c, st, kolt } = trpg();
  st.weaponMods = { torque: { block: 10, noPassive: true, atk: -4 } };
  assert.deepEqual(plain(c.bpMod(kolt)), {});
  assert.equal(c.passiveOn(kolt), true);
  c.setOwnedWeaponLevel(kolt, "torque", 4);
  assert.equal(c.bpMod(kolt).block, 10);
  assert.equal(c.passiveOn(kolt), false);

  // 跑团后台把武器降到 3 级：图纸留在武器上，但不再生效
  const t = trpg();
  t.c.setOwnedWeaponLevel(t.kolt, "torque", 4);
  t.c.bagAdd("bp_trevor_bigkill", 1);
  t.c.trpgInstallBlueprint("kolt", "torque", "bp_trevor_bigkill", 0, false);
  const cut = t.c.weaponDurMax("torque");
  t.c.trpgBackstageApply({ heroes: { kolt: { weapons: { torque: { level: 3 } } } } });
  assert.equal(t.kolt.weaponBlueprints.torque, "bp_trevor_bigkill");
  assert.equal(t.c.S.state.weaponMods, null);
  assert.ok(t.c.weaponDurMax("torque") > cut, "耐久上限回到没装图纸的样子");
  // 战斗后台改等级也一样
  t.c.Commands.dispatch({ type: "backstage", action: "weaponLevel", actor: t.kolt.id, kit: "torque", value: 4 });
  assert.ok(t.c.S.state.weaponMods.torque.bigKill);
});

test("客制化 4 级门槛写在界面上（单局工匠、队伍栏；跑团图纸面板）", () => {
  const ui = src("rogue-ui.js"), tu = src("trpg-ui.js");
  assert.match(ui, /w\.level < minLv/);
  assert.match(ui, /级才解锁客制化（现在 \$\{w\.level\} 级）/);
  assert.match(ui, /w\.bpOff \?/);
  assert.match(tu, /武器不到 \$\{minLv\} 级，不生效/);
  assert.match(tu, /级才解锁客制化（现在 \$\{lv\} 级）/);
});

/* ---------- 3. 跑团存档空位 ---------- */
test("跑团空位：删掉的团不会因为旧键 anterscale-campaign 被重写而回来", () => {
  const c = H.load();
  const ls = c.localStorage;
  ls.setItem("anterscale-campaign", JSON.stringify({ party: [{ kit: "kolt", level: 3 }], kuizhi: 50, ledger: { day: 4 } }));
  assert.equal(c.trpgReadSlots()[0].name, "团 1", "第一次打开：旧版的队伍记忆搬进空位 1");
  c.trpgWriteSlot(1, { name: "团B", campaign: { party: [{ kit: "ruby", level: 7 }], kuizhi: 999, ledger: { day: 9 } }, log: [] });
  // 战斗画面一直在重写旧键（game.js · rememberCampaign、trpg-ui.js · applySlotData）
  ls.setItem("anterscale-campaign", JSON.stringify({ party: [{ kit: "ruby", level: 7 }], kuizhi: 999, ledger: { day: 9 } }));
  c.trpgClearSlot(0);
  c.trpgClearSlot(1);
  assert.deepEqual(plain(c.trpgReadSlots()), [null, null, null]);
  assert.deepEqual(plain(c.trpgReadSlots()), [null, null, null], "再读也不会回来");
});

test("跑团空位：文件坏了先另存 .broken；读得出来的团留着，写新团不会把别的团当空位冲掉", () => {
  const c = H.load();
  const ls = c.localStorage, KEY = "anterscale-trpg-slots";
  c.trpgWriteSlot(0, { name: "团A", campaign: null, log: [] });
  c.trpgWriteSlot(2, { name: "团C", campaign: null, log: [] });
  const raw = ls.getItem(KEY);
  const cut = raw.slice(0, raw.length - 3);   // 写到一半断电
  ls.setItem(KEY, cut);
  assert.deepEqual(plain(c.trpgReadSlots()), [null, null, null]);
  assert.equal(ls.getItem(KEY + ".broken"), cut, "原样另存");
  assert.match(c.trpgSlotsProblem(), /\.broken/);
  assert.ok(c.trpgWriteSlot(1, { name: "团B", campaign: null, log: [] }));
  assert.equal(ls.getItem(KEY + ".broken"), cut, "备份不会被冲掉");
  assert.equal(c.trpgSlotsProblem(), null);
  // 只有一部分坏了：好的团照旧留着
  ls.setItem(KEY, JSON.stringify([{ name: "团A", campaign: null, log: [] }, 5, null]));
  const slots = c.trpgReadSlots();
  assert.equal(slots[0].name, "团A");
  assert.equal(slots[1], null);
  assert.equal(ls.getItem(KEY + ".broken"), JSON.stringify([{ name: "团A", campaign: null, log: [] }, 5, null]));
  // 备份都存不下（存储满了）：不写，免得把读不出来的团冲掉
  const c2 = H.load();
  c2.localStorage.setItem(KEY, "{坏");
  const set = c2.localStorage.setItem;
  c2.localStorage.setItem = (k, v) => { if (k === KEY + ".broken") throw new Error("满了"); set(k, v); };
  assert.equal(c2.trpgWriteSlot(0, { name: "新团", campaign: null, log: [] }), false);
  assert.equal(c2.localStorage.getItem(KEY), "{坏");
  assert.match(c2.trpgSlotsProblem(), /没能另存备份/);
});

/* ---------- 4. 遭遇战胜利经验 ---------- */
test("遭遇战胜利的额外经验只给战斗结束时还站着的人（倒地、战后被救回 1 血的没有）", () => {
  const { c, R, run } = rogue("P7-AMBXP");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "rest", done: false };
  run.ambushChance = 1;
  R.restAtNode(run, "long");
  assert.ok(run.ambush, "被偷袭");
  c.BattleSim.setup(R.battleSpec(run)); c.startCombat();
  const st = c.S.state;
  const kolt = c.findKit("kolt", st.units);
  kolt.layers.forEach(l => { l.current = 0; }); kolt.dying = true;
  st.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  const xp0 = Object.fromEntries(run.party.map(h => [h.kit, h.xp]));
  c.settleBattleRewards("win");
  const notes = R.finishBattle(run, "win").join("\n");
  assert.match(notes, /Helumica 遭遇战胜利经验/);
  assert.doesNotMatch(notes, /柯尔特 遭遇战胜利经验/);
  assert.ok(run.party.find(h => h.kit === "helu").xp > xp0.helu);
  assert.match(notes, /柯尔特 从濒死中缓过来/, "倒地的人照常被救回 1 点生命");
});

/* ---------- 5. 崔佛折扣文字 ---------- */
test("崔佛关系变好打 85 折：文字写「85 折」（以前写成 9 折），实收照旧 ×0.85", () => {
  const { R, run } = rogue("P7-TRV");
  run.stage = "board"; run.smiths = ["trevor"];
  assert.match(R.smithInfo(run, "trevor").priceNote, /打 85 折/);
  R.introduceSmith(run, "trevor");
  const full = R.smithQuote(run, "trevor", 2).cost;
  for (let i = 0; i < 3; i++) R.upgradeWeapon(run, i % 2 ? "ecmo" : "torque", "trevor");
  assert.match(R.smithInfo(run, "trevor").priceNote, /总价 85 折/);
  assert.equal(R.smithQuote(run, "trevor", 2).cost, Math.max(100, Math.round(full * 0.85 / 100) * 100));
  run.smiths = ["nurhamid"];
  assert.match(R.smithInfo(run, "nurhamid").priceNote, /加工费 8 折/);
});

/* ---------- 6. 两套天数 ---------- */
test("单局：顶栏的天数和整局数据用同一个（时钟过 0 点不另算一天）；旧存档读进来以本局为准", () => {
  const { c, R, run } = rogue("P7-DAYS");
  const L = c.S.LEDGER;
  c.S.LEDGER.clock = 23 * 60;
  const notes = [];
  c.ledgerAdvance(3, notes);
  assert.equal(L.day, run.day);
  assert.ok(notes.some(n => n.includes("过了 0 点，短休次数刷新")));
  L.clock = 22 * 60;
  const rest = c.ledgerLongRest({ force: true, hours: 8 }, []);
  assert.equal(L.day, run.day, "长休睡过 0 点也不另算");
  assert.ok(rest.notes.some(n => /^醒来：06:00/.test(n)));
  R.acceptTask(run, "main");
  run.task.nodes = [{ type: "rest", done: false }]; run.task.cols = [["rest"]]; run.task.pick = [0];
  R.restAtNode(run, "short");   // 完成主线：过掉任务天数
  assert.equal(run.day, 1 + run.main.days);
  assert.equal(L.day, run.day);
  // 整局数据里这一场的时间就是顶栏的那一天
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], before: () => R.applyPartyToField(run) });
  c.startCombat();
  c.settleBattleRewards("retreat");
  assert.match(L.career.battles.slice(-1)[0].when, new RegExp(`^第 ${run.day} 天`));
  // 旧存档：两边早就对不上了
  R.save(run);
  const c2 = H.load();
  const saved = JSON.parse(c.localStorage.getItem(c.SaveStore.KEYS.run));
  saved.data.world.ledger.day = 2;
  c2.localStorage.setItem(c2.SaveStore.KEYS.run, JSON.stringify(saved));
  const run2 = c2.SaveStore.loadRun();
  c2.Rogue.enterRunMode(run2);
  assert.equal(c2.S.LEDGER.day, run2.day);
  // 跑团照旧：过 0 点进入下一天
  const t = trpg();
  t.c.S.LEDGER.clock = 23 * 60;
  t.c.trpgPassHours(2);
  assert.equal(t.c.S.LEDGER.day, 2);
});

/* ---------- 7. 规则 / 指令层的阶段守卫 ---------- */
test("阶段守卫：首领战撤退被拒绝（不算击败首领）；任务中途不能接新任务；指令层撤退看这场许不许撤", () => {
  const { c, R, run } = rogue("P7-GUARD");
  run.stage = "boss";
  const spec = R.battleSpec(run);
  assert.equal(spec.retreat, false);
  c.BattleSim.setup(spec); c.startCombat();
  assert.throws(() => R.finishBattle(run, "retreat"), /首领战不能撤退/);
  assert.equal(run.stage, "boss", "没有被当成击败首领");
  // 指令层：这场不许撤（单局首领战），撤退指令被拒绝
  assert.throws(() => c.Commands.dispatch({ type: "retreat" }, { game: { rogue: { spec: { retreat: false } } } }), /不能撤退/);
  assert.ok(!c.S.state.retreated);
  c.Commands.dispatch({ type: "retreat" }, { game: { rogue: { spec: { retreat: true } } } });
  assert.equal(c.S.state.retreated, true, "允许撤退的照常撤");
  // 任务中途接主线：拒绝，当前任务不变
  const b = rogue("P7-GUARD2");
  b.R.acceptTask(b.run, 0);
  const name = b.run.task.name, index = b.run.task.index;
  assert.throws(() => b.R.acceptTask(b.run, "main"), /不在任务板前/);
  assert.equal(b.run.task.name, name);
  assert.equal(b.run.task.index, index);
  assert.equal(b.run.main.done, false);
});

/* ---------- 8. 存档边角 ---------- */
test("存档：更高版本的存档不当成没有存档，开新局前提醒会覆盖", () => {
  const c = H.load();
  const S = c.SaveStore, ls = c.localStorage;
  assert.equal(S.status("run"), "none");
  ls.setItem(S.KEYS.run, JSON.stringify({ kind: "run", version: S.CURRENT.run + 1, savedAt: 0, data: { act: 9 } }));
  assert.equal(S.loadRun(), null, "这一版读不懂");
  assert.equal(S.status("run"), "newer");
  assert.equal(c.Commands.dispatch({ type: "run.session", action: "savedStatus" }, {}), "newer");
  assert.ok(ls.getItem(S.KEYS.run), "原样留着，不当坏档");
  assert.equal(ls.getItem(S.KEYS.run + ".broken"), null);
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "P7-SAVE" });
  c.Rogue.save(run);
  assert.equal(S.status("run"), "ok");
  // 开新局前问一句（单局界面），标题上也不说「没有进行中的一局」
  const ui = src("rogue-ui.js");
  assert.match(ui, /sessionCommand\("savedStatus"\)/);
  assert.match(ui, /saved === "newer"/);
  assert.match(src("screens.js"), /savedStatus/);
});

test("存档：升级函数出错、结构坏了但 JSON 合法的，都另存 .broken 再当作没有", () => {
  const c = H.load();
  const S = c.SaveStore, ls = c.localStorage;
  const put = (env) => { const raw = JSON.stringify(env); ls.setItem(S.KEYS.run, raw); return raw; };
  S.MIGRATE.run[1] = () => { throw new Error("升级坏了"); };
  let raw = put({ kind: "run", version: 1, savedAt: 0, data: { act: 2 } });
  assert.equal(S.loadRun(), null, "不再把异常抛出去");
  assert.equal(ls.getItem(S.KEYS.run + ".broken"), raw);
  raw = put({ kind: "run", version: S.CURRENT.run, savedAt: 0, data: "不是对象" });
  assert.equal(S.loadRun(), null);
  assert.equal(ls.getItem(S.KEYS.run + ".broken"), raw);
  raw = put({ kind: "run", version: S.CURRENT.run, savedAt: 0, data: { act: 1, party: "x" } });
  assert.equal(S.loadRun(), null);
  assert.equal(ls.getItem(S.KEYS.run + ".broken"), raw);
  assert.equal(S.status("run"), "broken");
  // meta 结构坏了：给默认值，原来的另存一份
  raw = JSON.stringify({ kind: "meta", version: S.CURRENT.meta, savedAt: 0, data: [1, 2] });
  ls.setItem(S.KEYS.meta, raw);
  assert.deepEqual(plain(S.loadMeta().stats), { runs: 0, wins: 0, deaths: 0 });
  assert.equal(ls.getItem(S.KEYS.meta + ".broken"), raw);
});

/* ---------- 9. 跑团放弃这场战斗 ---------- */
test("跑团放弃这场战斗：耐久和「长休一次」技能的使用记录也回到开战前", () => {
  const { c } = trpg();
  const L = c.S.LEDGER;
  const before = { ledger: L.save() };   // 开战前存下的队伍记忆（game.js · rememberCampaign）
  const dur0 = c.weaponDur("torque");
  c.spendDurability("torque", 2, "发动格挡", []);
  assert.ok(c.useRestOnce("kolt", "rally", 1));
  assert.equal(c.useRestOnce("kolt", "rally", 1), false, "这场里用掉了");
  assert.equal(c.trpgAbandonBattle(before), true);
  assert.equal(c.weaponDur("torque"), dur0);
  assert.ok(c.useRestOnce("kolt", "rally", 1), "回到开战前：还能再用");
  assert.equal(c.trpgAbandonBattle(null), false);
  // 界面：没结算就回到探索环节时调用（结算过的战斗不回滚）
  assert.match(src("trpg-ui.js"), /if \(state\.combatStarted && !GAME\.ended\) trpgAbandonBattle\(GAME\.campaign\)/);
});

/* ---------- 10. 试玩工具带龙哥 ---------- */
test("试玩工具能带龙哥；R1 冻结的样本和名单不变", () => {
  const B = require("../tools/balance-common");
  const M = require("../tools/balance-report");
  assert.ok(B.HEROES.includes("longge"));
  assert.doesNotThrow(() => B.validateParty(["longge", "tou"]));
  assert.equal(B.MAIN_ATTR.longge, "int");
  const m = M.createManifest();
  assert.ok(!m.heroes.includes("longge"));
  const frozen = JSON.parse(fs.readFileSync(path.join(H.ROOT, "docs/r1/manifest.json"), "utf8"));
  assert.equal(m.scenariosHash, frozen.scenariosHash);
  const { runCampaign } = require("../tools/playtest");
  const r = runCampaign({ seed: "P7-LONGGE", party: ["longge", "tou"], maxSteps: 60 });
  assert.notEqual(r.outcome, "error", JSON.stringify(r.bugs));
  assert.equal(r.bugs.length, 0);
});

/* ---------- 11. 80 小时力竭致死 ---------- */
test("跑团：短休、补给不够只能消磨时间的长休推过 80 小时也力竭致死，并记进档案", () => {
  const a = trpg();
  a.c.S.LEDGER.hours = 79.5;
  const notes = a.c.trpgShortRest(null);
  assert.ok(heroesOf(a.c).every(u => u.dead));
  assert.ok(notes.some(n => /力竭致死。$/.test(n)));
  assert.ok(Object.values(a.c.S.LEDGER.heroes).every(h => h.dead), "存进档案");
  const b = trpg();
  b.c.S.LEDGER.hours = 75;
  b.c.setLedgerWater(0);
  const n2 = b.c.trpgLongRest({});
  assert.ok(n2.some(n => /补给不足/.test(n)));
  assert.equal(b.c.S.LEDGER.hours, 83);
  assert.ok(heroesOf(b.c).every(u => u.dead));
  assert.ok(Object.values(b.c.S.LEDGER.heroes).every(h => h.dead));
  // 没到 80 小时的照常活着
  const d = trpg();
  d.c.S.LEDGER.hours = 70;
  d.c.trpgShortRest(null);
  assert.ok(heroesOf(d.c).every(u => !u.dead));
});

test("单局：休息点短休、进下一站前短休推过 80 小时，本局力竭结束", () => {
  const { c, R, run } = rogue("P7-EXH");
  R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  c.S.LEDGER.hours = 79.5;
  const notes = R.shortRestBeforeNode(run).join("\n");
  assert.equal(run.stage, "over");
  assert.equal(run.party.length, 0);
  assert.match(notes, /力竭致死/);
  assert.match(run.result.text, /力竭致死/);
  const b = rogue("P7-EXH2");
  b.R.acceptTask(b.run, "main");
  b.run.task.nodes[b.run.task.index] = { type: "rest", done: false };
  b.c.S.LEDGER.hours = 79.5;
  b.R.restAtNode(b.run, "short");
  assert.equal(b.run.stage, "over");
  assert.equal(b.run.fallen.length, 2);
});

/* ---------- 12. 属性硬上限 10 ---------- */
test("属性硬性上限 10：单局加点选项不列满 10 的，跑团加点 / 跑团后台 / 战斗后台都加不过 10", () => {
  const { R, run } = rogue("P7-ATTR");
  const h = run.party[0];
  h.attrs = Object.assign({}, R.cardOf("kolt").attrs, { str: 10 });
  h.pending = [{ type: "attr", level: 4, noRepeat: false }, { type: "attr", level: 8, noRepeat: true, solo: true }];
  assert.ok(!R.choiceOptions(run, "kolt", 0).some(o => o.value === "str"));
  assert.ok(R.choiceOptions(run, "kolt", 0).some(o => o.value === "con"));
  assert.throws(() => R.choose(run, "kolt", 0, "str"), /不可选/);
  assert.equal(h.attrs.str, 10);

  const { c, kolt } = trpg();
  kolt.attrs.str = 10; kolt.attrPoints = 1;
  assert.match(c.trpgSpendAttr("kolt", "str").join(""), /最高 10/);
  assert.equal(kolt.attrs.str, 10);
  assert.equal(kolt.attrPoints, 1, "点数没花掉");
  c.trpgBackstageApply({ heroes: { kolt: { attrs: { con: 14 } } } });
  assert.equal(kolt.attrs.con, 10);
  kolt.attrs.dex = 9;
  c.Commands.dispatch({ type: "backstage", action: "attr", actor: kolt.id, attr: "dex", value: 12 });
  assert.equal(kolt.attrs.dex, 10);
  assert.equal(kolt.attrPoints, 0);
  // 跑团加点按钮不列已满 10 的
  assert.match(src("trpg-ui.js"), /filter\(k => \(Number\(\(h\.attrs \|\| \{\}\)\[k\]\) \|\| 0\) < ATTR_HARD_MAX\)/);
});

/* ---------- 13. 后台等级上限 ---------- */
test("后台等级上限：武器 1–10，跑团角色 1–20", () => {
  const { c, kolt } = trpg();
  c.setOwnedWeaponLevel(kolt, "torque", 15);
  assert.equal(kolt.weaponLevels.torque, 10);
  c.Commands.dispatch({ type: "backstage", action: "weaponLevel", actor: kolt.id, kit: "torque", value: 99 });
  assert.equal(kolt.weaponLevels.torque, 10);
  assert.equal(kolt.weaponAtk, c.computeWeaponAtk("torque", kolt.attrs, 10, c.weaponPartsOf(kolt, "torque")));
  c.setOwnedWeaponLevel(kolt, "torque", 0);
  assert.equal(kolt.weaponLevels.torque, 1);
  c.trpgBackstageApply({ heroes: { kolt: { level: 25 } } });
  assert.equal(kolt.level, 20);
  assert.match(src("trpg-ui.js"), /data-bs-lv="\$\{k\}" min="1" max="20"/);
});

/* ---------- 14. 图鉴 ---------- */
test("角色图鉴：1 级数值是实际算出来的（瑞比架势 4，不是卡面的 3），翻图鉴不消耗随机数", () => {
  const c = H.load();
  c.S.RNG.install("P7-CODEX");
  const draws = c.S.RNG.draws();
  const entries = c.codexHeroEntries();
  assert.equal(c.S.RNG.draws(), draws, "不消耗随机数");
  for (const e of entries) {
    const u = c.spawnLiveCard(c.livePartyCards().find(x => x.kit === e.kit), 1);
    assert.equal(e.sheet.defMax, u.defMax, e.kit + " 架势");
    assert.equal(e.sheet.shpMax, u.shpMax, e.kit + " 坚毅");
    assert.deepEqual(plain(e.sheet.layers.map(l => l.max)), plain(u.layers.map(l => l.max)), e.kit + " 血量");
    assert.equal(e.sheet.atk, u.atk, e.kit + " atk");
  }
  assert.equal(entries.find(e => e.kit === "ruby").sheet.defMax, 4);
});

test("配置物图鉴：超充能电池摧毁时打同区所有单位（不分敌我）", () => {
  const c = H.load();
  const lines = c.codexPropEntries().find(p => p.id === "battery").lines.join("");
  assert.match(lines, /同区域所有单位（不分敌我）/);
  assert.doesNotMatch(lines, /同阵营单位造成/);
});

/* ---------- 15. 医疗包只治内层 ---------- */
test("医疗包「治疗内层生命」：只补最内层，不溢到外层装甲（战斗中、战斗外都是）；短休照旧从内往外补", () => {
  const { c, kolt } = trpg();
  const reset = () => { kolt.layers = [{ type: "armor", current: 0, max: 10 }, { type: "flesh", current: 15, max: 20, inner: true }]; };
  reset();
  c.bagAdd("medkit", 2);
  c.useItemOn(kolt, "medkit", kolt);
  assert.equal(kolt.layers[0].current, 0, "战斗中：装甲不动");
  assert.equal(kolt.layers[1].current, 20);
  reset();
  c.ledgerHealItem("medkit", "kolt", []);
  assert.equal(kolt.layers[0].current, 0, "战斗外：装甲不动");
  assert.equal(kolt.layers[1].current, 20);
  // 错位把内层换到外面：照样补内层那一层
  kolt.layers = [{ type: "flesh", current: 5, max: 20, inner: true }, { type: "armor", current: 0, max: 10 }];
  c.bagAdd("clinic", 1);
  c.useItemOn(kolt, "clinic", kolt);
  assert.ok(kolt.layers[0].current > 5);
  assert.equal(kolt.layers[1].current, 0);
  // 短休恢复的是「血量」：补满内层后继续补外层
  kolt.layers = [{ type: "armor", current: 0, max: 10 }, { type: "flesh", current: 19, max: 20, inner: true }];
  c.trpgShortRest(["kolt"]);
  assert.ok(kolt.layers[0].current > 0);
});

/* ---------- 16. 跑团任务模板报酬 ---------- */
test("跑团任务模板的报酬照主持人手册（按任务长度给奎支，经验按队伍等级），主持人能改", () => {
  const { c } = trpg();
  const t = c.trpgTaskTemplate("clear");
  assert.ok(t.reward.kuizhi >= 2000 && t.reward.kuizhi <= 3000, "短任务 2000～3000");
  assert.equal(t.reward.xp, 70, "短任务、队伍 1–4 级：每人 70");
  const esc = c.trpgTaskTemplate("escort");
  assert.equal(esc.reward.intactKuizhi, Math.round(esc.reward.kuizhi * vm.runInContext("ESCORT_RULES.intactBonus", c)));
  heroesOf(c).forEach(u => { u.level = 6; });
  assert.equal(c.trpgTaskTemplate("clear").reward.xp, 100, "队伍 5–8 级：每人 100");
  assert.deepEqual(plain(c.trpgTaskHandbookPay(4, 1)), { name: "中", kuizhi: 7000, range: [6000, 8000], xp: 100 });
  assert.deepEqual(plain(c.trpgTaskHandbookPay(8, 13)), { name: "长", kuizhi: 15000, range: [12000, 18000], xp: 2000 });
  assert.deepEqual(plain(c.trpgTaskHandbookPay(15, 20)), { name: "极难", kuizhi: 25000, range: [20000, 30000], xp: 10000 });
  // 新建草稿用的就是这份默认值；保存时主持人改的数照收
  c.trpgTaskCreate("scout");
  const task = c.trpgTasks().slice(-1)[0];
  assert.equal(task.reward.xp, 100);
  c.trpgTaskSave(Object.assign(plain(task), { reward: Object.assign(plain(task.reward), { kuizhi: 4321 }) }));
  assert.equal(c.trpgTaskById(task.id).reward.kuizhi, 4321);
  assert.match(src("trpg-ui.js"), /trpgTaskHandbookPay\(t\.days, trpgPartyLevel\(\)\)/);
});

/* ---------- 17. 跑团战斗配置：损毁地面、隔离区 ---------- */
test("战场配置能放损毁地面和隔离区（规则层本来就支持，以前选不到）", () => {
  const { c, st } = trpg();
  c.Commands.dispatch({ type: "battle.panel", action: "setField", zone: 1, kind: "ruinOn" });
  assert.equal(st.fields[1].ruinOn, true);
  assert.ok(st.fields[1].ruinHp > 0);
  c.Commands.dispatch({ type: "battle.panel", action: "setField", zone: 2, kind: "isolate" });
  assert.equal(st.fields[2].isolate, true);
  st.weather = "heat";
  const foe = st.units.find(u => !u.isPlayer);
  foe.zone = 2;
  assert.equal(c.currentWeatherFor(foe), "none", "隔离区不吃天气");
  assert.match(src("game.js"), /\["ruinOn", "损毁地面"\], \["isolate", "隔离区"\]/);
});
