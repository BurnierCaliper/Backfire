"use strict";
// 联机赌场测试的夹具（#526）：联机跑团房间（真的 HotseatGame 联机指令 + online-view.js 白名单），
// 主持人 host（操控柯尔特）、玩家甲 p2（瑞比）、玩家乙 p3（赫鲁米卡），在探索环节；另有「把牌局打完」的小工具。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const plain = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
const RULES = ["counter-cards.js", "counter-cards-ai.js", "flux-duel.js", "flux-duel-ai.js", "flux-holdem.js", "flux-holdem-ai.js", "counter-cards-guess.js", "casino.js"];

function room(seed) {
  const c = H.load();
  for (const f of RULES) vm.runInContext(read(f), c, { filename: f });
  c.BattleSim.setup({ party: ["ruby", "helu", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: seed || "CASINO-FLUX" });
  let saves = 0;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, level: 1, undo: [], disarm() {}, refresh() {}, resumeHotseat() {}, rememberCampaign() { saves++; } };
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams; c.addEventListener = () => {}; c.setInterval = () => 0;
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  for (const f of ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]) vm.runInContext(read(f), c, { filename: f });
  const hero = k => c.S.state.units.find(u => u.kit === k);
  const players = [{ id: "host", name: "主持人", gm: true }, { id: "p2", name: "甲" }, { id: "p3", name: "乙" }];
  assert.equal(c.HotseatGame.enableOnline({ mode: "trpg", players, assignments: { [hero("ruby").id]: "p2", [hero("helu").id]: "p3" } }).ok, true);
  c.S.TRPG.active = true;
  c.LEDGER.purse = { ruby: 30000, helu: 30000 };
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(Object.assign({ type: "casino" }, cmd)));
  // raw：房主这边造好、还没过白名单的（主持人本机看的就是这一份）；view：过了白名单、真的发出去的
  const raw = who => plain(c.HotseatGame.getViewFor(who));
  const view = who => V.projectView(raw(who), { recipientId: who });
  const casino = who => view(who).casino;
  const mine = (who, kit) => casino(who).mine.find(r => r.kit === kit);
  return { c, hero, send, raw, view, casino, mine, saves: () => saves, book: () => c.LEDGER.casino };
}
const ok = (ack, msg) => assert.equal(ack.ok, true, (msg || "") + "：" + ack.error);
const no = (ack, re, msg) => { assert.equal(ack.ok, false, msg); if (re) assert.match(ack.error, re, msg); };
const has = (o, s) => JSON.stringify(o).includes(s);

/** 规则给的操作里挑一个能把牌局往下打的：出牌（第一种）→ 偷看后留在顶上 → 不追加 → 过牌 → 跟注 → 不借 → 弃牌 */
function pick(g) {
  const L = g.legal || [], f = t => L.find(o => o.type === t);
  const play = f("play");
  if (play) return play.card ? { type: "play", card: play.card } : { type: "play", layer: play.layer, element: play.element };
  if (f("place")) return { type: "place", where: "top" };
  for (const t of ["pass", "check", "call", "noLoan", "fold"]) if (f(t)) return { type: t };
  throw new Error("没有能做的操作：" + JSON.stringify(L));
}
/** 几个人轮着打到这一局结束：actors = [{ who, game: () => 这个人收到的包里的这一局, cmd: { 指令里除了 action 的那几项 } }]。
 *  steps：只走这么多步就停（打到一半，测试存档读回来用）。返回走了几步 */
function playOut(send, actors, steps) {
  for (let i = 0; i < (steps || 3000); i++) {
    const gs = actors.map(a => ({ a, g: a.game() }));
    if (gs.every(x => !x.g || x.g.over)) return i;
    const turn = gs.find(x => x.g && !x.g.over && x.g.myTurn);
    assert.ok(turn, "没人能动，牌局卡住了：" + JSON.stringify(gs.map(x => x.g && { stage: x.g.stage, waiting: x.g.waiting })));
    ok(send(turn.a.who, Object.assign({ op: "act" }, turn.a.cmd, { action: pick(turn.g) })), "第 " + i + " 步");
  }
  if (steps) return steps;
  throw new Error("3000 步还没打完");
}

module.exports = { room, ok, no, has, pick, playOut, plain, read, V, RULES };
