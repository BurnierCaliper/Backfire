// 长线养成抽取机概率：30% 角色 / 40% 武器材料 / 30% 制作材料（rogue.js · drawMany / drawHero；rogue-data.js · ROGUE_GACHA）
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function fresh(seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed, growth: true });
  return { c, run, R: c.Rogue, GA: c.ROGUE_GACHA || c.S.ROGUE_GACHA };
}
const LIGHTS = ["gold", "purple", "blue", "gray"];

function sample(seeds, per) {
  const out = [];
  for (let s = 0; s < seeds; s++) {
    const { c, run, R } = fresh("GR" + s);
    c.bagAdd("heart_fusion", per);
    out.push(...R.drawMany(run, per).results);
  }
  return out;
}

test("大类概率约 30 / 40 / 30（多个种子），结果结构给界面用", () => {
  const rs = sample(40, 100);
  const n = rs.length, cnt = k => rs.filter(r => r.kind === k).length / n;
  assert.ok(Math.abs(cnt("character") - 0.30) < 0.03, "角色 " + cnt("character"));
  assert.ok(Math.abs(cnt("weapon_material") - 0.40) < 0.03, "武器材料 " + cnt("weapon_material"));
  assert.ok(Math.abs(cnt("craft_material") - 0.30) < 0.03, "制作材料 " + cnt("craft_material"));
  rs.forEach(r => {
    assert.ok(LIGHTS.includes(r.light)); assert.equal(r.rarity, r.light);
    assert.equal(typeof r.id, "string"); assert.equal(r.qty, 1);
    if (r.kind === "character") assert.equal(r.kit, r.id);
  });
});

test("武器材料各档比例 = 每日挑战奖励的同一张表；制作材料等概率", () => {
  const { c, GA } = fresh("GRx");
  const rs = sample(40, 100);
  const w = rs.filter(r => r.kind === "weapon_material"), sum = GA.weaponMats.reduce((a, m) => a + m.w, 0);
  GA.weaponMats.forEach(m => {
    const got = w.filter(r => r.id === m.id).length / w.length;
    const p = m.w / sum;
    assert.ok(w.some(r => r.id === m.id), `${m.id} 一次都没出现`);
    assert.ok(Math.abs(got - p) < Math.max(0.005, p * 0.3), `${m.id} ${got}`);
  });
  const cm = rs.filter(r => r.kind === "craft_material"), ids = (c.CRAFT_MATERIALS || c.S.CRAFT_MATERIALS).map(m => m.id);
  ids.forEach(id => { const got = cm.filter(r => r.id === id).length / cm.length; assert.ok(Math.abs(got - 1 / ids.length) < 0.035, `${id} ${got}`); });
  // 每日挑战用的就是这张表：把表改成只有赫心结晶，完成一个每日挑战就给赫心结晶
  const f = fresh("GRd");
  f.GA.weaponMats.splice(0, f.GA.weaponMats.length, { id: "mat_heart", w: 1 });
  const t = f.R.growthDaily(f.run).tasks[0], before = f.c.bagCount("mat_heart");
  f.R.growthDailyBump(f.run, t.id, t.target, []);
  assert.ok(t.done);
  assert.equal(f.c.bagCount("mat_heart") - before, 1);
});

test("光色：角色金、赫心结晶金、稀有晶体紫、聚合材料 / 精炼合金蓝、金属灰、制作材料蓝", () => {
  const rs = sample(20, 100);
  const want = { mat_heart: "gold", mat_crystal: "purple", mat_polymer: "blue", mat_alloy: "blue", mat_metal: "gray" };
  rs.forEach(r => {
    if (r.kind === "character") assert.equal(r.light, "gold");
    else if (r.kind === "craft_material") assert.equal(r.light, "blue");
    else assert.equal(r.light, want[r.id], r.id);
  });
});

test("奎支按光色（待定开关 kuizhiMode = byLight）", () => {
  const { c, run, R, GA } = fresh("GRk");
  assert.equal(GA.kuizhiMode, "byLight");
  c.bagAdd("heart_fusion", 10);
  const k0 = Number(c.S.state.kuizhi) || 0;
  const r = R.drawMany(run, 10);
  r.results.forEach(x => assert.equal(x.kuizhi, GA.kuizhiByLight[x.light]));
  assert.equal((Number(c.S.state.kuizhi) || 0) - k0, r.results.reduce((a, x) => a + x.kuizhi, 0));
});

test("flat 模式：每抽 base + extra", () => {
  const { c, run, R, GA } = fresh("GRf");
  GA.kuizhiMode = "flat";
  c.bagAdd("heart_fusion", 5);
  R.drawMany(run, 5).results.forEach(x => assert.equal(x.kuizhi, GA.kuizhiFlat.base + (GA.kuizhiFlat.extra[x.light] || 0)));
});

test("drawMany 消耗 n 个融合体；不够时报错且什么都不动；drawHero 返回同样的结构", () => {
  const { c, run, R } = fresh("GRm");
  c.bagAdd("heart_fusion", 12);
  const r = R.drawMany(run, 10);
  assert.equal(r.results.length, 10);
  assert.equal(c.bagCount("heart_fusion"), 2);
  const snap = JSON.stringify({ run, bag: c.S.state.bag, k: c.S.state.kuizhi });
  assert.throws(() => R.drawMany(run, 10), /不够/);
  assert.throws(() => R.drawMany(run, 0), /正整数/);
  assert.equal(JSON.stringify({ run, bag: c.S.state.bag, k: c.S.state.kuizhi }), snap);
  const one = R.drawHero(run);
  assert.ok(["character", "weapon_material", "craft_material"].includes(one.kind));
  assert.ok(Array.isArray(one.notes));
  assert.equal(c.bagCount("heart_fusion"), 1);
});

test("同一个种子结果完全一样；存档往返后接着抽也一样", () => {
  const a = fresh("GRs"), b = fresh("GRs");
  a.c.bagAdd("heart_fusion", 20); b.c.bagAdd("heart_fusion", 20);
  const ra = a.R.drawMany(a.run, 10).results, rb = b.R.drawMany(b.run, 10).results;
  assert.equal(JSON.stringify(ra), JSON.stringify(rb));
  // run.draws 是存档的一部分：往返 JSON 后接着抽，和不往返一样
  const copy = JSON.parse(JSON.stringify(b.run));
  assert.equal(copy.draws, 10);
  const na = a.R.drawMany(a.run, 5).results.map(x => x.id);
  const nb = b.R.drawMany(copy, 5).results.map(x => x.id);
  assert.equal(JSON.stringify(na), JSON.stringify(nb));
});

test("所有角色满级：角色那份按 40:30 分给材料，照样能抽", () => {
  const { c, run, R } = fresh("GRmax");
  c.bagAdd("heart_fusion", 400);
  for (let i = 0; i < 400 && !R.drawInfo(run).allMaxed; i++) {
    run.party.concat(run.reserve).forEach(h => { h.level = 20; });
    if (R.drawInfo(run).allMaxed) break;
    R.drawHero(run);
  }
  assert.ok(R.drawInfo(run).allMaxed, "凑齐了所有角色");
  const rates = R.drawRates(run);
  assert.equal(rates.hero, 0);
  assert.ok(Math.abs(rates.weapon - 4 / 7) < 1e-9);
  assert.equal(R.drawInfo(run).canDraw, true);
  const rs = R.drawMany(run, 100).results;
  assert.ok(rs.every(r => r.kind !== "character"));
});

test("每日挑战：每完成 1 个给 1 个融合体，三个全完成额外 5 个", () => {
  const { c, run, R } = fresh("GRdaily");
  const d = R.growthDaily(run);
  const f0 = c.bagCount("heart_fusion");
  const ids = d.tasks.map(t => t.id);
  d.tasks.forEach(t => { t.progress = t.target - 1; });
  const notes = [];
  // 直接用每日挑战的结算：一个一个完成
  for (let i = 0; i < 3; i++) {
    d.tasks[i].progress = d.tasks[i].target - 1;
    R.growthDailyBump(run, ids[i], 1, notes);
    if (!d.tasks[i].done) { d.tasks[i].target = d.tasks[i].progress + 1; R.growthDailyBump(run, ids[i], 1, notes); }
    if (!d.tasks[i].done) continue;
    assert.equal(c.bagCount("heart_fusion") - f0, i + 1 + (i === 2 ? 5 : 0));
  }
  assert.ok(d.allDone);
  assert.equal(c.bagCount("heart_fusion") - f0, 3 + 5);
  assert.ok(notes.some(t => /额外获得 赫心融合体×5/.test(t)));
});

test("每日挑战奖励说明（rogue-ui.js）的数字从 ROGUE_GACHA 读，不再写旧规则", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "rogue-ui.js"), "utf8");
  const vm = require("node:vm");
  const start = src.indexOf("  function dailyRewardText(");
  assert.ok(start >= 0);
  const body = src.slice(start, src.indexOf("\n  }\n", start) + 4);
  const ctx = vm.createContext({ ROGUE_GACHA: { dailyTaskFusion: 2, dailyAllFusion: 7 }, esc: String });
  vm.runInContext(body + "\nthis.f = dailyRewardText;", ctx);
  assert.equal(ctx.f("赫心融合体"), "每个完成：随机武器材料 + 2 个赫心融合体 + 1000 奎支；三个全完成：额外 7 个赫心融合体 和 1000 奎支。");
  ctx.ROGUE_GACHA.dailyTaskFusion = 0; ctx.ROGUE_GACHA.dailyAllFusion = 0;
  assert.doesNotMatch(ctx.f("赫心融合体"), /融合体/);
  assert.doesNotMatch(src, /额外 1 个\$\{esc\(fusion\)\}/);
});
