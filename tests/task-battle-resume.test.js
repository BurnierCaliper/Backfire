// #340 第 7 条：跑团任务战斗的标记（TRPG.taskBattle）跟着联机房主的房间检查点走。
// 以前房间检查点（online-game.js · save 写进本机的那一份：trpg-ui.js · TrpgFlow.onlineCheckpoint、game.js · onlineCheckpoint）里没有它：
// 房主在任务战斗里刷新、恢复房间以后接着打，打赢了不推进任务（这一站的奖励也不发），护送对象被摧毁也不判任务失败。
// 用真的联机协调层（online-game.js 的 save / resume）和真的 trpg-ui.js（TrpgFlow 的检查点、战斗结算写进探索记录）；
// 战斗画面（game.js）换成只带 state、队伍记忆和 LEDGER 的替身（同 tests/lore.test.js）。真画面里刷新再打完的那一遍在 tests/task-battle-resume-ui.test.js。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const BUILD = "backfire-d3-v1", KEY = "backfire-online-v1";

/** 联机跑团的房间（房主这边）。saved：房主刷新以后用这份房间检查点恢复（online-game.js · doResume） */
async function room(saved = null) {
  const c = H.load(), errors = [];
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "TB-RESUME" });
  let statusListener;
  const status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }, { id: "p2", role: "player", name: "玩家", online: true }] };
  c.console = { error: e => errors.push(String(e)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {}, remove() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.queueMicrotask = queueMicrotask; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  const state = c.S.state;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false, campaign: null, lastEncounter: null,
    setupBattle() {}, refresh() {}, disarm() {}, resumeHotseat() {},
    // 和 game.js 的 onlineCheckpoint / restoreOnline 一样带着整个 state（战场）、队伍记忆和 LEDGER（任务在里面）
    onlineCheckpoint: () => plain({ state, campaign: c.GAME.campaign, ledger: c.LEDGER.save() }),
    restoreOnline(s) { for (const key of Object.keys(state)) delete state[key]; Object.assign(state, plain(s.state)); c.GAME.campaign = s.campaign; if (s.ledger) c.LEDGER.load(s.ledger); },
    resumeOnline: async () => {}, async actSystem() {}, async endTurn() {} };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.Screens = { current: () => "battle", is: s => s === "battle", show() {} };
  c.HotseatUI = { mount() {} };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: BUILD, protocol: 1 }),
    onMessage() {}, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async () => ({ ok: true }),
    async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["trpg-ui.js", "hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-view.js", "online-wire.js", "online-game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  }
  if (saved) { c.localStorage.setItem(KEY, JSON.stringify(saved)); await c.OnlineGame.resume(); }
  else {
    // 主持人开房间：选了已有的团（存档空位 0），真的 TrpgFlow.enter 进去
    c.trpgWriteSlot(0, { name: "护送团", campaign: null, log: [], level: 1, enc: null });
    await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  }
  c.OnlineGame.start();
  const f = { c, state, errors,
    /** 主持人的规则操作（联机时房主本机直接执行，同 HotseatGame.system） */
    rule: o => c.HotseatGame.system(plain(Object.assign({ type: "trpg" }, o))),
    /** 房主本机存的房间检查点（刷新时 pagehide 也写这一份） */
    checkpoint() { c.OnlineGame.touch(); return JSON.parse(c.localStorage.getItem(KEY)); },
    /** 战斗打完：game.js · finish → onBattleFinished → 联机时 HotseatGame.system 一条 trpg.ui recordBattle（trpg-ui.js 写探索记录、推进任务） */
    finish(outcome) {
      c.HotseatGame.system({ type: "trpg.ui", action: "recordBattle", level: 1,
        result: { outcome, turn: 3, xp: 0, kuizhi: 0, xpMult: 1, ups: [], durNotes: [], stats: [], grade: null, drops: null } });
    },
    lastLog: () => (c.TrpgFlow.onlineCheckpoint().log.at(-1) || { lines: [] }).lines.join("\n") };
  return f;
}

/** 主持人建一条护送任务：第 1 站战斗（奖励 300 奎支）、第 2 站事件，发布、接下；在任务页点「开战」（trpgTaskPrepareBattle），
 *  摆战场时护送对象跟着上场（battle-commands.js · trpgSpawnTaskEscort） */
function taskBattle(f) {
  f.rule({ action: "taskCreate", kind: "escort", category: "main" });
  const t = f.c.trpgTasks()[0];
  const edit = plain(t);
  edit.nodes = [
    { type: "battle", title: "伏击", enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], weather: "none", zoneMode: 2, reward: { xp: 0, kuizhi: 300 } },
    { type: "event", title: "检查货物", note: "", reward: { xp: 0, kuizhi: 0 } }
  ];
  f.rule({ action: "taskSave", task: edit });
  f.rule({ action: "taskStatus", id: t.id, status: "posted" });
  f.rule({ action: "taskAccept", id: t.id });
  const cfg = f.c.trpgTaskPrepareBattle(t.id);
  f.c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: cfg.enemies, seed: "TB-RESUME-2", before: () => f.c.trpgSpawnTaskEscort() });
  f.c.OnlineGame.assign(Object.fromEntries(f.state.units.filter(u => u.isPlayer && !u.weaponOf && !u.escort).map(u => [u.id, u.kit === "kolt" ? "p2" : "host"])));
  f.c.startCombat();
  return t.id;
}
const purses = f => f.c.partyHeroes().reduce((sum, h) => sum + f.c.trpgPurse(h.kit), 0);

test("房间检查点带着正在打的任务战斗（哪个任务、第几站）", async () => {
  const f = await room();
  const id = taskBattle(f);
  assert.deepEqual(plain(f.c.S.TRPG.taskBattle), { id, index: 0 });
  const saved = f.checkpoint();
  assert.deepEqual(saved.trpg.taskBattle, { id, index: 0 }, "trpg-ui.js · TrpgFlow.onlineCheckpoint 里有它");
  const g = await room(saved);
  assert.deepEqual(plain(g.c.S.TRPG.taskBattle), { id, index: 0 }, "恢复房间后接着认这一场是任务战斗");
  assert.deepEqual(f.errors.concat(g.errors), []);
});

test("房主在任务战斗里刷新，恢复后打赢了：照样走到下一站、发这一站的奖励、记下护送对象的血量", async () => {
  const f = await room();
  const id = taskBattle(f);
  const e = f.c.fieldEscort();
  e.layers[0].current = e.layers[0].max - 3;   // 打到一半护送对象挨了几下
  const g = await room(f.checkpoint());
  const before = purses(g);
  g.finish("win");
  const t = g.c.trpgTaskById(id);
  assert.equal(t.index, 1, "走到第 2 站：" + g.lastLog());
  assert.equal(t.status, "active");
  assert.match(g.lastLog(), /任务「.+」第 1 站（伏击）完成。下一站：检查货物。/);
  assert.equal(purses(g) - before, 300, "这一站的 300 奎支平分进各人钱包");
  assert.equal(t.escort.cur, e.layers[0].max - 3, "护送对象的血量记回任务");
  assert.equal(g.c.S.TRPG.taskBattle, null, "结算完就不是任务战斗了");
  assert.deepEqual(g.errors, []);
});

test("房主在任务战斗里刷新，恢复后护送对象被摧毁：任务失败", async () => {
  const f = await room();
  const id = taskBattle(f);
  const g = await room(f.checkpoint());
  const e = g.c.fieldEscort();
  assert.ok(e, "护送对象跟着战场一起恢复");
  e.layers[0].current = 0; e.dead = true;
  g.finish("win");
  const t = g.c.trpgTaskById(id);
  assert.equal(t.status, "failed", g.lastLog());
  assert.match(t.failWhy, /被摧毁/);
  assert.equal(t.escort.lost, true);
  assert.match(g.lastLog(), /任务「.+」失败：.+被摧毁。没有报酬。/);
  assert.equal(t.index, 0, "失败了不往下走");
  assert.equal(g.c.S.TRPG.taskBattle, null);
});

test("任务战斗结算完再刷新：检查点里不再有任务战斗，下一场不会被当成任务战斗", async () => {
  const f = await room();
  const id = taskBattle(f);
  f.finish("win");
  assert.equal(f.c.trpgTaskById(id).index, 1);
  const saved = f.checkpoint();
  assert.equal(saved.trpg.taskBattle ?? null, null);
  const g = await room(saved);
  assert.equal(g.c.S.TRPG.taskBattle, null);
  g.finish("win");   // 之后的一场（不是任务战斗）打赢了
  assert.equal(g.c.trpgTaskById(id).index, 1, "任务不会被这一场推进");
});

test("检查点里的任务战斗不像样（版本不同、写坏了）：恢复后当作不是任务战斗，不报错；旧检查点没有这一项也一样", async () => {
  const f = await room();
  const id = taskBattle(f);
  const saved = f.checkpoint();
  for (const bad of [undefined, null, "t1", 7, {}, { id }, { id, index: -1 }, { id, index: 0.5 }, { id: 5, index: 0 }, { id, index: "0" }]) {
    const copy = plain(saved);
    if (bad === undefined) delete copy.trpg.taskBattle; else copy.trpg.taskBattle = bad;
    const g = await room(copy);
    assert.equal(g.c.S.TRPG.taskBattle, null, JSON.stringify(bad));
    g.finish("win");
    assert.equal(g.c.trpgTaskById(id).index, 0, JSON.stringify(bad));
    assert.deepEqual(g.errors, [], JSON.stringify(bad));
  }
});

test("规则层：trpgTaskBattleNormalize 只认 { id: 字符串, index: 非负整数 }，给的是一份拷贝", () => {
  const c = H.load();
  const tb = { id: "t1", index: 2, extra: 1 };
  const got = c.trpgTaskBattleNormalize(tb);
  assert.deepEqual(plain(got), { id: "t1", index: 2 });
  assert.notEqual(got, tb);
  for (const bad of [undefined, null, "t1", {}, { id: "t1" }, { id: "", index: 0 }, { id: "t1", index: -1 }, { id: "t1", index: 1.5 }, { id: 1, index: 0 }]) {
    assert.equal(c.trpgTaskBattleNormalize(bad), null, JSON.stringify(bad));
  }
});
