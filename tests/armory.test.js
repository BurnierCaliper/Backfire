// 武器工坊（armory-ui.js）的数据：补正、atk 明细、改装槽、客制化实际效果
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [], seed: "ARMORY" });
  return c;
}
const weaponOf = (c, kit) => c.SkillText.armoryData().flatMap(h => h.weapons).find(w => w.kit === kit);

test("atk 明细和 computeWeaponAtk 算出来的一样，改装件的补正单独列出", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  kolt.attrs.str = 20;
  c.setOwnedWeaponLevel(kolt, "torque", 7);
  c.installWeaponPart(kolt, "torque", 1, "c_str_dex", true);
  const w = weaponOf(c, "torque");
  assert.equal(w.atk, c.computeWeaponAtk("torque", kolt.attrs, 7, ["c_str_dex"]));
  assert.equal(w.atk, kolt.weaponAtk);
  const b = w.breakdown;
  assert.equal(b.base + b.lvBase, 2 + 6);
  assert.equal(b.tier, 3.5);
  const str = b.rows.find(r => r.attr === "str"), dex = b.rows.find(r => r.attr === "dex");
  assert.deepEqual([str.baseCoef, str.partCoef, str.coef], [0.3, 0.1, 0.4]);
  assert.deepEqual([dex.baseCoef, dex.partCoef, dex.coef], [0, -0.1, -0.1]);
  assert.equal(b.flat, 1, "C 级改装件固定 +1 atk");
  assert.equal(Math.round(b.raw) + b.flat, w.atk);
  assert.deepEqual(plain(w.slots.map(s => s && s.id)), [null, "c_str_dex"]);
  assert.deepEqual(plain(w.lockedSlots), []);
  assert.deepEqual(plain(w.track.map(t => [t.lv, t.done])), [[3, true], [5, true], [7, true], [10, false]]);
});

test("客制化：显示图纸名字、出处和换算后的实际数值", () => {
  const c = field();
  c.S.state.weaponMods = { torque: { bigKill: true, def: -2, block: 10, atk: -4 } };
  c.S.state.weaponBlueprints = { torque: "bp_trevor_bigkill" };
  const kolt = c.findKit("kolt", c.S.state.units);
  const w = weaponOf(c, "torque");
  assert.equal(w.blueprint.name, "大杀器");
  assert.match(w.blueprint.smith, /崔佛/);
  const fx = Object.fromEntries(w.blueprint.effects.map(e => [e.k, e]));
  const big = c.bigKillAtk("torque");
  const held = kolt.personalAtk + w.atk;
  assert.equal(fx["拿着时角色 atk"].v.split("（")[0], `${held} → ${held - 4 + big}`);
  assert.match(fx["耐久上限"].v, new RegExp(`^${w.durBase} → ${w.durMax}`));
  assert.ok(w.durMax < w.durBase);
  assert.equal(fx["架势上限"].tone, "down");
  assert.match(fx["协助格挡"].v, /35% → 45%/);
});

test("没装图纸 / 没开放的槽", () => {
  const c = field();
  const w = weaponOf(c, "ecmo");
  assert.equal(w.blueprint, null);
  assert.deepEqual(plain(w.slots), []);
  assert.deepEqual(plain(w.lockedSlots), [3, 7]);
});

test("图纸每种效果都换成一行文字", () => {
  const c = H.load();
  for (const s of c.S.ROGUE_SMITHS) for (const b of s.blueprints) {
    const rows = c.bpEffectRows(b.mod, { atkWeapon: 10, atkHeld: 15, durBase: 8, durMax: 4, blockBase: 20, bigKill: 6 });
    assert.ok(rows.length >= Object.keys(b.mod).filter(k => !["dur"].includes(k) || !b.mod.bigKill).length - 1, b.name);
    rows.forEach(r => assert.ok(r.k && r.v, b.name));
  }
  const neg = c.bpEffectRows({ attackDice: [1, 6, -1] }, {});
  assert.equal(neg[0].v, "−1d6");
});

test("单局：Rogue.armoryData 带上本局装的图纸", () => {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "ARM-RUN" });
  run.installed = { torque: "bp_trevor_bigkill" };
  const data = c.Commands.dispatch({ type: "run.query", action: "armoryData" }, { run });
  const w = data.flatMap(h => h.weapons).find(x => x.kit === "torque");
  assert.equal(w.blueprint.name, "大杀器");
  assert.equal(c.S.state.weaponBlueprints && c.S.state.weaponBlueprints.torque, "bp_trevor_bigkill");
});

test("每个模式都有武器页入口", () => {
  const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
  const html = read("game.html");
  assert.match(html, /<script src="armory-ui\.js"><\/script>/);
  assert.match(html, /href="armory\.css"/);
  assert.match(read("game.js"), /arm\.dataset\.armory/);                 // 战斗（所有模式共用）
  assert.match(read("trpg-ui.js"), /data-armory="\$\{esc\(h\.kit\)\}"/);  // 跑团
  assert.match(read("rogue-ui.js"), /data-armory-src="run"/);              // 单局 / 单人
  assert.match(read("rogue-ui.js"), /Armory\.register\("run"/);
});
