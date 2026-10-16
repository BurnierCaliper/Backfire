// 单局商店随机进货；维修工具包按点数用、战斗中能用、能修好倒地的武器人
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("商店：最便宜的水和食物一定有，其余商品每家随机 8 种；同一家看几次都一样；没进货的买不到", () => {
  const c = H.load(); const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "SHOP" });
  run.stage = "camp";
  const a = R.shopStock(run).map(r => r.key);
  const always = c.S.ROGUE_SHOP.filter(r => r.always).map(r => r.key);
  assert.equal(always.slice().sort().join(), ["food_liquid", "water_500"].join());
  always.forEach(k => assert.ok(a.includes(k), k));
  assert.equal(a.length, always.length + 8 + require("node:vm").runInContext("ROGUE_SHOP_RULES.effectCount", c), "8 种普通商品 + 另外进的效果道具");
  assert.equal(a.filter(k => c.S.ROGUE_SHOP.find(r => r.key === k).effect).length, require("node:vm").runInContext("ROGUE_SHOP_RULES.effectCount", c));
  assert.equal(R.shopStock(run).map(r => r.key).join(), a.join(), "同一家店看几次都一样");
  const missing = c.S.ROGUE_SHOP.find(r => !a.includes(r.key));
  if (missing) assert.throws(() => R.buy(run, missing.key, 1), /这家店没有/);
  // 换一家（下一次回城）重新进货：多换几次总会不一样
  const seen = new Set([a.join()]);
  for (let i = 0; i < 6; i++) { run.taskNo += 1; seen.add(R.shopStock(run).map(r => r.key).join()); }
  assert.ok(seen.size > 1, "换一家店进货会变");
  // 高级的水和食物进了随机清单：有的店有、有的店没有
  const has = { food_gourmet: 0, water_5000: 0 };
  for (let i = 0; i < 30; i++) { run.taskNo += 1; const keys = R.shopStock(run).map(r => r.key); Object.keys(has).forEach(k => { if (keys.includes(k)) has[k] += 1; }); }
  Object.keys(has).forEach(k => assert.ok(has[k] > 0 && has[k] < 30, `${k}：${has[k]}/30`));
});

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }], seed: "REPAIR" });
  c.S.state.bag = { items: [] };
  return c;
}

test("维修工具包按点数用：修几点用几点，剩下的留在开封的那包里", () => {
  const c = field();
  c.bagAdd("repair_kit", 2);
  assert.equal(c.repairPoints(), 20);
  c.LEDGER.dur.torque = c.weaponDurMax("torque") - 3;
  c.ledgerRepair("torque", []);
  assert.equal(c.weaponDur("torque"), c.weaponDurMax("torque"));
  assert.equal(c.repairPoints(), 17);
  assert.equal(c.bagCount("repair_kit"), 1);
  assert.equal(c.bagCount("repair_kit_open"), 7);
  c.spendRepairPoints(9);   // 先用开封的 7 点，再开一包用 2 点
  assert.equal(c.bagCount("repair_kit"), 0);
  assert.equal(c.bagCount("repair_kit_open"), 8);
  // 点数不够就修到用完为止
  c.LEDGER.dur.torque = 0;
  c.spendRepairPoints(6);
  c.ledgerRepair("torque", []);
  assert.equal(c.weaponDur("torque"), 2);
  assert.equal(c.repairPoints(), 0);
});

test("战斗中用「使用道具」修武器耐久（dest = 武器）", () => {
  const c = field();
  c.bagAdd("repair_kit", 1);
  c.startCombat();
  const k = c.findKit("kolt", c.S.state.units);
  c.LEDGER.dur.torque = 1;
  c.Commands.dispatch({ type: "useItem", actor: k.id, item: "repair_kit", target: null, dest: "torque" });
  assert.equal(c.weaponDur("torque"), Math.min(c.weaponDurMax("torque"), 11));
  assert.equal(c.repairPoints(), 10 - (c.weaponDur("torque") - 1));
});

test("修好倒地的武器人：重新站起来，恢复最大生命 25%，用掉同样多的点数", () => {
  const c = field();
  c.bagAdd("repair_kit", 1);
  c.startCombat();
  const k = c.findKit("kolt", c.S.state.units);
  const w = c.spawnWeapon(k, "torque");
  assert.ok(w);
  w.layers.forEach(l => { l.current = 0; });
  w.dead = true;
  const max = w.layers.reduce((s, l) => s + l.max, 0);
  const cost = Math.max(1, Math.ceil(max * 0.25));
  const row = c.repairTargets().find(r => r.kit === "torque");
  assert.ok(row.down);
  assert.equal(row.need, cost);
  c.Commands.dispatch({ type: "useItem", actor: k.id, item: "repair_kit", target: null, dest: "torque" });
  assert.equal(w.dead, false);
  assert.equal(w.layers.reduce((s, l) => s + l.current, 0), Math.min(cost, 10));
  assert.equal(c.repairPoints(), 10 - Math.min(cost, 10));
});

test("撤退丢下全部战斗道具时，维修工具包不丢（和以前一样）", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(H.ROOT, "app.js"), "utf8");
  assert.match(src, /ITEM_CATALOG\[x\.id\]\.combat && ITEM_CATALOG\[x\.id\]\.target !== "weapon"/);
});
