// 联机玩法「争斗」第 2 步：接上联机（#543 / issue #560，docs/pvp.md 第 8 节）——房间（online-brawl.js）、白名单（online-view.js · projectBrawl）、
// 选养成的菜单（brawl.js · brawlChoices）、两队同一个角色时会话按单位记归属（hotseat.js / hotseat-game.js）、行动顺序照会话（每一轮开始一起排，没动过的可以换位置）。
// 真的规则（tests/headless.js），房间跑在房主那一端；房主的画面和整场对 AI 在 tests/brawl-online-ui.test.js（浏览器）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const plain = v => JSON.parse(JSON.stringify(v));
const load = (c, files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(H.ROOT, f), "utf8"), c, { filename: f }));
// 坚毅生命的字段 / 字样（upOnShp 是公开的「起身中」，不算）
const LEAK = /"shp|shpMax|shpBase|shpBonus|坚毅/;
const ok = (r, msg) => assert.equal(r.ok, true, (msg || "") + "：" + r.error);
const no = (r, re, msg) => { assert.equal(r.ok, false, msg); if (re) assert.match(r.error, re, msg); };

/** 争斗房间（房主 host，玩家甲 p1、乙 p2）：房主那一端的 OnlineBrawl，开打时照 battle.brawl 布置（game.js · setupBrawl 的规则部分） */
function room(opt = {}) {
  const c = H.load();
  const players = opt.players || [{ id: "host", name: "房主", gm: true, online: true }, { id: "p1", name: "甲", online: true }, { id: "p2", name: "乙", online: true }];
  c.OnlineGame = { isHost: () => true, isPaused: () => false, players: () => players };
  c.GAME = { setupBrawl: spec => c.Commands.dispatch(spec) };
  load(c, ["online-brawl.js"]);
  c.OnlineBrawl.enable(true, "host");
  const send = (who, cmd) => { try { return plain(c.OnlineBrawl.handle(who, plain(cmd))); } catch (e) { return { ok: false, error: e.message }; } };
  const view = who => plain(c.OnlineBrawl.viewFor(who));
  // 发给玩家的那一份（online-view.js 白名单）
  const pview = who => plain(V.projectPacket({ type: "result", protocol: 1, mode: "brawl", brawl: c.OnlineBrawl.viewFor(who) }, { recipientId: who, gmId: "host" }));
  const legal = (kit, tier) => { const e = plain(c.brawlSimEntry(kit, tier)); return { attrs: e.attrs, feats: e.feats, featFull: [], cyberPlan: e.cyberPlan }; };
  return { c, send, view, pview, legal, players };
}

test("开房选「争斗」：房主定等级段、每队人数、允不允许起身、回合上限、哪一队交给 AI，房间里的人看得到（白名单照样带着）；玩家不能改，不合法的写原因", () => {
  const { c, send, view, pview } = room();
  const v0 = view("p1");
  assert.deepEqual([v0.no, v0.phase, v0.tier, v0.size, v0.stand, v0.rounds, v0.ai], [1, "setup", 0, 1, true, null, null], "开房的默认设定（BRAWL_ROOM_CFG.defaults）");
  assert.deepEqual(Object.keys(v0.teams), ["1队", "2队"]);
  assert.equal(v0.teams["1队"].length, 1);
  no(send("p1", { type: "brawl.set", tier: 1 }), /只有房主/, "玩家不能改设定");
  no(send("host", { type: "brawl.set", size: 5 }), /每队人数要 1–4/);
  no(send("host", { type: "brawl.set", size: 0 }), /每队人数要 1–4/);
  no(send("host", { type: "brawl.set", tier: 2 }), /等级段只有/);
  no(send("host", { type: "brawl.set", rounds: 0 }), /回合上限要在 1 到 99 之间/);
  no(send("host", { type: "brawl.set", stand: "no" }), /允许起身只能是开或关/);
  no(send("host", { type: "brawl.set", ai: "3队" }), /没有这一队/);
  ok(send("host", { type: "brawl.set", tier: 1, size: 3, stand: false, rounds: 10 }));
  for (const who of ["p1", "p2"]) {
    const b = pview(who).brawl;
    assert.equal(pview(who).mode, "brawl", "玩法照样发");
    assert.deepEqual([b.phase, b.tier, b.size, b.stand, b.rounds, b.ai, b.host], ["setup", 1, 3, false, 10, null, false], who + " 看得到设定");
    assert.deepEqual(b.teams["1队"].map(r => r.kit), [null, null, null], "每队 3 个空位");
    assert.equal(b.start.ok, false);
    assert.ok(b.start.why.some(w => /1 队第 1 个位置还空着/.test(w)), "写清楚为什么还不能开打");
  }
  assert.equal(pview("host").brawl.host, true, "房主那一份标着是房主");
  ok(send("host", { type: "brawl.set", rounds: null }), "关掉回合上限");
  assert.equal(view("p1").rounds, null);
  // 一整队交给 AI：那一队随机补上角色（同一队里不重复），只能整队，真人选不进去；AI 的养成不发给任何人
  ok(send("host", { type: "brawl.set", ai: "2队" }));
  const t2 = pview("p1").brawl.teams["2队"];
  assert.equal(t2.length, 3);
  assert.ok(t2.every(r => r.ai === true && r.kit && r.owner === "brawl-ai" && r.done === true), "2 队三个位置都是 AI");
  assert.equal(new Set(t2.map(r => r.kit)).size, 3, "同一队里不重复");
  assert.ok(t2.every(r => !("build" in r)), "AI 的养成不发");
  no(send("p1", { type: "brawl.seat", team: "2队", index: 0, kit: "xia" }), /交给了 AI/, "真人不能选进 AI 队");
  no(send("p1", { type: "brawl.ai", index: 0, kit: "xia" }), /只有房主/);
  const keep = t2[1].kit;
  const pick = c.brawlHeroKits().find(k => !t2.some(r => r.kit === k));
  ok(send("host", { type: "brawl.ai", index: 0, kit: pick }), "房主给 AI 那一队换角色");
  no(send("host", { type: "brawl.ai", index: 2, kit: keep }), /2 队里已经有.+了（同一队里角色不能重复/);
  assert.equal(view("p1").teams["2队"][0].kit, pick);
  // 换回两队都是真人：AI 那一队空出来
  ok(send("host", { type: "brawl.set", ai: null }));
  assert.deepEqual(view("p1").teams["2队"].map(r => r.kit), [null, null, null]);
  assert.doesNotMatch(JSON.stringify(pview("p1")), LEAK);
});

test("两个真人各选一队、选角色和养成：同一队里不能重复、两队之间可以（两队都是夕夏）；一个人只在一队；没选完 / 不合法按「准备好」被拦下并写原因；都准备好才能开打", () => {
  const { c, send, view, pview, legal } = room();
  ok(send("host", { type: "brawl.set", tier: 1, size: 2 }));
  ok(send("p1", { type: "brawl.seat", team: "1队", index: 0, kit: "xia" }));
  ok(send("p2", { type: "brawl.seat", team: "2队", index: 0, kit: "xia" }), "两队之间可以重复");
  no(send("p1", { type: "brawl.seat", team: "1队", index: 1, kit: "xia" }), /1 队里已经有夕夏了（同一队里角色不能重复，两队之间可以）/);
  no(send("p1", { type: "brawl.seat", team: "2队", index: 1, kit: "ruby" }), /你已经在1 队了：一个人只能选一队/);
  no(send("p2", { type: "brawl.seat", team: "1队", index: 0, kit: "ruby" }), /这个位置已经有人了（甲）/);
  no(send("p1", { type: "brawl.seat", team: "1队", index: 1, kit: "nobody" }), /没有这名角色/);
  ok(send("p1", { type: "brawl.seat", team: "1队", index: 1, kit: "ruby" }), "一个人可以操作几个角色");
  ok(send("p2", { type: "brawl.seat", team: "2队", index: 1, kit: "kolt" }));
  // 养成：没选完不能准备好
  no(send("p1", { type: "brawl.ready", on: true }), /1 队第 1 个角色（夕夏）：还没选完/);
  no(send("p2", { type: "brawl.build", team: "1队", index: 0, build: legal("xia", 1) }), /只能给自己的角色选养成/, "不能替别人选");
  ok(send("p1", { type: "brawl.build", team: "1队", index: 0, build: legal("xia", 1) }));
  ok(send("p1", { type: "brawl.build", team: "1队", index: 1, build: legal("ruby", 1) }));
  ok(send("p1", { type: "brawl.ready", on: true }));
  // 乙选了 11 级才能选的专长（Lv10 段只有 7 级那一项）：拦下并写原因，不悄悄换掉
  const bad = Object.assign(legal("xia", 1), { feats: ["charge"] });
  ok(send("p2", { type: "brawl.build", team: "2队", index: 0, build: bad }), "草稿照存");
  ok(send("p2", { type: "brawl.build", team: "2队", index: 1, build: legal("kolt", 1) }));
  no(send("p2", { type: "brawl.ready", on: true }), /2 队第 1 个角色（夕夏）：.*7 级不能选「冲阵」：要 11 级才能选/);
  assert.equal(view("p2").start.ok, false);
  assert.ok(view("p2").start.why.some(w => /乙 还没按「准备好」/.test(w)));
  ok(send("p2", { type: "brawl.build", team: "2队", index: 0, build: legal("xia", 1) }));
  ok(send("p2", { type: "brawl.ready", on: true }));
  // 开打之前互相看不到养成：甲的那一份只有自己的位置带草稿，乙的位置只说「选好没有」
  const a = pview("p1").brawl, b = pview("p2").brawl;
  assert.ok(a.teams["1队"].every(r => r.mine && r.build && r.build.feats.length === 1), "甲看得到自己的草稿");
  assert.ok(a.teams["2队"].every(r => !r.mine && !("build" in r) && r.done === true), "甲看不到乙的养成，只知道选好了");
  assert.ok(b.teams["1队"].every(r => !r.mine && !("build" in r)), "乙看不到甲的养成");
  assert.deepEqual(a.ready.slice().sort(), ["p1", "p2"]);
  assert.equal(a.start.ok, true, "都准备好了");
  // 拿错了别人的视图（mine 标着、主人不是收件人）也漏不出养成
  const wrong = plain(V.projectPacket({ type: "result", mode: "brawl", brawl: c.OnlineBrawl.viewFor("p1") }, { recipientId: "p2", gmId: "host" })).brawl;
  assert.ok(wrong.teams["1队"].every(r => r.mine === false && !("build" in r)));
  // 改了自己的养成：准备好作废，要重新按
  ok(send("p1", { type: "brawl.build", team: "1队", index: 1, build: legal("ruby", 1) }));
  assert.deepEqual(view("host").ready, ["p2"]);
  ok(send("p1", { type: "brawl.ready", on: true }));
  // 房主改了设定：大家重新按
  ok(send("host", { type: "brawl.set", stand: false }));
  assert.deepEqual(view("host").ready, []);
  ok(send("p1", { type: "brawl.ready", on: true })); ok(send("p2", { type: "brawl.ready", on: true }));
  // 开打：照 battle.brawl 布置（规则层再校验一遍），按位置把角色分给操控它的人
  const assign = plain(c.OnlineBrawl.start());
  const S = c.S.state;
  assert.equal(c.brawlOn(), true);
  const team = t => S.pvpDuel.teams[t].map(id => S.units.find(u => u.id === id));
  assert.deepEqual(plain(team("1队").map(u => [u.kit, assign[u.id]])), [["xia", "p1"], ["ruby", "p1"]]);
  assert.deepEqual(plain(team("2队").map(u => [u.kit, assign[u.id]])), [["xia", "p2"], ["kolt", "p2"]], "两队都有夕夏，各归各的");
  assert.equal(S.pvpDuel.stand, false, "设定照房间的");
  const v = pview("p1").brawl;
  assert.equal(v.phase, "battle");
  assert.ok(["1队", "2队"].includes(v.toss.first), "翻硬币的结果发给大家（画面放动画）");
  assert.ok(v.teams["1队"].every(r => !("build" in r)), "打的时候不再发草稿");
  no(send("p1", { type: "brawl.seat", team: "1队", index: 0, kit: null }), /正在打/, "打的时候不能改位置");
  // 打完 → 再来一局：设定、位置、养成都留着，准备好要重新按
  c.OnlineBrawl.finished({ duel: { result: { over: true, winner: "1队", draw: false, why: "wipe" } } });
  assert.equal(view("p1").phase, "ended");
  assert.deepEqual(view("p1").result, { winner: "1队", draw: false, why: "wipe" });
  no(send("p1", { type: "brawl.ready", on: true }), /打完/);
  c.GAME.ended = true;
  no((() => { try { return c.OnlineBrawl.again("p1"); } catch (e) { return { ok: false, error: e.message }; } })(), /只有房主/);
  ok(plain(c.OnlineBrawl.again("host")));
  const next = view("p1");
  assert.deepEqual([next.no, next.phase, next.stand, next.size], [2, "setup", false, 2], "第 2 局，设定照旧");
  assert.deepEqual(next.teams["1队"].map(r => [r.kit, r.owner, r.done]), [["xia", "p1", true], ["ruby", "p1", true]], "位置、养成沿用上一局");
  assert.deepEqual(next.ready, [], "准备好要重新按");
  assert.equal(next.toss, null);
  assert.doesNotMatch(JSON.stringify(pview("p1")) + JSON.stringify(pview("p2")), LEAK);
});

test("离开房间的人让出位置；房主刷新页面（checkpoint / restore）后房间、位置、草稿、开打时收起来的队伍档案都还在", () => {
  const f = room();
  const { c, send, view, legal, players } = f;
  ok(send("host", { type: "brawl.set", tier: 1 }));
  ok(send("p1", { type: "brawl.seat", team: "1队", index: 0, kit: "nora" }));
  ok(send("p2", { type: "brawl.seat", team: "2队", index: 0, kit: "tou" }));
  ok(send("p1", { type: "brawl.build", team: "1队", index: 0, build: legal("nora", 1) }));
  ok(send("p1", { type: "brawl.ready", on: true }));
  players.splice(2, 1);   // 乙离开房间（座位被释放）
  c.OnlineBrawl.changed();
  assert.equal(view("p1").teams["2队"][0].kit, null, "乙的位置空出来");
  ok(send("host", { type: "brawl.set", ai: "2队" }), "2 队交给 AI，一个人也能打");
  ok(send("p1", { type: "brawl.ready", on: true }));
  c.OnlineBrawl.start();
  const ledgerBefore = c.brawlStashed();
  assert.equal(ledgerBefore, true, "开打时规则层收起了队伍档案");
  const saved = plain(c.OnlineBrawl.checkpoint());
  assert.equal(saved.room.phase, "battle");
  assert.ok(saved.stash, "收起来的那一份跟着房主的联机存档走");
  // 刷新：新的一套环境照存档恢复
  const g = room({ players: players.slice() });
  g.c.OnlineBrawl.restore(saved);
  assert.equal(g.view("p1").phase, "battle");
  assert.equal(g.c.brawlStashed(), true, "恢复以后打完照样放回去");
  assert.equal(g.c.OnlineBrawl.inBattle(), true);
});

test("打完、队伍档案换回去以后（联机房主的结算画面、回到房间时场上还是争斗的角色）：画面读这些角色的武器耐久不往换回去的档案里写", () => {
  const c = H.load();
  const e = kit => plain(c.brawlSimEntry(kit, 1));
  c.LEDGER.dur.mint = 3;   // 玩家自己的档案：瑞比的明特耐久 3
  const before = JSON.stringify(c.LEDGER.save());
  c.brawlSetup({ tier: 1, size: 1, teams: { "1队": [e("ruby")], "2队": [e("ruby")] }, seed: "BRAWL560-DUR" });
  const S = c.S.state, units = S.units.filter(u => u.isPlayer && !u.weaponOf);
  units.forEach(u => (u.linkedKits || []).forEach(k => c.weaponDur(k, u)));   // 打的时候读：记在争斗那一份里
  assert.equal(c.pvpDuelRestore([]), true);
  assert.equal(JSON.stringify(c.LEDGER.save()), before, "打完换回争斗前的档案");
  units.forEach(u => (u.linkedKits || []).forEach(k => assert.ok(c.weaponDur(k, u) > 0, "照样读得到耐久")));
  assert.equal(JSON.stringify(c.LEDGER.save()), before, "读完档案没变（以前会写进「mint@1队」这些键）");
});

test("选养成的菜单（brawl.js · brawlChoices）：照等级段一步一步列——Lv20 三点属性（8 级那点不能重复）、四项专长（每级只列够得着的）、改造的上限照选完属性算；前面改了后面不合法的写原因", () => {
  const c = H.load();
  const ch = plain(c.brawlChoices("xia", 0, {}));
  assert.deepEqual(ch.attrs.map(a => [a.level, a.noRepeat, a.pick]), [[4, false, null], [8, true, null], [19, false, null]]);
  assert.deepEqual(ch.feats.map(f => f.level), [7, 11, 13, 16]);
  const tier = id => c.featDef(id).tier, FL = plain(vm.runInContext("FEAT_TIER_LEVEL", c));
  ch.feats.forEach(f => assert.ok(f.options.every(id => FL[tier(id)] <= f.level), f.level + " 级只列够得着的"));
  assert.ok(ch.feats[0].options.every(id => !c.featDef(id).explore), "探索专长不提供");
  assert.match(ch.error, /还没选完：还差 7 项/);
  assert.ok(ch.cyber.limit > 0 && ch.cyber.fleshMax > ch.cyber.limit);
  assert.doesNotMatch(JSON.stringify(ch), LEAK, "菜单里没有坚毅");
  // 选 4 级加力量：8 级那一点就不能再加力量
  const two = plain(c.brawlChoices("xia", 0, { attrs: ["str", "str"] }));
  assert.equal(two.attrs[1].options.includes("str"), false);
  assert.match(two.attrs[1].bad, /不能加在之前加过的同一项上（力量）/);
  // 智力加点让改造率变高：可换的肉体上限跟着变（照选完属性以后算）
  const base = plain(c.brawlChoices("yuito", 0, {})), smart = plain(c.brawlChoices("yuito", 0, { attrs: ["int", "con", "int"] }));
  assert.ok(smart.cyber.rate > base.cyber.rate, "智力高了改造率高");
  // 7 级、11 级都选同一项不能重复的专长：11 级那一项写原因
  const dup = plain(c.brawlChoices("xia", 0, { feats: ["tough", "tough"] }));
  assert.equal(dup.feats[0].bad, null);
  assert.match(dup.feats[1].bad, /已经有了，不能重复/);
  // 照 brawlSimEntry 选完：合法
  const e = plain(c.brawlSimEntry("xia", 0));
  const done = plain(c.brawlChoices("xia", 0, { attrs: e.attrs, feats: e.feats, cyberPlan: e.cyberPlan }));
  assert.equal(done.error, null);
  assert.ok(done.cyber.layers.some(l => l.type === "armor"), "改造后的血量层");
  // 改造超出上限：写原因
  const over = plain(c.brawlChoices("xia", 0, { attrs: e.attrs, feats: e.feats, cyberPlan: { armor: 999 } }));
  assert.match(over.cyber.bad, /最多只能改造 \d+ 点肉体/);
  assert.match(over.error, /改造方案不合法/);
});

/** 会话（hotseat.js）+ 房主的桥（hotseat-game.js）：争斗布好以后按单位分给操作者（两队都有夕夏：1 队归甲、2 队归 AI） */
function bridge() {
  const c = H.load();
  c.location = { search: "" }; c.URLSearchParams = URLSearchParams;
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  c.setInterval = () => 1;
  c.GAME = { depth: 0, sim: false, tape: null, ended: false, undo: [], disarm() {}, refresh() {}, resumeHotseat() {} };
  c.OnlineGame = { isHost: () => true, isPaused: () => false };
  load(c, ["hotseat.js", "hotseat-authority.js", "hotseat-validation.js", "gm-commands.js", "hotseat-game.js"]);
  const toss = c.pvpDuelToss;
  c.pvpDuelToss = () => { const keep = c.Math.random; c.Math.random = () => 0.1; try { return toss(); } finally { c.Math.random = keep; } };   // 1 队先手
  const e = kit => plain(c.brawlSimEntry(kit, 1));
  c.Commands.dispatch({ type: "battle.brawl", tier: 1, size: 2, seed: "BRAWL560-ORDER", teams: { "1队": [e("xia"), e("ruby")], "2队": [e("xia"), e("kolt")] }, ai: { "2队": true } });
  const S = c.S.state, team = t => S.pvpDuel.teams[t].map(id => S.units.find(u => u.id === id));
  const [ax, ar] = team("1队"), [bx, bk] = team("2队");
  const players = [{ id: "host", name: "房主", gm: true }, { id: "p1", name: "甲" }, { id: "brawl-ai", name: "AI", ai: true }];
  const assignments = { [ax.id]: "p1", [ar.id]: "p1", [bx.id]: "brawl-ai", [bk.id]: "brawl-ai" };
  const ack = c.HotseatGame.enableOnline({ mode: "trpg", players, assignments });
  assert.equal(ack.ok, true, ack.error);
  const send = (who, cmd) => c.HotseatGame.receiveFrom(who, plain(cmd));
  return { c, S, ax, ar, bx, bk, send, view: who => plain(c.HotseatGame.getViewFor(who)) };
}

test("两队同一个角色：会话按单位记归属（1 队的夕夏归甲、2 队的夕夏归 AI），AI 操作者不占房间人数；发给玩家的会话视图没有坚毅", () => {
  const { c, ax, bx, bk, view } = bridge();
  const heroes = view("host").heroes;
  assert.equal(heroes.find(h => h.id === ax.id).owner, "p1");
  assert.equal(heroes.find(h => h.id === bx.id).owner, "brawl-ai", "同一个 kit 的两个人各归各的（以前按 kit 记，后一个会盖掉前一个）");
  assert.equal(heroes.find(h => h.id === bk.id).owner, "brawl-ai");
  const pv = plain(V.projectView(c.HotseatGame.getViewFor("p1"), { recipientId: "p1" }));
  assert.ok(pv.players.some(p => p.id === "brawl-ai" && p.name === "AI"));
  assert.doesNotMatch(JSON.stringify(pv), LEAK);
});

test("行动顺序照会话：这一轮开始两队一起排（甲排自己的，AI 排自己的），没动过的单位随时可以换位置，动过的格子固定；后手那一队照排好的顺序在敌人回合轮到", () => {
  const { c, S, ax, ar, bx, bk, send, view } = bridge();
  assert.equal(c.HotseatGame.startCombat().ok !== false, true);
  c.HotseatGame.beginRound();
  let v = view("p1");
  assert.equal(v.phase, "picking");
  assert.equal(v.order.length, 4, "两队四个人一起排");
  assert.equal(send("p1", { type: "orderPick", actor: ax.id, index: 0 }).ok, true);
  assert.equal(send("p1", { type: "orderPick", actor: ar.id, index: 1 }).ok, true);
  assert.equal(send("p1", { type: "orderPick", actor: bx.id, index: 2 }).ok, false, "不能替 AI 排");
  assert.equal(send("brawl-ai", { type: "orderPick", actor: bx.id, index: 2 }).ok, true);
  assert.equal(send("brawl-ai", { type: "orderPick", actor: bk.id, index: 3 }).ok, true);
  assert.equal(send("p1", { type: "orderConfirm" }).ok, true);
  assert.equal(send("brawl-ai", { type: "orderConfirm" }).ok, true);
  v = view("p1");
  assert.equal(v.phase, "acting");
  assert.equal(v.currentUnitId, ax.id, "1 队先手：甲的夕夏先动");
  // 没动过的单位随时可以换位置：甲把瑞比换到夕夏前面（两个都是自己的、都没动过）
  assert.equal(send("p1", { type: "orderMove", actor: ar.id, index: 0 }).ok, true);
  v = view("p1");
  assert.deepEqual(v.order.slice(0, 2).map(r => r.actor), [ar.id, ax.id]);
  assert.equal(v.currentUnitId, ar.id);
  // 瑞比动了（花了附赠）：她的格子固定，不能再挪
  assert.equal(send("p1", { type: "move", actor: ar.id, dest: 2 }).ok, true);
  assert.equal(view("p1").order.find(r => r.actor === ar.id).locked, true);
  assert.equal(send("p1", { type: "orderMove", actor: ar.id, index: 1 }).ok, false, "动过的格子固定");
  assert.match(send("p1", { type: "orderMove", actor: ar.id, index: 1 }).error, /固定/);
  // 后手那一队（AI）在我方回合轮不到
  assert.equal(send("brawl-ai", { type: "move", actor: bx.id, dest: 2 }).ok, false);
  assert.equal(S.units.find(u => u.id === bx.id).zone, 3, "2 队还在 3 区");
});
