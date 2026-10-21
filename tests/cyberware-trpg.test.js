// 跑团诊所 · 义体：packet.cyberware 同单局形状；装 / 拆从这名角色的钱包出；联机由房主（hotseat-game.js）结算
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const V = require("../online-view");
const J = x => JSON.parse(JSON.stringify(x));
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CWTRPG" });
  c.S.TRPG.active = true; c.S.TRPG.clinicOpen = true;
  c.S.state.kuizhi = 777;
  c.LEDGER.purse = { kolt: 50000, helu: 3 };
  c.cyberwareLoadExamples();
  return c;
}

test("trpgCyberwarePacket：{kit,name,purse,view,shop,previews}，purse 是自己的钱包；投影后没有坚毅", () => {
  const c = field();
  c.S.state.units.forEach(u => { if (u.isPlayer) { u.shp = 13; u.shpMax = 21; } });
  const p = J(c.trpgCyberwarePacket("kolt"));
  for (const k of ["kit", "name", "purse", "view", "shop", "previews"]) assert.ok(k in p, k);
  assert.equal(p.purse, 50000);
  assert.ok(p.previews.example_t5_melee.ok);
  const out = V.projectPacket({ type: "result", cyberware: { heroes: [p, J(c.trpgCyberwarePacket("helu"))] } }, { recipientId: "p1", gmId: "host" });
  assert.equal(out.cyberware.heroes.length, 2);
  assert.equal(out.cyberware.heroes[1].purse, 3);
  assert.doesNotMatch(JSON.stringify(out.cyberware), /shp|Shp|坚毅/);
});

test("装 / 拆：从这名角色的钱包扣，公账和别人的钱包不动；生命上限扣了又还回来", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  const hp0 = kolt.layers[kolt.layers.length - 1].max;
  const price = J(c.trpgCyberwarePacket("kolt")).shop[0].price;
  c.trpgCyberwareInstall("kolt", "example_t5_melee");
  assert.equal(c.trpgPurse("kolt"), 50000 - price);
  assert.equal(c.S.state.kuizhi, 777); assert.equal(c.trpgPurse("helu"), 3);
  assert.equal(kolt.layers[kolt.layers.length - 1].max, hp0 - 5);
  const rc = J(c.trpgCyberwarePacket("kolt")).view.installed[0].removeCost;
  c.trpgCyberwareRemove("kolt", "example_t5_melee");
  assert.equal(c.trpgPurse("kolt"), 50000 - price - rc);
  assert.equal(kolt.layers[kolt.layers.length - 1].max, hp0);
});

test("钱不够 / 诊所没开：失败且不扣钱", () => {
  const c = field();
  assert.throws(() => c.trpgCyberwareInstall("helu", "example_t5_melee"), /奎支不够/);
  assert.equal(c.trpgPurse("helu"), 3);
  c.S.TRPG.clinicOpen = false;
  assert.throws(() => c.trpgCyberwareInstall("kolt", "example_t5_melee"), /诊所现在没开/);
  assert.equal(c.trpgPurse("kolt"), 50000);
});

test("联机接线：房主发 cyberware（诊所开着才发）；cyberwareInstall / cyberwareRemove 只能动自己的角色", () => {
  const og = read("online-game.js"), hg = read("hotseat-game.js");
  assert.match(og, /TRPG\.clinicOpen \? trpgCyberwareFor\(id, id === identity\.id\) : null/);
  assert.match(og, /"cyberwareInstall", "cyberwareRemove"[^\]]*\]\);/);
  assert.match(hg, /"cyberRequest", "cyberwareInstall", "cyberwareRemove"[^\]]*\]\);/);
  assert.match(hg, /cyberwareInstall: c => \{[\s\S]*?session\.ownerOf\(own\.id\) !== sender\)\) fail\("只能给自己的角色装、拆义体"\)/);
  assert.match(hg, /cyberwareRemove: c => \{[\s\S]*?trpgCyberwareRemove\(kit, id\)/);
});
