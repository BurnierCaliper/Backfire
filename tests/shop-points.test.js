// 商店积分（docs/workshop-design.md 第 6 节）：每花 3000 奎支得 1 积分，零头累计；只能兑换自我效果道具
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");

function shopRun() {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "PTS" });
  run.stage = "camp";
  return { c, R, run };
}

test("每花 3000 奎支得 1 积分，零头累计到下次", () => {
  const { c, R, run } = shopRun();
  assert.equal(vm.runInContext("ROGUE_SHOP_POINTS.per", c), 3000);
  c.S.state.kuizhi = 100000;
  const row = R.shopStock(run).find(r => r.price === 1000) || R.shopStock(run).find(r => r.price >= 600);
  for (let i = 0; i < 2; i++) R.buy(run, row.key, 1);
  const p1 = R.shopPoints(run);
  assert.equal(p1.points, Math.floor(row.price * 2 / 3000));
  assert.equal(p1.carry, (row.price * 2) % 3000);
  const left = 3000 - p1.carry;
  assert.equal(p1.next, left);
  // 再买到凑满
  let spent = row.price * 2;
  while (spent < 6000) { R.buy(run, row.key, 1); spent += row.price; }
  assert.equal(R.shopPoints(run).points, Math.floor(spent / 3000));
});

test("积分兑换：只能换自我效果道具；3 / 4 积分；不够不能换；没有商店不能换", () => {
  const { c, R, run } = shopRun();
  const list = R.redeemList();
  assert.equal(list.length, 7);
  assert.ok(list.every(x => /^fx_s_/.test(x.id) && (x.points === 3 || x.points === 4)));
  assert.throws(() => R.redeem(run, "fx_s_burn"), /积分不够/);
  run.shopPoints = { team: { points: 7, carry: 0 } };
  R.redeem(run, "fx_s_burn");
  assert.equal(c.bagCount("fx_s_burn"), 1);
  assert.equal(R.shopPoints(run).points, 4);
  R.redeem(run, "fx_s_store");
  assert.equal(R.shopPoints(run).points, 0);
  assert.throws(() => R.redeem(run, "fx_burn"), /不能用积分兑换/);
  run.stage = "task";
  run.shopPoints.team.points = 9;
  if (!R.canShop(run)) assert.throws(() => R.redeem(run, "fx_s_frost"), /没有商店/);
});
