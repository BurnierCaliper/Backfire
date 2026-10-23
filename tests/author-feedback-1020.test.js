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
