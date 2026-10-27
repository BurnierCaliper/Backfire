"use strict";
// 联机包体预算的无界面夹具（issue #340 第 8、9 条）：真的 online-view.js 投影 + online-wire.js 差量，
// 房主 + 4 名玩家，按收件人统计每次行动发出的字节数（中继分片之前的逻辑包）。
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));
const LIMIT = 51200;
// 不看键的顺序，找第一处不同（返回路径；一样返回空）
function firstDiff(a, b, at = "") {
  if (a === b) return "";
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return at || "/";
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], at + "/" + k); if (d) return d; }
  return "";
}
async function fixture({ party = ["ruby", "kolt", "helu", "nora"], enemies, seed = "BUDGET-340", board, chat = 0, prepare } = {}) {
  const c = H.load(), sends = [], errors = [], clients = new Map(), projected = new Map();
  c.BattleSim.setup({ party, enemies, seed, board });
  if (prepare) prepare(c, c.S.state);
  const players = ["p2", "p3", "p4", "p5"];
  let message, statusListener;
  const status = { connected: true, hostOnline: true, paused: true, roster: [{ id: "host", role: "host", name: "主持人", online: true }, ...players.map((id, i) => ({ id, role: "player", name: "玩家" + (i + 1), online: true }))] };
  c.console = { error: e => errors.push(String(e && e.stack || e)), log() {}, warn() {} };
  c.location = { search: "", reload() {} }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; }, body: { classList: { add() {} } } };
  c.addEventListener = () => {}; c.setInterval = () => 0; c.queueMicrotask = queueMicrotask; c.setTimeout = setTimeout; c.clearTimeout = clearTimeout;
  const state = c.S.state;
  const settle = (cmd, value, meta) => {
    // 和 game.js 一样：结算完先由 onActionSettled 发一次（带演出带子）
    const tape = [{ type: "log", text: "结算" }, { type: "pop", kind: "dmg", unitId: state.units[0].id, value: 1, snap: plain(state.units.slice(0, 2)) }];
    c.OnlineGame.onActionSettled(cmd, value, tape, meta || {});
  };
  // （新）act() 的 finally：演出播完（这里等一拍）以后 checkEnd() 派发 battle.checkSolo
  const afterAct = async () => { await new Promise(r => setTimeout(r, 0)); c.Commands.dispatch({ type: "battle.checkSolo" }); };
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], onlineEditWindow: false,
    refresh() {}, disarm() {}, resumeHotseat() {}, onlineCheckpoint: () => plain({ state }),
    restoreOnline() {}, resumeOnline: async () => {},
    // 和 game.js 的 act() / perform() 一样：结算时 GAME.tape 是数组（期间的 broadcast 不单独发包），结算完 onActionSettled 发一包，
    // 之后 act() 的 finally 还会 checkEnd() → battle.checkSolo（经 HotseatGame.system 再 broadcast 一次）
    async actSystem(cmd, meta, context) { c.GAME.tape = []; let v; try { v = c.HotseatGame.system(cmd, context); } finally { c.GAME.tape = null; } settle(cmd, v, meta); await afterAct(); return v; },
    async act(cmd, meta) { c.GAME.tape = []; let v; try { v = c.Commands.dispatch(cmd); } finally { c.GAME.tape = null; } settle(cmd, v, meta); await afterAct(); return v; },
    async endTurn() { return c.HotseatGame.submit({ type: "endTurn" }); }
  };
  c.Screens = { current: () => "battle", is: s => s === "battle" };
  c.Commands.register("screen", () => ({}), { domain: "fixture" });
  c.TrpgFlow = { enter() {}, onlineCheckpoint: () => ({}), restoreOnline() {} };
  c.trpgReadSlots = () => [{ name: "已有团" }, null, null];
  c.HotseatUI = { mount() {} };
  c.OnlineActions = { create: () => ({ menu() { return {}; } }) };
  const ep = { identity: { id: "host", name: "主持人", role: "host", roomCode: "AAAAAA" },
    credentials: () => ({ roomCode: "AAAAAA", role: "host", token: "test", build: "backfire-d3-v1", protocol: 1 }),
    onMessage(fn) { message = fn; }, onStatus(fn) { statusListener = fn; fn(plain(status)); },
    send: async (packet, recipient) => {
      sends.push({ recipient, bytes: Buffer.byteLength(JSON.stringify(packet)), packet });
      // 玩家端还原：每名收件人一个 OnlineWire，解出来必须和投影后的整包一模一样（差量不能丢东西）
      if (["result", "resync"].includes(packet.type)) {
        if (!clients.has(recipient)) clients.set(recipient, c.OnlineWire.create());
        const got = clients.get(recipient).unpack(packet), want = projected.get(recipient);
        const diff = firstDiff(plain(got), want);
        if (diff) errors.push("wire round-trip mismatch for " + recipient + " at " + diff);
      }
      return { ok: true };
    },
    async setReady() { status.paused = false; statusListener(plain(status)); }, close() {}, reconnect() {} };
  c.RelayTransport = { createHost: async () => ep, resumeHost: async () => ep };
  for (const file of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js", "online-view.js", "online-wire.js", "online-game.js"])
    vm.runInContext(fs.readFileSync(path.join(H.ROOT, file), "utf8"), c, { filename: file });
  const project = c.OnlineView.projectPacket;
  c.OnlineView.projectPacket = (packet, ctx) => { const out = project(packet, ctx); projected.set(ctx.recipientId, plain(out)); return out; };
  await c.OnlineGame.create({ slot: 0, name: "主持人", url: "https://fixture.invalid" });
  c.OnlineGame.start();
  const heroes = state.units.filter(u => u.isPlayer && !u.weaponOf);
  c.OnlineGame.assign(Object.fromEntries(heroes.map((u, i) => [u.id, players[i % players.length]])));
  c.HotseatGame.startCombat(); c.HotseatGame.beginRound();
  // 小队聊天先灌满（hotseat.js CHAT_KEEP = 300）：走存档恢复，免得每条都发一轮包
  if (chat) {
    const cp = c.HotseatGame.checkpoint();
    cp.session.chat = Array.from({ length: chat }, (_, i) => ({ id: "chat-" + (i + 1), operatorId: players[i % players.length], operatorName: "玩家" + (i % players.length + 1), text: ("小队聊天第" + i + "条，二十个字左右的普通消息").slice(0, 20), at: 100000 + i }));
    c.HotseatGame.restoreOnline(cp);
  }
  await c.OnlineGame.submit({ type: "orderStart" });
  await new Promise(r => setTimeout(r, 0));
  let requestId = 0;
  const cmd = (sender, command) => message({ type: "cmd", protocol: 1, build: "backfire-d3-v1", requestId: ++requestId, command }, sender);
  /** 测一次：fn 期间每名玩家收到的结算包（result）个数、其中带演出带子的个数（withTape）、字节数 */
  async function measure(fn) {
    const from = sends.length; await fn(); await new Promise(r => setTimeout(r, 0));
    const rows = sends.slice(from).filter(s => s.packet.type === "result");
    return Object.fromEntries(players.map(p => { const mine = rows.filter(r => r.recipient === p); return [p, { packets: mine.length, withTape: mine.filter(r => Array.isArray(r.packet.tape) && r.packet.tape.length).length, total: mine.reduce((n, r) => n + r.bytes, 0), max: Math.max(0, ...mine.map(r => r.bytes)) }]; }));
  }
  return { c, state, sends, errors, players, heroes, cmd, measure, LIMIT };
}
module.exports = { fixture, LIMIT, plain };
