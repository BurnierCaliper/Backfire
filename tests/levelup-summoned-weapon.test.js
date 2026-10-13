// 武器人在场时升级：学到的技能照常生效，升级提示也要写全（以前按「武器不在手」比较，漏掉要拿着武器才列出的技能）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function battle(hk) {
  const c = H.load();
  c.BattleSim.setup({ party: [hk], enemies: [{ id: "thug_knife", lv: 1, zone: 1 }], seed: "LVW" });
  c.startCombat();
  const hero = c.findKit(hk, c.S.state.units);
  hero.level = 1; hero.xp = 0;
  return { c, hero };
}
const lastEvent = c => { const ev = c.LevelUp.unseen(); return ev[ev.length - 1]; };
const names = ev => plain((ev.skills || []).map(s => s.name).sort());

[["kolt", "torque"], ["ruby", "mint"], ["tou", "mochi"]].forEach(([hk, wk]) => {
  test(`${hk}：武器人（${wk}）在场时升级，升级提示和武器在手时一样写出新技能；收回后技能都在`, () => {
    const held = battle(hk);
    held.hero.xp = 3000; held.c.tryLevelUp(held.hero);
    const want = names(lastEvent(held.c));
    assert.ok(want.length >= 2, "对照组应学到几个技能");

    const { c, hero } = battle(hk);
    const w = c.spawnWeapon(hero, wk);
    assert.ok(w, "武器人唤出");
    hero.xp = 3000;
    c.tryLevelUp(hero);
    assert.equal(hero.level, held.hero.level);
    assert.deepEqual(names(lastEvent(c)), want, "升级提示不漏技能");
    c.returnWeapon(w);
    assert.deepEqual(plain(c.skillList(hero).map(s => s.id).sort()), plain(held.c.skillList(held.hero).map(s => s.id).sort()), "收回后技能和一直拿着武器时一样");
  });
});

test("单局：武器人在场时打完升级，等级、待选奖励写回单局", () => {
  const c = H.load(); const R = c.Rogue;
  const run = R.newRun({ party: ["kolt", "helu"], seed: "LVW2" });
  R.acceptTask(run, "main"); while (!R.battleSpec(run)) run.task.index++;
  c.BattleSim.setup(R.battleSpec(run)); c.startCombat();
  const kolt = c.findKit("kolt", c.S.state.units);
  c.spawnWeapon(kolt, "torque");
  kolt.xp = 3000;
  R.finishBattle(run, "win");
  const h = run.party.find(x => x.kit === "kolt");
  assert.ok(h.level >= 5);
  assert.ok((h.pending || []).length > 0 || Object.keys(plain(h.rolePicks || {})).length > 0);
  const ev = c.LevelUp.unseen().filter(e => e.kit === "kolt").pop();
  assert.ok(ev && ev.skills.length >= 2, "升级提示写出了新技能");
});
