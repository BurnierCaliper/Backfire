// 商店卖东西（shop-sell.js）：卖价规则、不能卖的、单机 / 联机单局 / 跑团的钱去哪、回购
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const ROOT = path.resolve(__dirname, "..");
const J = v => JSON.parse(JSON.stringify(v));
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");

function solo() {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["kolt", "helu", "ruby"], seed: "SELL" });
  run.stage = "camp";
  c.S.state.kuizhi = 1000; c.S.state.bag = { items: [] };
  return { c, R, run };
}
const q = (c, run, cmd) => c.Commands.dispatch(Object.assign({ type: "run.query" }, cmd), { run });
const a = (c, run, cmd) => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run });

/* ---------- 纯规则 ---------- */
test("卖价 = 标准价 × 50% 向下取整；不看店里的折扣价", () => {
  const { c } = solo();
  assert.equal(c.shopSellPrice("medkit"), 300);       // 手册价 600
  assert.equal(c.shopSellPrice("fx_burn"), 600);      // 效果道具 1200
  assert.equal(c.shopSellPrice("cm_gas"), 300);       // 参考价 600（不是黑市倍价）
  assert.equal(c.shopSellPrice("mat_alloy"), 2500);
  c.ITEM_CATALOG.__odd = { name: "奇数", price: 333 };
  assert.equal(c.shopSellPrice("__odd"), 166);
  assert.equal(c.shopSellPrice("heart_fusion"), null);
  assert.equal(c.shopSellPrice("nope"), null);
});
test("shopSellCheck：任务道具 / 图纸 / 已装备 / 无标准价；改装件不归这里", () => {
  const { c } = solo();
  c.ITEM_CATALOG.__quest = { name: "钥匙", key: true, price: 100 };
  assert.deepEqual(J(c.shopSellCheck("__quest")), { ok: false, reason: "任务道具" });
  assert.deepEqual(J(c.shopSellCheck("bp_trevor_bigkill")), { ok: false, reason: "图纸" });
  assert.deepEqual(J(c.shopSellCheck("medkit", { equipped: true })), { ok: false, reason: "已装备" });
  assert.deepEqual(J(c.shopSellCheck("heart_fusion")), { ok: false, reason: "无标准价" });
  assert.deepEqual(J(c.shopSellCheck("part_c_str_con")), { ok: false, reason: "改装件" });
  assert.deepEqual(J(c.shopSellCheck("medkit")), { ok: true, reason: "" });
});

test("地图与票券不能卖：map_* / ticket_* / 手册「地图与票券」整组", () => {
  const { c, R, run } = solo();
  const group = vm.runInContext(`HANDBOOK_SHOP.filter(r => r.group === "地图与票券").map(r => r.give.item)`, c);
  assert.ok(group.includes("map_desert") && group.includes("ticket_dome"));
  for (const id of group) assert.deepEqual(J(c.shopSellCheck(id)), { ok: false, reason: "地图与票券" }, id);
  c.ITEM_CATALOG.map_new = { name: "新地图", price: 1000 };       // 新加的 map_ 也一并拦下
  c.ITEM_CATALOG.ticket_x = { name: "新票", price: 1000 };
  assert.equal(c.shopSellCheck("map_new").reason, "地图与票券");
  assert.equal(c.shopSellCheck("ticket_x").reason, "地图与票券");
  assert.equal(c.shopSellCheck("rope").ok, true);                  // 同表其他组照常
  c.bagAdd("ticket_dome", 1); c.bagAdd("map_desert", 1);
  const v = J(R.shopSellView(run));
  assert.equal(v.items.find(x => x.id === "ticket_dome").reason, "地图与票券");
  assert.throws(() => R.sellItem(run, { id: "map_desert" }), /地图与票券/);
  assert.equal(c.bagCount("map_desert"), 1);
});
test("跑团也拦地图与票券", () => {
  const { c, m } = trpg();
  c.bagAdd("ticket_dome", 1); c.trpgMerchantOpen(m.id);
  assert.throws(() => c.trpgShopSell("kolt", "ticket_dome", 1), /地图与票券/);
  assert.equal(c.S.state.kuizhi, 0);
});

/* ---------- 单机单局 ---------- */
test("单机：run.query shopSell 列出背包（改装件不列），卖的钱进 state.kuizhi", () => {
  const { c, run } = solo();
  c.bagAdd("medkit", 3); c.bagAdd("bp_trevor_bigkill", 1); c.bagAdd("part_c_str_con", 1); c.bagAdd("food_can", 1);
  const v = J(q(c, run, { action: "shopSell" }));
  assert.deepEqual(v.items.map(x => x.id).sort(), ["bp_trevor_bigkill", "food_can", "medkit"]);
  const med = v.items.find(x => x.id === "medkit");
  assert.deepEqual(med, { id: "medkit", name: "简易医疗包", qty: 3, unitPrice: 300, owner: "shared", ok: true, reason: "" });
  assert.equal(v.items.find(x => x.id === "bp_trevor_bigkill").reason, "图纸");
  assert.doesNotMatch(JSON.stringify(v), /shp/);
  const out = J(a(c, run, { action: "sellItem", id: "medkit", qty: 2 }));
  assert.deepEqual(out.payout, [{ to: "party", amount: 600 }]);
  assert.equal(out.ok, true); assert.equal(out.total, 600);
  assert.equal(c.S.state.kuizhi, 1600); assert.equal(c.bagCount("medkit"), 1);
  assert.throws(() => a(c, run, { action: "sellItem", id: "bp_trevor_bigkill" }), /图纸/);
  assert.throws(() => a(c, run, { action: "sellItem", id: "medkit", qty: 5 }), /只有 1 件/);
});
test("单机回购：同价买回、离店清空、不在商店不能卖", () => {
  const { c, R, run } = solo();
  c.bagAdd("fx_burn", 1);
  R.sellItem(run, { id: "fx_burn" });
  const bb = J(R.shopSellView(run)).buyback;
  assert.equal(bb.length, 1); assert.equal(bb[0].price, 600); assert.equal(bb[0].owner, "shared");
  c.S.state.kuizhi = 500;
  assert.throws(() => R.buybackItem(run, { token: bb[0].token }), /奎支不够/);
  c.S.state.kuizhi = 700;
  R.buybackItem(run, { token: bb[0].token });
  assert.equal(c.S.state.kuizhi, 100); assert.equal(c.bagCount("fx_burn"), 1);
  assert.equal(J(R.shopSellView(run)).buyback.length, 0);
  R.sellItem(run, { id: "fx_burn" });
  run.taskNo = (run.taskNo || 0) + 1;     // 换了地方 = 离店
  assert.equal(J(R.shopSellView(run)).buyback.length, 0);
  run.stage = "board";
  assert.equal(R.shopSellView(run), null);
  assert.throws(() => R.sellItem(run, { id: "fx_burn" }), /没有商店/);
});

/* ---------- 联机单局 ---------- */
function online() {
  const { c, R, run } = solo();
  c.RunFlow = { current: () => run, actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }) };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(read("online-rogue.js"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });
  const d = O.data(run); d.purse = { kolt: 100, helu: 1000, ruby: 7 };
  c.S.state.kuizhi = 0;
  return { c, R, run, O, d };
}
const act = (O, who, command) => O.handle(who, { type: "rogue.act", command });

test("联机：个人物品的钱进卖的人的钱包，名下数量减少", () => {
  const { c, O, d } = online();
  c.bagAdd("fx_burn", 2); d.owned = { helu: { fx_burn: 2 } };
  assert.deepEqual({ ...act(O, "p2", { action: "sellItem", kit: "helu", id: "fx_burn", qty: 1, owner: "helu" }) }, { ok: true });
  assert.equal(d.purse.helu, 1600); assert.equal(d.purse.kolt, 100); assert.equal(d.purse.ruby, 7);
  assert.equal(d.owned.helu.fx_burn, 1); assert.equal(c.bagCount("fx_burn"), 1);
  assert.equal(c.S.state.kuizhi, 0);
});
test("联机：公用物品的钱平分给活着的角色，零头给卖的人", () => {
  const { c, O, d } = online();
  c.ITEM_CATALOG.__odd = { name: "奇数", price: 202 };   // 卖 101 → 每人 33，零头 2 给卖的人
  c.bagAdd("__odd", 1);
  act(O, "p2", { action: "sellItem", kit: "ruby", id: "__odd", owner: "shared" });
  assert.deepEqual({ ...d.purse }, { kolt: 133, helu: 1033, ruby: 42 });
});
test("联机：不能卖别人的、不能拿别人的角色卖；回购回到原归属、由卖的人付", () => {
  const { c, O, d, R, run } = online();
  c.bagAdd("fx_burn", 1); d.owned = { kolt: { fx_burn: 1 } };
  assert.throws(() => act(O, "p2", { action: "sellItem", kit: "helu", id: "fx_burn", owner: "kolt" }), /自己名下|公用/);
  assert.throws(() => act(O, "p2", { action: "sellItem", kit: "kolt", id: "fx_burn", owner: "kolt" }), /自己的角色/);
  assert.throws(() => act(O, "p2", { action: "sellItem", kit: "helu", id: "fx_burn", owner: "shared" }), /只有 0 件/);
  O.handle("host", { type: "rogue.act", command: { action: "sellItem", kit: "kolt", id: "fx_burn", owner: "kolt" } });
  assert.equal(d.purse.kolt, 700);
  const pkt2 = O.viewFor("p2").shopSell, pktH = O.viewFor("host").shopSell;
  assert.equal(pkt2.buyback.length, 0);           // 不是 p2 的角色卖的
  assert.equal(pktH.buyback.length, 1);
  const token = pktH.buyback[0].token;
  assert.throws(() => act(O, "p2", { action: "buybackItem", kit: "helu", token }), /卖掉它的人/);
  O.handle("host", { type: "rogue.act", command: { action: "buybackItem", kit: "kolt", token } });
  assert.equal(d.purse.kolt, 100); assert.equal(d.owned.kolt.fx_burn, 1); assert.equal(c.bagCount("fx_burn"), 1);
});
test("联机：packet.rogue.shopSell 只给自己角色名下的 + 公用的；投影后没有坚毅", () => {
  const { c, O, d } = online();
  c.bagAdd("fx_burn", 2); c.bagAdd("food_can", 1); d.owned = { kolt: { fx_burn: 1 }, helu: { fx_burn: 1 } };
  const v = J(O.viewFor("p2").shopSell);
  assert.deepEqual(v.items.map(x => x.owner + ":" + x.id).sort(), ["helu:fx_burn", "shared:food_can"]);
  const pkt = V.projectPacket({ type: "result", rogue: J(O.viewFor("p2")) }, { recipientId: "p2", gmId: "host" });
  assert.ok(pkt.rogue.shopSell.items.length === 2);
  assert.doesNotMatch(JSON.stringify(pkt.rogue.shopSell), /shp/);
});

/* ---------- 跑团 ---------- */
function trpg() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "SELLT" });
  c.S.TRPG.active = true; c.S.state.kuizhi = 0; c.S.state.bag = { items: [] };
  c.LEDGER.purse = { kolt: 5000, helu: 10 }; c.LEDGER.merchants = []; c.LEDGER.shopOpen = null;
  const send = cmd => c.Commands.dispatch(J(Object.assign({ type: "trpg" }, cmd)));
  send({ action: "merchantCreate", name: "老周" });
  const m = c.trpgMerchants()[0];
  send({ action: "merchantSave", merchant: { id: m.id, name: "老周", discount: 50, rows: [{ key: "medkit" }] } });
  return { c, send, m };
}
test("跑团：没开店不能卖；卖的钱进队伍公账（不看折扣），钱包不动", () => {
  const { c, send, m } = trpg();
  c.bagAdd("medkit", 2);
  assert.throws(() => c.trpgShopSell("kolt", "medkit", 1), /没有开着的商店/);
  c.trpgMerchantOpen(m.id);
  const out = J(send({ action: "shopSell", kit: "kolt", id: "medkit", qty: 2 }));
  assert.deepEqual(out.payout, [{ to: "party", amount: 600 }]);
  assert.equal(c.S.state.kuizhi, 600); assert.equal(c.trpgPurse("kolt"), 5000); assert.equal(c.bagCount("medkit"), 0);
  assert.throws(() => c.trpgShopSell("kolt", "bp_trevor_bigkill", 1), /图纸/);
});
test("跑团回购：卖的人从自己钱包付、东西回公用背包；关店清空", () => {
  const { c, m } = trpg();
  c.bagAdd("medkit", 1); c.trpgMerchantOpen(m.id);
  c.trpgShopSell("helu", "medkit", 1);
  const v = J(c.trpgShopSellView(["helu"]));
  assert.equal(v.buyback.length, 1);
  assert.equal(J(c.trpgShopSellView(["kolt"])).buyback.length, 0);
  assert.throws(() => c.trpgShopBuyback("kolt", v.buyback[0].token), /卖掉它的人/);
  assert.throws(() => c.trpgShopBuyback("helu", v.buyback[0].token), /钱不够/);
  c.LEDGER.purse.helu = 400;
  c.trpgShopBuyback("helu", v.buyback[0].token);
  assert.equal(c.trpgPurse("helu"), 100); assert.equal(c.bagCount("medkit"), 1); assert.equal(c.S.state.kuizhi, 300);
  c.trpgShopSell("helu", "medkit", 1);
  c.trpgMerchantOpen(null);
  c.trpgMerchantOpen(m.id);
  assert.equal(J(c.trpgShopSellView()).buyback.length, 0);
});
test("跑团联机接线：shopSell / shopBuyback 消息、packet.shopSell 投影白名单", () => {
  const og = read("online-game.js"), hg = read("hotseat-game.js");
  assert.match(og, /"shopSell", "shopBuyback"\]\);/);
  assert.match(og, /shopSell: [^\n]*trpgShopSellFor\(id, id === identity\.id\)/);
  assert.match(hg, /"cyberwareRemove", "shopSell", "shopBuyback"\]\);/);
  assert.match(hg, /shopSell: c => \{[\s\S]*?session\.ownerOf\(own\.id\) !== sender\) fail/);
  const { c, m } = trpg();
  c.bagAdd("food_can", 1); c.trpgMerchantOpen(m.id);
  const pkt = V.projectPacket({ type: "result", shopSell: J(c.trpgShopSellView()) }, { recipientId: "p1", gmId: "host" });
  assert.deepEqual(pkt.shopSell.items, [{ id: "food_can", name: c.ITEM_CATALOG.food_can.name, qty: 1, unitPrice: 250, owner: "shared", ok: true, reason: "" }]);
  assert.doesNotMatch(JSON.stringify(pkt), /shp/);
});

test("结果编号 seq：每个结果递增、两笔一模一样的也不同；离店后接着编号；视图 last 带 seq", () => {
  const { c, R, run } = solo();
  c.bagAdd("medkit", 3);
  const a1 = R.sellItem(run, { id: "medkit" }), a2 = R.sellItem(run, { id: "medkit" });
  assert.equal(a1.total, a2.total); assert.equal(a2.seq, a1.seq + 1);
  const v = J(R.shopSellView(run));
  assert.equal(v.last.seq, a2.seq); assert.equal(v.last.kind, "sell");
  const b = R.buybackItem(run, { token: v.buyback[0].token });
  assert.equal(b.seq, a2.seq + 1); assert.equal(J(R.shopSellView(run)).last.kind, "buyback");
  run.taskNo = (run.taskNo || 0) + 1;      // 换地方：回购单清空，编号不归零
  assert.equal(J(R.shopSellView(run)).last, null);
  assert.ok(R.sellItem(run, { id: "medkit" }).seq > b.seq);
});
test("seq：联机 last 只给卖的人那边；跑团同样递增、关店后接着编号、投影保留", () => {
  const { c, O, d } = online();
  c.bagAdd("fx_burn", 2);
  O.handle("host", { type: "rogue.act", command: { action: "sellItem", kit: "kolt", id: "fx_burn", owner: "shared" } });
  assert.equal(O.viewFor("p2").shopSell.last, null);
  assert.equal(O.viewFor("host").shopSell.last.seq, 1);
  const t = trpg();
  t.c.bagAdd("medkit", 2); t.c.trpgMerchantOpen(t.m.id);
  const s1 = t.c.trpgShopSell("kolt", "medkit", 1), s2 = t.c.trpgShopSell("kolt", "medkit", 1);
  assert.equal(s2.seq, s1.seq + 1);
  const pkt = V.projectPacket({ type: "result", shopSell: J(t.c.trpgShopSellView(["kolt"])) }, { recipientId: "p1", gmId: "host" });
  assert.equal(pkt.shopSell.last.seq, s2.seq);
  assert.equal(J(t.c.trpgShopSellView(["helu"])).last, null);
  t.c.trpgMerchantOpen(null); t.c.bagAdd("medkit", 1); t.c.trpgMerchantOpen(t.m.id);
  assert.ok(t.c.trpgShopSell("kolt", "medkit", 1).seq > s2.seq);
});
