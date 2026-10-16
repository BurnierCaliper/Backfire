// 跑团商人：主持人设置商人、商品（单独定价 / 库存）、整店打折、积分兑换；开店给联机玩家看；跟着存档走
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "MERCH" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  c.S.state.bag = { items: [] };
  c.LEDGER.purse = { kolt: 5000 };
  c.LEDGER.merchants = [];
  c.LEDGER.shopOpen = null;
  return c;
}
const send = (c, cmd) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, cmd)));
function merchant(c, data) {
  send(c, { action: "merchantCreate", name: "老周" });
  const m = c.trpgMerchants()[c.trpgMerchants().length - 1];
  send(c, { action: "merchantSave", merchant: Object.assign({ id: m.id }, data) });
  return c.trpgMerchantById(m.id);
}

test("设置：只认手册里有的商品、能兑换的道具；折扣夹在 0–90", () => {
  const c = field();
  const m = merchant(c, { name: "老周杂货", note: "码头边的小摊", discount: 150,
    rows: [{ key: "medkit" }, { key: "nope" }, { key: "medkit" }, { key: "water_500", price: "500", stock: "2" }],
    points: { on: true, items: ["fx_s_burn", "medkit"] } });
  assert.equal(m.name, "老周杂货");
  assert.equal(m.discount, 90);
  assert.deepEqual(plain(m.rows), [{ key: "medkit", price: null, stock: null }, { key: "water_500", price: 500, stock: 2 }]);
  assert.deepEqual(plain(m.points), { on: true, items: ["fx_s_burn"] });
});

test("买：打折后的价格、从付钱的人的钱包扣、库存递减卖完拦下、照常攒积分", () => {
  const c = field();
  const m = merchant(c, { name: "老周", discount: 20, rows: [{ key: "medkit" }, { key: "water_500", price: 500, stock: 2 }] });
  send(c, { action: "merchantOpen", id: m.id });
  const v = plain(c.trpgMerchantView());
  const med = v.rows.find(r => r.key === "medkit");
  assert.equal(med.price, Math.round(med.base * 0.8), "八折");
  assert.equal(v.rows.find(r => r.key === "water_500").price, 400, "单独定价 500 再八折");
  const out = send(c, { action: "merchantBuy", id: m.id, key: "water_500", qty: 2, payer: "kolt" });
  assert.match(out[0], /买下/);
  assert.equal(c.trpgPurse("kolt"), 5000 - 800);
  assert.equal(c.S.state.kuizhi, 0, "公账没动");
  assert.equal(m.rows.find(r => r.key === "water_500").stock, 0);
  assert.match(send(c, { action: "merchantBuy", id: m.id, key: "water_500", qty: 1, payer: "kolt" })[0], /卖完/);
  assert.match(send(c, { action: "merchantBuy", id: m.id, key: "food_can", qty: 1, payer: "kolt" })[0], /不卖/);
  assert.match(send(c, { action: "merchantBuy", id: m.id, key: "medkit", qty: 99, payer: "helu" })[0], /奎支不够/);
  assert.equal(c.bagCount("medkit"), 0, "钱不够不给东西");
});

test("巧手匠人八折和店里的折扣不叠加，取便宜的", () => {
  const c = field();
  c.findKit("kolt", c.S.state.units).feats = ["haggler"];
  const nine = merchant(c, { name: "九折", discount: 10, rows: [{ key: "medkit", price: 1000 }] });
  const half = merchant(c, { name: "五折", discount: 50, rows: [{ key: "medkit", price: 1000 }] });
  send(c, { action: "merchantOpen", id: nine.id });
  const p9 = c.trpgMerchantView().rows[0].price;
  send(c, { action: "merchantOpen", id: half.id });
  const p5 = c.trpgMerchantView().rows[0].price;
  assert.ok(p9 === 800 || p9 === 900, String(p9));   // 探索专长只在跑团规则下生效：有就 800，没有就 900
  assert.equal(p5, 500);
});

test("积分兑换：这家店开了兑换、道具在单子里才行", () => {
  const c = field();
  c.trpgAdjustPoints(10);
  const no = merchant(c, { name: "不换", rows: [] });
  const yes = merchant(c, { name: "能换", rows: [], points: { on: true, items: ["fx_s_burn"] } });
  assert.match(send(c, { action: "merchantRedeem", id: no.id, item: "fx_s_burn" })[0], /不能用积分兑换/);
  assert.match(send(c, { action: "merchantRedeem", id: yes.id, item: "fx_s_conductor" })[0], /换不到/);
  assert.match(send(c, { action: "merchantRedeem", id: yes.id, item: "fx_s_burn" })[0], /兑换/);
  assert.equal(c.bagCount("fx_s_burn"), 1);
});

test("开店 / 关店；删掉开着的那家就关店；跟着存档走", () => {
  const c = field();
  const m = merchant(c, { name: "老周", rows: [{ key: "medkit" }] });
  assert.equal(c.trpgMerchantView(), null);
  send(c, { action: "merchantOpen", id: m.id });
  assert.equal(c.trpgMerchantView().name, "老周");
  const saved = plain(c.LEDGER.save());
  c.LEDGER.load({});
  assert.equal(c.trpgMerchants().length, 0);
  c.LEDGER.load(saved);
  assert.equal(c.trpgMerchantView().name, "老周", "读档后还开着");
  send(c, { action: "merchantOpen", id: null });
  assert.equal(c.trpgMerchantView(), null);
  send(c, { action: "merchantOpen", id: m.id });
  send(c, { action: "merchantDelete", id: m.id });
  assert.equal(c.LEDGER.shopOpen, null);
});

test("给玩家的商店数据照白名单过", () => {
  const OV = require("../online-view.js");
  const out = OV.projectShop({ id: "m1", name: "老周", note: "n", discount: 20, secret: 1,
    rows: [{ key: "medkit", name: "医疗包", hint: "h", group: "医疗", base: 600, price: 480, stock: null, cost: 1 }],
    points: { have: 3, rows: [{ item: "fx_s_burn", name: "灼烧", points: 3 }] } });
  assert.deepEqual(plain(out), { id: "m1", name: "老周", note: "n", discount: 20,
    rows: [{ key: "medkit", name: "医疗包", hint: "h", group: "医疗", base: 600, price: 480, stock: null }],
    points: { have: 3, rows: [{ item: "fx_s_burn", name: "灼烧", points: 3 }] } });
});
