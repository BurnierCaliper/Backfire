// 客制化改了 atk：武器页最上面的「武器 ATK」和角色资料卡上的武器 atk 直接写改后的数
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

test("atk 加值 / 比例：武器工坊和角色资料的武器 atk 都给出客制化后的数", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], enemies: [], seed: "AM" });
  const st = c.S.state;
  const ruby = c.findKit("ruby", st.units), kit = ruby.linkedKits[0];
  const plain = c.SkillText.armoryData().find(h => h.kit === "ruby").weapons.find(w => w.kit === kit);
  assert.equal(plain.atkFinal, plain.atk, "没有客制化：一样");
  st.weaponMods = { [kit]: { atk: 3, atkPct: 0.5 } };
  const w = c.SkillText.armoryData().find(h => h.kit === "ruby").weapons.find(x => x.kit === kit);
  assert.equal(w.atkFinal, Math.floor(w.atk * 1.5) + 3);
  assert.equal(w.heldFinal, Math.floor(w.heldBase * 1.5) + 3);
  const sheet = c.SkillText.sheetData().find(h => h.kit === "ruby").weapons.find(x => x.kit === kit);
  assert.equal(sheet.atkFinal, Math.floor(sheet.atk * 1.5) + 3);
});
