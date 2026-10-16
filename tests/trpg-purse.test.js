// 跑团私人钱包：任务奖金平分进各人钱包（个人任务只进本人的）、队员之间转钱、花钱时选由谁付、跟着存档走
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "PURSE" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 0;
  c.S.state.bag = { items: [] };
  c.LEDGER.purse = {};
  return c;
}
const send = (c, cmd) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, cmd)));

test("平分：零头从前面的人起每人多 1；没有活着的人时进公账", () => {
  const c = field();
  c.trpgPurseSplit(1001, null, "测试");
  assert.equal(c.trpgPurse("kolt"), 501);
  assert.equal(c.trpgPurse("helu"), 500);
  c.trpgPurseSplit(300, ["helu"], "个人");
  assert.equal(c.trpgPurse("helu"), 800);
});

test("转账：角色之间、角色和公账之间；钱不够、同一个钱包、不认识的钱包都不转", () => {
  const c = field();
  c.LEDGER.purse = { kolt: 1000 };
  c.S.state.kuizhi = 200;
  assert.match(send(c, { action: "purseTransfer", from: "kolt", to: "helu", amount: 300 })[0], /转给/);
  assert.equal(c.trpgPurse("kolt"), 700);
  assert.equal(c.trpgPurse("helu"), 300);
  send(c, { action: "purseTransfer", from: "party", to: "kolt", amount: 200 });
  assert.equal(c.S.state.kuizhi, 0);
  assert.equal(c.trpgPurse("kolt"), 900);
  assert.match(send(c, { action: "purseTransfer", from: "helu", to: "kolt", amount: 999 })[0], /不够/);
  assert.match(send(c, { action: "purseTransfer", from: "helu", to: "helu", amount: 1 })[0], /不能转给自己/);
  assert.match(send(c, { action: "purseTransfer", from: "nobody", to: "helu", amount: 1 })[0], /没有这个钱包/);
  assert.equal(c.trpgPurse("helu"), 300, "失败的转账不动钱");
});

test("公账平分给大家", () => {
  const c = field();
  c.S.state.kuizhi = 400;
  send(c, { action: "purseSplit" });
  assert.equal(c.S.state.kuizhi, 0);
  assert.deepEqual([c.trpgPurse("kolt"), c.trpgPurse("helu")], [200, 200]);
});

test("由谁付：选了角色就从他的钱包扣，公账不动；钱不够照常拦下", () => {
  const c = field();
  c.LEDGER.purse = { kolt: 3000 };
  c.S.state.kuizhi = 50;
  const out = send(c, { action: "buy", key: "medkit", qty: 1, free: false, payer: "kolt" });
  assert.ok(c.bagCount("medkit") >= 1, out.join(" "));
  assert.ok(c.trpgPurse("kolt") < 3000);
  assert.equal(c.S.state.kuizhi, 50, "公账没动");
  assert.match(out.join(" "), /由 .+ 付/);
  const before = c.bagCount("medkit");
  const poor = send(c, { action: "buy", key: "medkit", qty: 1, free: false, payer: "helu" });
  assert.equal(c.bagCount("medkit"), before, poor.join(" "));
  // 不写 payer：照旧扣公账
  c.S.state.kuizhi = 5000;
  send(c, { action: "buy", key: "medkit", qty: 1, free: false });
  assert.ok(c.S.state.kuizhi < 5000);
});

test("钱包跟着存档走", () => {
  const c = field();
  c.LEDGER.purse = { kolt: 123, helu: 0 };
  const saved = plain(c.LEDGER.save());
  assert.deepEqual(saved.purse, { kolt: 123, helu: 0 });
  c.LEDGER.load({});
  assert.equal(c.trpgPurse("kolt"), 0);
  c.LEDGER.load(saved);
  assert.equal(c.trpgPurse("kolt"), 123);
  assert.ok(!("helu" in c.LEDGER.purse), "0 不存");
});

test("给玩家的钱包数据照白名单过：自己的有余额，队友只有名字", () => {
  const OV = require("../online-view.js");
  const out = OV.projectPurse({ party: 50, heroes: [{ kit: "kolt", name: "柯尔特", amount: 300, mine: true, secret: 1 }, { kit: "helu", name: "Helumica" }] });
  assert.deepEqual(plain(out), { party: 50, heroes: [{ kit: "kolt", name: "柯尔特", mine: true, amount: 300 }, { kit: "helu", name: "Helumica", mine: false }] });
});
