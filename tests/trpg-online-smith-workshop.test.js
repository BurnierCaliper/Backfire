// 联机跑团玩家端：武器升级（工匠）/ 工坊（制作 · 拆解）。主持人开了才能用；钱从这名角色自己的钱包出；房主结算；发给玩家的数据过白名单、没有坚毅
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const V = require("../online-view");
const vm = require("node:vm");
const J = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "SMWK" });
  c.S.TRPG.active = true;
  c.S.state.kuizhi = 777;
  c.LEDGER.purse = { kolt: 50000, helu: 3 };
  // 顶层 const 不挂在 context 上，取出来给测试用
  c.EFFECT_ITEMS = vm.runInContext("EFFECT_ITEMS", c); c.CRAFT_RECIPES = vm.runInContext("CRAFT_RECIPES", c);
  return c;
}
const weaponOf = (c, kit) => c.trpgHeroes().find(h => h.kit === kit).linkedKits[0];
/** 把这把武器放到 4 级：下一级（5 级）要找工匠，材料 + 加工费 8000 */
function atLevel4(c, kit) {
  const h = c.trpgHero(kit), w = weaponOf(c, kit);
  h.weaponLevels = Object.assign({}, h.weaponLevels, { [w]: 4 });
  return w;
}

test("工匠没开：玩家升不了武器；开了之后找工匠升，材料和加工费都扣，费用从这名角色的钱包出", () => {
  const c = field();
  const w = atLevel4(c, "kolt");
  assert.throws(() => c.trpgSmithUpgrade("kolt", w, "smith"), /工匠现在没开/);
  c.S.TRPG.smithOpen = true;
  const info = c.trpgUpgradeInfo(c.trpgHero("kolt"), w);
  info.mats.forEach(m => c.bagAdd(m.id, m.need));
  const fee = c.trpgSmithFee(info), lv = info.lv;
  assert.ok(fee > 0, "测试要选一把升级要加工费的武器");
  c.trpgSmithUpgrade("kolt", w, "smith");
  assert.equal(c.trpgWeaponLevel(c.trpgHero("kolt"), w), lv + 1);
  assert.equal(c.trpgPurse("kolt"), 50000 - fee);
  assert.equal(c.S.state.kuizhi, 777, "公账不动");
  assert.equal(c.trpgPurse("helu"), 3, "别人的钱包不动");
  info.mats.forEach(m => assert.equal(c.bagCount(m.id), 0));
});

test("钱包不够 / 材料不够 / 不是自己的武器：失败，不扣钱不扣材料不升级", () => {
  const c = field();
  c.S.TRPG.smithOpen = true;
  const w = atLevel4(c, "helu"), info = c.trpgUpgradeInfo(c.trpgHero("helu"), w);
  assert.throws(() => c.trpgSmithUpgrade("helu", w, "smith"), /材料不够/);
  info.mats.forEach(m => c.bagAdd(m.id, m.need));
  assert.throws(() => c.trpgSmithUpgrade("helu", w, "smith"), /奎支不够/);
  assert.equal(c.trpgPurse("helu"), 3);
  info.mats.forEach(m => assert.equal(c.bagCount(m.id), m.need));
  assert.throws(() => c.trpgSmithUpgrade("helu", weaponOf(c, "kolt"), "smith"), /不是你的武器/);
  assert.throws(() => c.trpgSmithUpgrade("helu", w, "gm"), /不认识/);
});

test("工作站自己升（≤ 4 级）：只耗材料，不要钱；5 级以上不能自己升", () => {
  const c = field();
  c.S.TRPG.smithOpen = true;
  const h = c.trpgHero("helu"), w = weaponOf(c, "helu");
  h.weaponLevels = Object.assign({}, h.weaponLevels, { [w]: 3 });
  c.trpgUpgradeInfo(h, w).mats.forEach(m => c.bagAdd(m.id, m.need));
  c.trpgSmithUpgrade("helu", w, "self");
  assert.equal(c.trpgWeaponLevel(h, w), 4);
  assert.equal(c.trpgPurse("helu"), 3);
  c.trpgUpgradeInfo(h, w).mats.forEach(m => c.bagAdd(m.id, m.need));
  assert.throws(() => c.trpgSmithUpgrade("helu", w, "self"), /找武器工匠/);
  assert.equal(c.trpgWeaponLevel(h, w), 4);
});

test("trpgSmithPacket：{kit,name,purse,weapons}；投影后保留公开数字，不带坚毅", () => {
  const c = field();
  c.S.state.units.forEach(u => { if (u.isPlayer) { u.shp = 13; u.shpMax = 21; } });
  const p = J(c.trpgSmithPacket("kolt"));
  assert.equal(p.purse, 50000);
  assert.ok(p.weapons.length && p.weapons[0].mats.length);
  const out = V.projectPacket({ type: "result", smith: { heroes: [p], hackedField: "x", shp: 13 } }, { recipientId: "p1", gmId: "host" });
  assert.equal(out.smith.heroes[0].weapons[0].fee, p.weapons[0].fee);
  assert.doesNotMatch(JSON.stringify(out.smith), /shp|hackedField|坚毅/);
});

test("工坊没开不能做；开了：只能做会的配方，材料够就扣材料、推进时间；不够抛错且不推进时间", () => {
  const c = field();
  const easy = c.EFFECT_ITEMS.find(it => c.CRAFT_RECIPES[it.id] && c.trpgKnowsRecipe(it.id));
  assert.ok(easy);
  assert.throws(() => c.trpgWorkshopCraft("kolt", easy.id, null), /工坊现在没开/);
  c.S.TRPG.workshopOpen = true;
  const t0 = c.LEDGER.clock + c.LEDGER.day * 1440;
  assert.throws(() => c.trpgWorkshopCraft("kolt", easy.id, null), /材料不够/);
  assert.equal(c.LEDGER.clock + c.LEDGER.day * 1440, t0);
  const unknown = c.EFFECT_ITEMS.find(it => c.CRAFT_RECIPES[it.id] && !c.trpgKnowsRecipe(it.id));
  if (unknown) assert.throws(() => c.trpgWorkshopCraft("kolt", unknown.id, null), /教会配方/);
  const rc = c.CRAFT_RECIPES[easy.id];
  Object.keys(rc).forEach(id => c.bagAdd(id, rc[id]));
  const notes = c.trpgWorkshopCraft("kolt", easy.id, null);
  assert.ok(notes.some(n => /制作/.test(n)));
  // 成功用掉全部材料；失败按规则损失一部分（废料、金属留着）：至少有一样材料少了
  assert.ok(Object.keys(rc).some(id => c.bagCount(id) < rc[id]), "材料应该减少");
  assert.ok(c.LEDGER.clock + c.LEDGER.day * 1440 > t0, "制作会推进游戏时间");
});

test("拆解：工坊没开不能拆；开了拆一件拿回材料，不花时间不花钱", () => {
  const c = field();
  const it = c.EFFECT_ITEMS.find(x => c.salvageYield(x.id));
  assert.ok(it);
  c.bagAdd(it.id, 1);
  assert.throws(() => c.trpgWorkshopSalvage("kolt", it.id), /工坊现在没开/);
  c.S.TRPG.workshopOpen = true;
  const y = c.salvageYield(it.id);
  c.trpgWorkshopSalvage("kolt", it.id);
  assert.equal(c.bagCount(it.id), 0);
  Object.keys(y).forEach(id => assert.ok(c.bagCount(id) >= y[id]));
  assert.equal(c.trpgPurse("kolt"), 50000);
  assert.throws(() => c.trpgWorkshopSalvage("kolt", it.id), /拆不了|背包里没有/);
});

test("trpgWorkshopPacket：配方 / 材料 / 成功率 / 能拆的东西；投影后没有坚毅", () => {
  const c = field();
  c.S.state.units.forEach(u => { if (u.isPlayer) { u.shp = 13; u.shpMax = 21; } });
  const p = J(c.trpgWorkshopPacket("kolt"));
  assert.ok(p.recipes.length && p.recipes.every(r => r.mats.length));
  const out = V.projectPacket({ type: "result", workshop: { heroes: [p] } }, { recipientId: "p1", gmId: "host" });
  assert.equal(out.workshop.heroes[0].recipes.length, p.recipes.length);
  assert.doesNotMatch(JSON.stringify(out.workshop), /shp|Shp|坚毅/);
});

test("联机接线：房主只在主持人开了才发 smith / workshop；三条消息只能动自己的角色，开关是主持人的 trpg 指令", () => {
  const og = read("online-game.js"), hg = read("hotseat-game.js"), tc = read("trpg-commands.js");
  assert.match(og, /TRPG\.smithOpen \? trpgPacketsFor\(id, id === identity\.id, trpgSmithPacket\)/);
  assert.match(og, /TRPG\.workshopOpen \? trpgPacketsFor\(id, id === identity\.id, trpgWorkshopPacket\)/);
  assert.match(og, /"smithUpgrade", "workshopCraft", "workshopSalvage", "cyberRequest"/);
  assert.match(hg, /"smithUpgrade", "workshopCraft", "workshopSalvage", "cyberRequest"/);
  assert.match(hg, /session\.ownerOf\(own\.id\) !== sender\)\) fail\(deny\)/);
  for (const t of ["smithUpgrade", "workshopCraft", "workshopSalvage"]) assert.match(hg, new RegExp(t + ": c => \\{\\s+const kit = trpgOwnKit"));
  assert.match(tc, /smithOpen: c =>/); assert.match(tc, /workshopOpen: c =>/);
});

test("联机单局（rogue）这三样本来就有：商店、工匠（武器升级）、工坊（制作 / 拆解 / 学配方）都在 viewFor 和玩家面板里", () => {
  const rg = read("online-rogue.js"), ui = read("online-ui.js");
  for (const key of ["shop", "smith", "workshop"]) assert.match(rg, new RegExp("choice, waitingLevel, shop, shopSell, points, smith, parts, clinic, workshop"), key);
  for (const a of ["buy", "upgradeWeapon", "learnRecipe", "salvage", "setCraftJob"]) assert.match(rg, new RegExp(`"${a}"`), a);
  assert.match(ui, /aria-label="工匠"/); assert.match(ui, /rogueWorkshop/);
});
