// 升级提示（levelup.js）：角色升级、武器升级、学到职责技能时记一条事件，列出多了什么（新技能带完整说明）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

test("角色升级：记下数值变化和这次解锁的技能（带完整说明、消耗）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], enemies: [], seed: "LV1" });
  const u = c.findKit("ruby", c.S.state.units);
  u.xp = c.xpToNext(1) + c.xpToNext(2);   // 1 → 3 级
  assert.equal(c.tryLevelUp(u), true);
  const [ev] = plain(c.LevelUp.unseen());
  assert.equal(ev.kind, "level"); assert.equal(ev.kit, "ruby"); assert.equal(ev.from, 1); assert.equal(ev.to, 3);
  assert.match(ev.title, /瑞比 升到 3 级/);
  assert.ok(ev.stats.some(r => r.key === "hp" && r.to > r.from));
  assert.deepEqual(ev.skills.map(s => s.name), ["电流激荡", "短路"]);
  assert.match(ev.skills[0].text, /电击伤害/);
  assert.ok(ev.skills[0].cost);
  // 没升级不记
  assert.equal(c.tryLevelUp(u), false);
  assert.equal(c.LevelUp.unseen().length, 1);
  c.LevelUp.markSeen(ev.id);
  assert.equal(c.LevelUp.unseen().length, 0);
});

test("4 级：属性点写进「还要选」", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], enemies: [], seed: "LV2" });
  const u = c.findKit("yuito", c.S.state.units);
  u.level = 3; u.xp = c.xpToNext(3);
  c.tryLevelUp(u);
  assert.ok(c.LevelUp.unseen()[0].pending.some(t => /属性点 \+1/.test(t)));
});

test("跑团：武器升级记一条——新的武器人技能、改装槽、被动升级（被动+ 的完整说明）", () => {
  const c = H.load();
  c.BattleSim.setup({ party: ["ruby", "yuito"], enemies: [], seed: "LV3" });
  const u = c.findKit("ruby", c.S.state.units);
  const before = c.LevelUp.snapshot(u);
  c.setOwnedWeaponLevel(u, u.linkedKits[0], 5);
  const ev = plain(c.LevelUp.note("weapon", u, before, { weapon: "明特" }));
  assert.equal(ev.kind, "weapon");
  assert.match(ev.title, /明特 升到 5 级/);
  const w = ev.weapons[0];
  assert.equal(w.from, 1); assert.equal(w.to, 5);
  assert.equal(w.slots, 1, "3 级开第一个改装槽");
  assert.ok(w.skills.some(s => s.name === "驱逐") && w.skills.some(s => s.name === "机体修复"));
  assert.ok(ev.passives.some(p => p.kind === "plus" && /纳米科技\+/.test(p.name) && /【升级】/.test(p.text)));
});

test("单局：工匠升级武器、升级后的待选奖励、选职责技能都有提示", () => {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ party: ["ruby", "yuito"], seed: "LV4" });
  // 工匠升级武器
  const sid = R.presentSmiths(run)[0] || (run.smiths = ["teresa"], "teresa");
  run.smithIntro = { [sid]: true };
  c.S.state.kuizhi = 999999;
  const opt = R.smithOptions(run, sid).find(o => o.owner === "ruby");
  try { R.upgradeWeapon(run, opt.kit, sid); } catch (e) { if (!/介绍|陌生/.test(e.message)) throw e; }
  const wev = c.LevelUp.unseen().find(e => e.kind === "weapon");
  assert.ok(wev, "工匠升级武器有提示");
  assert.equal(wev.weapons[0].to, 2);
  // 打完一场升级：待选的奖励写进提示
  R.acceptTask(run, "main");
  while (!R.battleSpec(run)) run.task.index++;
  c.BattleSim.setup(R.battleSpec(run));
  const u = c.findKit("ruby", c.S.state.units);
  u.xp = 0; for (let L = 1; L < 5; L++) u.xp += c.xpToNext(L);
  R.finishBattle(run, "win");
  const lev = c.LevelUp.unseen().find(e => e.kind === "level" && e.kit === "ruby");
  assert.ok(lev && lev.to === 5);
  assert.ok(lev.pending.some(t => /在升级选择里选/.test(t)), JSON.stringify(lev.pending));
  // 选职责技能：弹「学会了新能力」
  const p = R.pendingChoices(run).find(x => x.kit === "ruby" && x.choice.type === "role");
  if (p) {
    R.choose(run, "ruby", p.index, R.choiceOptions(run, "ruby", p.index)[0].value);
    const cev = c.LevelUp.unseen().find(e => e.kind === "choice");
    assert.ok(cev && cev.skills.length >= 1 && cev.skills[0].text);
  }
});

test("训练场按目标等级直接布置：不弹升级提示", () => {
  const c = H.load();
  c.Training.setupField("ruby", 10, {});
  assert.equal(c.LevelUp.unseen().length, 0);
});
