// 第三轮单机低级 L-10、L-12、L-14 ~ L-16（工坊 / 长休）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "WORKSHOP-150" });
  c.S.state.bag = { items: [] };
  c.setLedgerWater(10000);
  return c;
}
const hero = (c, kit) => c.partyHeroes().find(h => h.kit === kit);

test("L-10：对死亡角色用医疗包，提示已死亡，不扣道具", () => {
  const c = field();
  c.bagAdd("medkit", 2);
  hero(c, "helu").dead = true;
  const out = c.ledgerHealItem("medkit", "helu", []);
  assert.match(out.join(" "), /已死亡/);
  assert.equal(c.bagCount("medkit"), 2);
  // 活人照常扣
  const k = hero(c, "kolt");
  k.layers[k.layers.length - 1].current = 1;
  c.ledgerHealItem("medkit", "kolt", []);
  assert.equal(c.bagCount("medkit"), 1);
});

test("L-12：角色守夜时日志不再说「除守夜者外」（他的武器照样回满）", () => {
  const c = field();
  const out = c.ledgerLongRest({ hours: 8, watch: "kolt", force: true }, []).notes.join(" ");
  assert.doesNotMatch(out, /除守夜者外/);
  assert.match(out, /全部武器耐久回满/);
});

test("L-14：医疗包 hint 不再说只治内层", () => {
  const c = field();
  ["medkit", "clinic"].forEach(id => {
    assert.doesNotMatch(c.ITEM_CATALOG[id].hint, /内层生命/);
    assert.match(c.ITEM_CATALOG[id].hint, /外层/);
  });
});

test("L-15：起身中不能用强心注射剂，不扣坚毅也不扣道具，提示不带数值", () => {
  const c = field();
  const k = c.S.state.units.find(u => u.kit === "kolt");
  c.bagAdd("stim", 1);
  k.upOnShp = true;
  const shp = k.shp;
  const out = c.useItemOn(k, "stim", k, null);
  assert.match(out.join(" "), /起身中/);
  assert.doesNotMatch(out.join(" "), /\d/);
  assert.equal(out.unused, true);
  assert.equal(k.shp, shp);
  assert.equal(c.bagCount("stim"), 1);
});

test("L-16：不花钱的操作选了由谁付，不写「由 X 付」；花钱的照写", () => {
  const c = field();
  c.S.TRPG.active = true;
  c.LEDGER.purse = { kolt: 100 };
  const free = c.trpgPayWith("kolt", () => ["没动钱"]);
  assert.doesNotMatch(free.join(" "), /由 .+ 付/);
  const paid = c.trpgPayWith("kolt", () => { c.S.state.kuizhi -= 10; return ["花了"]; });
  assert.match(paid.join(" "), /由 .+ 付，钱包剩 90/);
});
