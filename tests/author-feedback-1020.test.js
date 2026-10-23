// 作者试玩反馈（10/20）重做（issue #356）：联机敌人等级跟队伍、柯尔特满血减伤的仪表、协助攻击打死自爆小车时的演出
// （README「规则改动记录」里有对应说明；浏览器里的那几条在 tests/online-gm-ui.test.js、tests/battle-fx-ui.test.js）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");
const H = require("./headless");

const plain = x => JSON.parse(JSON.stringify(x));
const load = (c, file) => vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });

/* ---------- 1. 联机：敌人等级跟着队伍等级 ---------- */

/** 两名英雄 6 级、9 级：队伍平均 7.5 → 8（trpg-tasks.js · trpgPartyLevel，四舍五入） */
function partyAt8() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 2, zone: 2 }], seed: "FB20-LV" });
  const hs = c.S.state.units.filter(u => u.isPlayer && !u.weaponOf);
  hs[0].level = 6; hs[1].level = 9;
  assert.equal(c.trpgPartyLevel(), 8);
  return c;
}

test("联机主持人「生成敌人」：等级框默认填队伍平均等级（以前固定填 1）", () => {
  const c = partyAt8();
  // 主持人工具（online-gm-ui.js）装进规则环境；假的网页只记下面板的 HTML
  const made = [];
  const node = () => ({ id: "", className: "", innerHTML: "", addEventListener() {}, removeEventListener() {}, remove() {}, contains: () => false, querySelector: () => null });
  c.document = { body: { appendChild: n => made.push(n) }, activeElement: null, createElement: node, addEventListener() {}, removeEventListener() {} };
  load(c, "online-gm-ui.js");
  const st = c.S.state;
  const view = { active: true, isHost: true, mode: "trpg", manualPhase: false, manual: {}, state: plain({ units: st.units, props: st.props || [], zoneMode: st.zoneMode }) };
  c.OnlineGMUI.mount({ getView: () => view, submit: async () => ({ ok: true }) }).open();
  const html = made[0].innerHTML;
  const input = /<input id="ogm-enemy-level"[^>]*>/.exec(html);
  assert.ok(input, "面板里有等级框");
  assert.match(input[0], /value="8"/, "默认填队伍平均等级：" + input[0]);
  assert.match(input[0], /type="number"/, "照样是能改的数字框");
});

/** 联机房主（online-game.js）：传输层、画面都是假的（照 tests/online-host.test.js），开战（GAME.setupBattle）只记下传进来的等级 */
async function onlineHost(c) {
  let status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }] }, statusListener;
  const state = c.S.state, setups = [], errors = [];
  c.console = { error: e => errors.push(String(e)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.queueMicrotask = queueMicrotask;
  c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    refresh() {}, disarm() {}, resumeHotseat() {}, onlineCheckpoint: () => plain({ state }), restoreOnline() {}, resumeOnline: async () => {},
    setupBattle(level, encounter) { setups.push({ level, encounter }); },
    async actSystem(cmd, meta, context) {
      this.depth++;
      try { const value = c.HotseatGame.system(cmd, context); c.OnlineGame.onActionSettled(cmd, value, [], meta); return value; }
      finally { this.depth--; }
    } };
  c.Screens = { current: () => "trpg", is: s => s === "trpg" };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  c.OnlineView = { projectPacket: p => plain({ ...p, displayOnly: true }), projectLogs: rows => plain(rows) };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: "backfire-d3-v1", protocol: 1 }),
    onMessage() {}, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async () => ({ ok: true }), async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-wire.js", "online-game.js"]) load(c, file);
  await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  return { setups, errors };
}

test("联机主持人换遭遇（gm.setEncounter）：遭遇里没写等级的敌人按队伍平均等级开战（以前跟顶栏手选的等级，默认 Lv1）", async () => {
  const c = partyAt8();
  const f = await onlineHost(c);
  c.S.TRPG.active = true;   // 联机跑团（TrpgFlow.enter 打开的那个团）
  const enc = vm.runInContext("ENCOUNTERS[0].id", c);
  const ack = await c.OnlineGame.submit({ type: "gm.setEncounter", encounter: enc });
  assert.equal(ack.ok, true, ack.error);
  assert.deepEqual(plain(f.setups), [{ level: 8, encounter: enc }], "按队伍平均等级开战");
  assert.deepEqual(f.errors, []);
});

test("联机跑团：战斗模板里「Lv随队」的敌人、援军、配置物按队伍平均等级（battle-templates.js · btPartyLevel）；写了等级的照写的", () => {
  const c = partyAt8();
  c.S.TRPG.active = true;
  const t = c.battleTemplateNormalize({ name: "随队", board: 2, playerZone: 1,
    enemies: [{ preset: "thug_knife", zone: 2 }, { preset: "thug_hammer", level: 3, zone: 2 }],
    waves: [{ turns: 2, enemies: [{ preset: "thug_knife", zone: 2 }] }],
    props: [{ kind: "boom", zone: 2, faction: "enemy" }] });
  const enc = plain(c.battleTemplateToEncounter(t));
  assert.deepEqual(enc.enemies.map(e => e.level), [8, 3]);
  assert.deepEqual(enc.waves[0].enemies.map(e => e.level), [8], "援军");
  assert.equal(enc.features.find(f => f.type === "prop").level, 8, "配置物");
});

/* ---------- 2. 柯尔特「过度自信」：仪表和实际生效同一个判断 ---------- */

/** 柯尔特 + Helumica 对狂徒，都在 1 区。角色仪表（hud-icons.js）和联机投影（online-view.js）装进同一个环境：和画面里一样，能直接调用规则里的函数 */
function koltSetup() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "FB20" });
  c.startCombat();
  load(c, "hud-icons.js");
  load(c, "online-view.js");
  const S = c.S.state;
  S.units.forEach(u => { u.zone = 1; });
  const kolt = S.units.find(u => u.kit === "kolt"), foe = S.units.find(u => u.kit === "thug_knife");
  return { c, S, kolt, foe, HI: c.HudIcons,
    gauge: () => c.HudIcons.gaugeState(kolt, S.units),
    // 联机玩家收到的仪表：房主按白名单投影好的（online-view.js · projectUnit 的 hud）
    online: () => plain(c.OnlineView.projectUnit(kolt).hud) };
}
const hitKolt = (c, a, t) => c.dealTo(a, t, { atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
const prideIn = out => /过度自信：血量不低于进入战斗时的上限/.test(((out && out.res && out.res.log) || []).join("\n"));

test("柯尔特满血减伤：临时护盾把上限抬高时规则照样减伤，仪表也亮（以前按现在的上限算，写「未满血」）；联机玩家收到的仪表一样", () => {
  const { c, kolt, foe, HI, gauge, online } = koltSetup();
  const base = c.baseMaxHp(kolt);
  assert.equal(kolt.prideMaxHp, base, "开战记下进入战斗时的上限");
  assert.equal(gauge().full, true, "开战满血：亮");
  // 掉一点血：不亮、不减
  kolt.layers[kolt.layers.length - 1].current -= 3;
  assert.equal(gauge().full, false);
  assert.match(HI.gauge(gauge()), /未满血/);
  // 拿到临时护盾：现有血量回到进入战斗时的上限以上（现在的上限也被抬高了）
  c.addTempShield(kolt, 10);
  assert.ok(c.totalCurHp(kolt) >= base && c.totalCurHp(kolt) < c.totalMaxHp(kolt), "够进入战斗时的上限、不到现在的上限");
  assert.equal(gauge().full, true, "仪表跟着亮");
  assert.match(HI.gauge(gauge()), /满血减伤 25%/);
  assert.equal(online().full, true, "联机玩家收到的仪表也亮");
  assert.match(HI.gauge(online()), /满血减伤 25%/);
  // 规则也是同一个判断：现在生效，真的挨打时结算里有过度自信减伤
  assert.equal(c.koltPrideCut(kolt), 0.25);
  assert.ok(prideIn(hitKolt(c, foe, kolt)), "真的挨打时结算里有过度自信减伤");
});

test("柯尔特满血减伤：被动被图纸放弃时规则不减伤，仪表不亮、写「过度自信已放弃」（以前照亮「满血减伤」）；起身中写「起身中不减伤」；联机玩家收到的一样", () => {
  const { c, S, kolt, foe, HI, gauge, online } = koltSetup();
  S.weaponMods = { torque: { noPassive: true } };
  kolt.weaponLevels = Object.assign({}, kolt.weaponLevels, { torque: 4 });   // 图纸的武器 4 级才生效
  assert.equal(c.passiveOn(kolt), false, "图纸放弃了柯尔特的被动");
  assert.equal(gauge().full, false, "仪表不亮");
  assert.match(HI.gauge(gauge()), /过度自信已放弃/);
  assert.deepEqual([online().full, online().noPassive], [false, true]);
  assert.match(HI.gauge(online()), /过度自信已放弃/);
  assert.equal(c.koltPrideCut(kolt), 0);
  assert.ok(!prideIn(hitKolt(c, foe, kolt)), "结算也不减");
  // 起身中（靠坚毅生命）：不减伤，仪表写明
  S.weaponMods = {};
  kolt.upOnShp = true;
  kolt.layers.forEach(l => { l.current = l.max; });
  assert.equal(gauge().full, false);
  assert.match(HI.gauge(gauge()), /起身中不减伤/);
  assert.match(HI.gauge(online()), /起身中不减伤/);
  assert.equal(c.koltPrideCut(kolt), 0);
  assert.doesNotMatch(JSON.stringify(online()), /shp|坚毅/i, "仪表的数据里没有坚毅生命");
});

/* ---------- 3. 协助攻击打死自爆小车：演出 ---------- */

/** 柯尔特、Helumica 和敌人都在 1 区；记下弹字（画面层 game.js 也是这样接 spawnPopup 的：带上那一刻的 popTag） */
function popSetup(enemies) {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: "FB20-BOOM" });
  c.startCombat();
  const S = c.S.state;
  S.units.forEach(u => { u.zone = 1; });
  const pops = [];
  c.spawnPopup = (u, spec) => { if (u) pops.push(Object.assign({ unitId: u.id, tag: S.popTag || null }, spec || {})); };
  return { c, S, pops, k: kit => S.units.find(u => u.kit === kit) };
}
const dmgPops = pops => pops.filter(p => p.kind === "dmg" && (Number(p.value) || 0) > 0);

test("协助攻击打死自爆小车：先是打死它的那一下，再引爆（有自己的演出），炸到的人跟在后面；引爆的伤害标成爆炸、不算协助攻击本身（以前先炸后挨打，炸到的每个人都算主攻击）", () => {
  const { c, S, pops, k } = popSetup([{ id: "boomcar", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = k("kolt"), helu = k("helu"), car = k("boomcar"), thug = k("thug_knife");
  car.atk = Math.max(8, Number(car.atk) || 0);   // 引爆伤害 = atk / 2：确保打得出数字
  car.layers.forEach(l => { l.current = Math.min(l.current, 1); });   // 一下就打死
  car.def = 0; car.stunned = true;
  thug.layers.forEach(l => { l.max = l.current = 300; });
  c.queueAssistAttack(kolt, car);
  assert.equal(S.assistQueue.length, 1, "失衡的小车进了协助攻击队列");
  c.finishAssist(helu.id, {});
  assert.equal(car._exploded, true, "小车被协助攻击打死、死亡引爆");
  const dmg = dmgPops(pops), onCar = dmg.filter(p => p.unitId === car.id), blast = dmg.filter(p => p.unitId !== car.id);
  const killing = onCar.find(p => p.main), boom = pops.find(p => p.kind === "carboom");
  assert.ok(killing, "协助攻击打小车的那一下是主攻击");
  assert.ok(boom && boom.unitId === car.id && boom.text === "引爆", "引爆有自己的演出（在小车身上）");
  assert.ok(blast.some(p => p.unitId === thug.id) && blast.length >= 2, "同区的人都挨了引爆");
  assert.ok(blast.every(p => !p.main), "引爆的伤害不是主攻击");
  assert.ok(blast.every(p => p.tag === "boom"), "引爆的弹字标成爆炸");
  assert.ok(pops.indexOf(killing) < pops.indexOf(boom) && pops.indexOf(boom) < pops.indexOf(blast[0]), "顺序：打死它的那一下 → 引爆 → 炸到的人");
  assert.equal(S.popTag || null, null, "爆炸标记用完还原");
  assert.ok(!car._holdBoom && !car._boomPending, "等着炸的标记清掉了");
  assert.match(S.logPages.flatMap(p => p.lines).map(l => l.text).join("\n"), /死亡引爆/);
});

test("自爆小车不是被一击打死的（持续伤害、别的爆炸、主持人击杀）：照旧当场引爆，同样有引爆的演出", () => {
  const { c, pops, k } = popSetup([{ id: "boomcar", lv: 3, zone: 1 }, { id: "thug_knife", lv: 1, zone: 1 }]);
  const car = k("boomcar"), thug = k("thug_knife");
  thug.layers.forEach(l => { l.max = l.current = 300; });
  car.layers.forEach(l => { l.current = 0; });
  const t0 = c.totalHp(thug);
  c.sweepDeadEnemies();
  assert.equal(car._exploded, true);
  assert.ok(c.totalHp(thug) < t0, "同区的狂徒挨了引爆");
  assert.ok(pops.some(p => p.kind === "carboom" && p.unitId === car.id), "引爆的演出");
  assert.ok(dmgPops(pops).every(p => p.tag === "boom" && !p.main), "炸到的人标成爆炸");
});

test("「引爆」只是战斗画面的演出：计算器页的弹字（app.js · spawnPopup）不为它多抽种子随机数，装了种子的模拟照旧复现", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "boomcar", lv: 3, zone: 1 }], seed: "FB20-RNG" });
  const car = c.S.state.units.find(u => u.kit === "boomcar"), draws = () => c.S.RNG.fn.draws();
  const d0 = draws();
  c.spawnPopup(car, { kind: "carboom", text: "引爆", element: "energy" });
  assert.equal(draws(), d0, "不抽随机数");
  vm.runInContext("Math.random()", c);
  assert.equal(draws(), d0 + 1, "（计数器本身管用）");
});

test("不在场上的替身打的不算主攻击：爆炸桶炸到人是连带伤害；我方操控的碎渣机炮那一炮照旧是主攻击", () => {
  const { c, S, pops, k } = popSetup([{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = k("kolt"), thug = k("thug_knife");
  thug.layers.forEach(l => { l.max = l.current = 300; });
  const scrap = c.makeProp("scrap", 1, 1);
  S.props.push(scrap);
  c.scrapShot(scrap, thug, kolt);
  const shots = dmgPops(pops).filter(p => p.unitId === thug.id);
  assert.ok(shots.length >= 1 && shots.every(p => p.main), "机炮打出的是主攻击");
  pops.length = 0;
  const boom = c.makeProp("boom", 1, 1);
  S.props.push(boom);
  c.hitStructureCore(kolt, "prop:" + boom.id, { dmg: 10, brk: 1, element: "fire" });
  const blast = dmgPops(pops).filter(p => p.unitId === thug.id);
  assert.ok(blast.length >= 1 && blast.every(p => !p.main), "爆炸桶炸到人是连带伤害");
});

/** 从源码里抠出一个函数（按大括号配对；抠的函数的字符串里没有大括号） */
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "找不到 " + name);
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}
/** 协助攻击（结人）打死自爆小车的演出带（玩家画面收到的样子）：打死它的那一下 → 引爆 → 炸到的人（tag boom） */
const BLAST_TAPE = [
  { type: "pop", unitId: "car", kind: "dmg", value: 6, element: "ice", main: true },
  { type: "pop", unitId: "car", kind: "carboom", text: "引爆", element: "energy" },
  { type: "pop", unitId: "tou", kind: "dmg", value: 4, element: "energy", tag: "boom" },
  { type: "pop", unitId: "thug", kind: "dmg", value: 4, element: "energy", tag: "boom" },
  { type: "pop", unitId: "thug", kind: "break", value: 1, element: "energy", tag: "boom" }
];
const BLAST_STATE = { units: [{ id: "car", level: 3 }, { id: "tou", level: 3 }, { id: "thug", level: 1 }, { id: "yuito", level: 3 }] };

test("攻击演出（game.js · strikePlan）：爆炸（tag boom）炸到的人不算这次出手的目标、不补打击形状；没有标主攻击时也只按自己打到的", () => {
  const g = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  const seen = [];
  const AttackFx = { resolve: info => { seen.push(info); return { kind: "shard", el: info.element }; }, scriptOf: () => null };
  const view = new Map([["yuito", { id: "yuito", kit: "yuito", isPlayer: true, zone: 1 }], ["car", { id: "car", kit: "boomcar", zone: 1 }],
    ["tou", { id: "tou", kit: "tou", isPlayer: true, zone: 1 }], ["thug", { id: "thug", kit: "thug_knife", zone: 1 }]]);
  const strikePlan = vm.runInNewContext(`(function () { ${fnSrc(g, "strikePlan")} return strikePlan; })()`, {
    window: { AttackFx }, AttackFx, G: { sim: false, view }, state: { zoneMode: 2 },
    unitById: id => view.get(id), zoneDist: (a, b) => Math.abs(a - b), piercedId: () => null, ownerIdOf: () => null, toMap: x => new Map(x)
  });
  const meta = { actorId: "yuito", targetId: "car", _cmd: { type: "assistAnswer" } };
  const st = strikePlan(meta, BLAST_TAPE, null);
  assert.deepEqual(plain(st.targets), ["car"], "炸到的人不算这次出手的目标（以前挨个算进去）");
  assert.deepEqual(st.mains.map(e => e.unitId), ["car"]);
  // 没有标主攻击的那种演出带：退回按「这次打到的伤害」，照样不把炸到的人算进去
  const loose = BLAST_TAPE.map(e => Object.assign({}, e, { main: false }));
  assert.deepEqual(strikePlan(meta, loose, null).mains.map(e => e.unitId), ["car"]);
  assert.equal(seen[seen.length - 1].targets, 1);
});

test("联机：引爆的演出（carboom、「引爆」）和爆炸标记（tag boom）照白名单发给玩家", () => {
  const V = require("../online-view");
  const out = plain(V.projectTape(BLAST_TAPE.concat([{ type: "pop", unitId: "thug", kind: "dmg", value: 4, element: "energy", tag: "<b>x</b>" }])));
  assert.deepEqual(out[1], { type: "pop", kind: "carboom", unitId: "car", element: "energy", text: "引爆" });
  assert.equal(out[0].tag, undefined, "打死它的那一下不是爆炸");
  assert.deepEqual(out.slice(2, 5).map(e => e.tag), ["boom", "boom", "boom"]);
  assert.equal(out[5].tag, undefined, "只认 boom");
});

test("新画面（hd2d/hd2d-fx.js · cues）：「引爆」和紧跟着炸到的那几下另成一组（blasts），不开新的一段、不算进打死小车的那一段", () => {
  const F = require("../hd2d/hd2d-fx.js");
  const tape = BLAST_TAPE.concat([{ type: "pop", unitId: "yuito", kind: "status", text: "振奋", element: "physical" }]);
  const cue = F.cues({ fx: { actor: "yuito", target: "car", move: { kind: "shard", el: "ice" } }, state: BLAST_STATE, tape }, {});
  assert.deepEqual(plain(cue.waves), [{ unitId: "car", el: "ice" }], "只有打死小车的那一段");
  assert.deepEqual(plain(cue.blasts), ["car"]);
  const show = list => list.map(n => n.unitId + ":" + n.text);
  assert.deepEqual(show(cue.numbers.filter(n => n.blast === 0)), ["car:引爆", "tou:4", "thug:4", "thug:击破1"], "引爆这一组：「引爆」+ 炸到的人");
  assert.deepEqual(show(cue.numbers.filter(n => n.blast == null)), ["car:6", "yuito:振奋"], "别的照旧跟着那一段");
});

test("新画面（hd2d/hd2d-play.js · play）：打死小车的那一段演完才炸开——震屏、爆炸形状、爆炸声，炸到的人的数字这时才弹；不在炸到的人身上补这次攻击的打击形状", async () => {
  const log = [];
  const el = () => ({ style: {}, childNodes: [], className: "", textContent: "", isConnected: true, setAttribute() {}, remove() { this.isConnected = false; },
    appendChild(ch) { ch.isConnected = true; this.childNodes.push(ch); if (this.id === "hd2d-pop") log.push(["num", ch.textContent]); return ch; } });
  const X = { car: 200, yuito: 350, tou: 500, thug: 800 };
  const rect = id => (X[id] == null ? null : { id, x: X[id], y: 400, w: 120, h: 40, left: X[id] - 60, top: 380, width: 120, height: 40 });
  const done = () => Promise.resolve();
  const c = vm.createContext({ console, setTimeout: () => 0, clearTimeout() {}, performance: { now: () => 0 },
    document: { createElement: el, body: el(), querySelector: () => null },
    AttackFx: { after: done, windup: done, travel: done, link: done, area() {}, ko() {}, sparks() {}, clash() {}, skip() {}, setClock() {},
      impact: (r, move) => log.push(["impact", move.kind, r && r.id]) },
    HitFx: { burst() {}, clear() {} } });
  c.window = c; c.self = c;
  for (const f of ["hd2d/hd2d-layout.js", "hd2d/hd2d-fx.js", "hd2d/hd2d-play.js"]) load(c, f);
  const packet = { fx: { actor: "yuito", target: "car", move: { kind: "shard", el: "ice" } }, state: BLAST_STATE, tape: BLAST_TAPE };
  await c.HD2DPlay.play(packet, { rectOf: rect, zoneRectOf: () => null, track: id => () => rect(id), remember() {} }, {
    view: () => ({ width: 1000, height: 600, top: 0, bottom: 0 }), sound: (kind, i) => log.push(["sound", kind, i]), quake: p => log.push(["quake", p]) });
  const at = (...e) => log.findIndex(x => e.every((v, i) => x[i] === v));
  assert.deepEqual(log.filter(x => x[0] === "impact"), [["impact", "shard", "car"], ["impact", "explode", "car"]], "打击形状只落在小车身上，然后小车炸开：" + JSON.stringify(log));
  assert.ok(at("num", "6") < at("quake", 1) && at("quake", 1) < at("impact", "explode") && at("impact", "explode") < at("num", "引爆"), "先是打死它的那一下，再炸：" + JSON.stringify(log));
  assert.ok(at("sound", "wave", 0) < at("sound", "blast", 0) && at("sound", "blast", 0) < at("num", "4"), "爆炸声在小车炸开时才响");
  assert.deepEqual(log.filter(x => x[0] === "num").map(x => x[1]), ["6", "引爆", "4", "4", "击破1"]);
});

test("联机玩家的音效（online-sfx.js）：引爆响爆炸声；新画面里引爆和炸到的那几下等小车炸开时才响（blast），不跟着打死它的那一段", () => {
  const heard = [];
  const c = vm.createContext({ Sfx: { enabled: () => true, boom: () => heard.push("boom"), play: (e, o) => heard.push("play:" + e + (o && o.big ? "!" : "")), ui: k => heard.push("ui:" + k), stagger() {}, parry() {} } });
  c.window = c;
  load(c, "online-sfx.js");
  const OS = c.OnlineSfx;
  assert.deepEqual(plain(OS.popCalls({ type: "pop", kind: "carboom", unitId: "car" }, {})), [["boom"]], "引爆：爆炸声");
  const s = OS.start({ tape: BLAST_TAPE, state: BLAST_STATE }, {});
  s.wave(0);
  assert.deepEqual(heard, ["play:ice"], "打死它的那一段只响这一下");
  heard.length = 0;
  s.blast(0);
  assert.deepEqual(heard, ["boom", "play:energy", "play:energy"], "小车炸开：爆炸声 + 炸到的两下");
});

test("联机玩家旧画面（online-ui.js · playPacket / onlineCtx）：引爆在小车身上炸开（震屏 + 爆炸形状），爆炸炸到的人不算这次出手的目标", () => {
  const src = fs.readFileSync(path.join(H.ROOT, "online-ui.js"), "utf8");
  // 不用 assert.match：对不上时它会把整个文件打出来
  assert.ok(/if \(event\.kind === "carboom"\) \{[\s\S]{0,400}?w\.classList\.add\("quake"\)[\s\S]{0,300}?AF\.impact\(rectOf\(card\), \{ kind: "explode"/.test(src), "引爆：震屏 + 爆炸形状");
  assert.ok(/e\.tag !== "boom" && \/\^\(dmg\|break\|status\|fxword\)\$\/\.test\(e\.kind\)/.test(fnSrc(src, "onlineCtx")), "专属演出的目标不含爆炸炸到的人");
});
