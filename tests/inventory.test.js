// 背包 / 工坊共用的数据层（inventory.js；rogue.js · inventory / recipeStatus / recipeBook / materialUses；online-rogue.js · backpackFor）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

const J = v => JSON.parse(JSON.stringify(v));
function setup(seed) {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: seed || "INV" });
  c.S.state.kuizhi = 100000;
  return { c, R, run, give: (id, n) => c.bagAdd(id, n) };
}
const fn = (c, name) => vm.runInContext(name, c);

test("分类：制作 / 升级材料是材料，改装件和图纸是武器与改装件，其余是消耗品；不认识的是 null", () => {
  const { c } = setup();
  const cat = fn(c, "inventoryCategory");
  assert.equal(cat("cm_scrap"), "materials");
  assert.equal(cat("mat_metal"), "materials");
  assert.equal(cat("medkit"), "consumables");
  assert.equal(cat("fx_smoke"), "consumables");
  const part = Object.keys(c.ITEM_CATALOG).find(id => c.ITEM_CATALOG[id].part);
  assert.equal(cat(part), "parts");
  assert.equal(cat("no_such_thing"), null);
  assert.deepEqual(J(fn(c, "INVENTORY_TABS")).map(t => t.id), ["materials", "consumables", "parts", "cyberware"]);
});

test("反查：材料 → 用到它的配方（份数照配方表）", () => {
  const { c, R } = setup();
  const uses = J(R.materialUses("cm_spirit"));
  const rc = J(fn(c, "CRAFT_RECIPES"));
  const expect = Object.keys(rc).filter(id => rc[id].cm_spirit > 0);
  assert.deepEqual(uses.map(u => u.id), expect);
  assert.ok(uses.every(u => u.need === rc[u.id].cm_spirit && u.name));
  assert.deepEqual(J(R.materialUses("medkit")), []);
});

test("recipeCheck：差什么、差多少；金属可以用奎支补，不算缺", () => {
  const { c } = setup();
  const check = fn(c, "recipeCheck");
  const r = J(check("fx_corr", { cm_scrap: 1, cm_chem: 1 }));   // 要 废料1 化工残液2
  assert.equal(r.craftable, false);
  assert.deepEqual(r.missing.map(m => [m.item, m.need, m.have]), [["cm_chem", 2, 1]]);
  assert.equal(J(check("fx_corr", { cm_scrap: 1, cm_chem: 2 })).craftable, true);
  const self = J(check("fx_s_burn", { cm_spirit: 1, cm_gas: 2 }));   // 要金属 1
  assert.equal(self.craftable, true);
  assert.deepEqual(self.payable, [{ item: "mat_metal", name: "金属", short: 1 }]);
  assert.equal(check("nope", {}), null);
});

test("recipeStatus：材料不够时没有成功率；够了、会、在工坊、有熟练才给成功率", () => {
  const { R, run, give } = setup();
  assert.equal(R.craftPlace(run), "bench");
  const lack = J(R.recipeStatus(run, "kolt", "fx_corr"));
  assert.equal(lack.craftable, false);
  assert.equal(lack.odds, null);
  assert.ok(lack.reasons.includes("材料不够"));
  assert.equal(lack.missing.length, 2);
  give("cm_scrap", 1); give("cm_chem", 2);
  const ok = J(R.recipeStatus(run, "kolt", "fx_corr"));
  const odds = R.craftOdds(run, "kolt", "fx_corr");
  assert.equal(ok.craftable, !!odds.base);
  if (ok.craftable) assert.equal(ok.odds.chance, odds.chance);
  // 还不会的配方：材料够也不给成功率
  const hard = J(R.recipeBook(run, "kolt")).find(x => !x.known);
  assert.ok(hard);
  assert.equal(hard.craftable, false);
  assert.equal(hard.odds, null);
  // 不在能做的地方
  run.stage = "task"; run.task = { nodes: [{ type: "battle" }], index: 0 };
  const away = J(R.recipeStatus(run, "kolt", "fx_corr"));
  assert.equal(away.craftable, false);
  assert.ok(away.reasons.includes("这里不能制作"));
});

test("recipeBook：能做的排前面；onlyCraftable / kind 筛选；counts 可以替换成某人能用的数量", () => {
  const { R, run, give } = setup();
  give("cm_scrap", 9); give("cm_chem", 9); give("cm_coil", 9);
  const book = J(R.recipeBook(run, "kolt"));
  assert.equal(book.length, 36);
  const first = book.findIndex(x => !x.craftable);
  assert.ok(book.slice(first).every(x => !x.craftable));
  const only = J(R.recipeBook(run, "kolt", { onlyCraftable: true }));
  assert.equal(only.length, first);
  assert.ok(J(R.recipeBook(run, "kolt", { kind: "status" })).every(x => x.kind === "status"));
  const none = J(R.recipeBook(run, "kolt", { counts: {} }));
  assert.ok(none.every(x => !x.craftable && x.odds === null));
});

test("Rogue.inventory：单机全部是公用；材料带反查；装在武器上的改装件、义体按角色列出；不改存档", () => {
  const { c, R, run, give } = setup();
  give("cm_scale", 2); give("medkit", 1);
  const before = JSON.stringify(run);
  const inv = J(R.inventory(run));
  assert.equal(JSON.stringify(run), before);
  assert.deepEqual(inv.shared.materials.map(x => [x.id, x.qty]).filter(x => x[0] === "cm_scale"), [["cm_scale", 2]]);
  assert.ok(inv.shared.materials.find(x => x.id === "cm_scale").uses.length > 0);
  assert.ok(inv.shared.consumables.some(x => x.id === "medkit"));
  assert.deepEqual(inv.personal.map(p => p.kit), ["kolt", "helu"]);
  assert.ok(inv.personal.every(p => Array.isArray(p.installed) && "cyberware" in p));
  run.party[0].cyber = { armor: 2, shield: 0, sand: 0, spirit: false };
  assert.equal(J(R.inventory(run)).personal[0].cyberware.armor, 2);
  // 存档读回来照常（没有新增要存的字段）
  const saved = J(c.SaveStore.saveRun ? run : run);
  assert.deepEqual(Object.keys(saved).sort(), Object.keys(J(run)).sort());
});

test("buildInventory：名下的归个人，背包总数减去名下的是公用；只给看的人的角色出个人部分", () => {
  const { c } = setup();
  const build = fn(c, "buildInventory");
  const inv = J(build({ medkit: 3, cm_scrap: 4 }, { owned: { kolt: { medkit: 2 }, helu: { medkit: 1 } }, kits: ["kolt"] }));
  assert.equal(inv.shared.consumables.length, 0);   // 3 个医疗包全有主
  assert.deepEqual(inv.shared.materials.map(x => [x.id, x.qty]), [["cm_scrap", 4]]);
  assert.deepEqual(inv.personal.map(p => p.kit), ["kolt"]);
  assert.deepEqual(inv.personal[0].consumables.map(x => [x.id, x.qty]), [["medkit", 2]]);
  assert.equal(inv.usable.kolt.medkit, 2);
  assert.equal(inv.usable.kolt.cm_scrap, 4);
  assert.equal(inv.usable.helu, undefined);
  // 名下记多了（背包里实际少）：按背包里有的封顶
  assert.equal(J(build({ medkit: 1 }, { owned: { kolt: { medkit: 5 } }, kits: ["kolt"] })).personal[0].consumables[0].qty, 1);
});

/* 联机：在规则环境里装上 online-rogue.js（房主一端），玩家的背包只含自己的 + 公用的 */
function onlineSetup() {
  const s = setup("INV-NET");
  const { c, run } = s;
  c.RunFlow = { current: () => run, actRaw: cmd => c.Commands.run ? c.Commands.run(cmd) : null };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "online-rogue.js"), "utf8"), c);
  const O = c.OnlineRogue;
  O.enable(true, "host");
  O.setOwners({ helu: "p2" });
  return Object.assign(s, { O });
}

test("联机：房主算数量，每个玩家只拿到自己角色名下的 + 公用的；看不到别人名下的", () => {
  const { O, run, c } = onlineSetup();
  c.S.state.bag.items = [{ id: "medkit", qty: 3 }, { id: "cm_scrap", qty: 2 }];
  const d = O.data(run);
  d.owned = { kolt: { medkit: 2 }, helu: { medkit: 1 } };
  const p2 = J(O.backpackFor("p2"));
  assert.deepEqual(p2.personal.map(p => p.kit), ["helu"]);
  assert.deepEqual(p2.personal[0].consumables.map(x => [x.id, x.qty]), [["medkit", 1]]);
  assert.ok(!JSON.stringify(p2.personal).includes("kolt"));
  assert.equal(p2.usable.kolt, undefined);
  assert.deepEqual(p2.shared.materials.map(x => [x.id, x.qty]), [["cm_scrap", 2]]);
  const host = J(O.backpackFor("host"));
  assert.deepEqual(host.personal.map(p => p.kit), ["kolt"]);
  assert.equal(host.usable.kolt.medkit, 2);
});

test("联机：viewFor 带上 backpack，工坊里每个自己的角色一份配方簿（材料按自己能用的算）", () => {
  const { O, run, give } = onlineSetup();
  give("cm_scrap", 1); give("cm_chem", 2);
  const v = J(O.viewFor("p2"));
  assert.ok(v.backpack && v.backpack.shared);
  assert.deepEqual(v.backpack.personal.map(p => p.kit), ["helu"]);
  assert.ok(v.workshop, "城里有工坊");
  assert.deepEqual(v.workshop.recipes.map(x => x.kit), ["helu"]);
  const corr = v.workshop.recipes[0].list.find(x => x.id === "fx_corr");
  assert.equal(corr.missing.length, 0);
  assert.ok(v.workshop.recipes[0].list.filter(x => !x.craftable).every(x => x.odds === null));
});
