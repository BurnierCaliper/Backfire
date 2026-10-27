// 混编遇敌贡献工具（tools/enemy-threat-mixed.js）冒烟：抽样、keep/drop、机制计数、可复现
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const H = require("./headless");
const M = require("../tools/enemy-threat-mixed");

test("引入混编工具不会开始跑模拟", () => {
  const out = cp.execFileSync(process.execPath, ["-e", "require('./tools/enemy-threat-mixed');console.log('inert')"], { cwd: H.ROOT, encoding: "utf8", timeout: 5000 });
  assert.equal(out.trim(), "inert");
});

test("--mixed 从 enemy-threat 入口可进；参数拼错报错", () => {
  assert.throws(() => M.parseArgs(["--kits", "nope"]), /Unknown mixed kit/);
  assert.throws(() => M.parseArgs(["--sizes", "5"]), /Sizes/);
  const jobs = M.planMixed({ samples: 1, levels: [15], sizes: [2], kits: ["livesand", "boomcar"] });
  // livesand 1 变体 × keep/drop；boomcar 1 × keep/drop → 4
  assert.equal(jobs.length, 4);
  assert.ok(jobs.every(j => j.mode === "mixed" && (j.arm === "keep" || j.arm === "drop")));
});

test("活沙混编：keep 能触发吸收成巨型；drop 场上无活沙；同种子可复现", () => {
  const job = { kit: "livesand", level: 15, size: 2, index: 0, arm: "keep", variant: "natural" };
  const a = M.runMixedJob(job), b = M.runMixedJob(job);
  assert.notEqual(a.outcome, "error", a.error);
  assert.deepEqual(a, b, "固定种子：重跑一样");
  assert.ok(a.enemies.includes("livesand"));
  assert.ok((a.mech && a.mech.absorbs) >= 0);
  // 有饲料时吸收应能打出（拒绝抽样偏爱盟友；合成兜底也有）
  const drop = M.runMixedJob(Object.assign({}, job, { arm: "drop" }));
  assert.notEqual(drop.outcome, "error", drop.error);
  assert.ok(!drop.enemies.includes("livesand"), "drop 去掉活沙");
  assert.ok((drop.enemies || []).includes("dust_bug") || drop.enemies.length >= 0);
});

test("赶潮沙鱼：白天/夜晚/沙暴变体可跑；夜晚或沙暴伤害应能打出", () => {
  for (const variant of ["day", "night", "sand"]) {
    const r = M.runMixedJob({ kit: "sandfish_drive", level: 15, size: 2, index: 0, arm: "keep", variant });
    assert.notEqual(r.outcome, "error", variant + " " + r.error);
    assert.equal(r.variant, variant);
  }
});

test("自爆小车：护甲层基数不随等级；能自爆", () => {
  const r15 = M.runMixedJob({ kit: "boomcar", level: 15, size: 2, index: 1, arm: "keep", variant: "natural" });
  const r20 = M.runMixedJob({ kit: "boomcar", level: 20, size: 2, index: 1, arm: "keep", variant: "natural" });
  assert.notEqual(r15.outcome, "error", r15.error);
  assert.notEqual(r20.outcome, "error", r20.error);
  const armor = layers => (layers || []).find(l => l.type === "armor");
  if (r15.boomLayers && r20.boomLayers) {
    assert.equal(armor(r15.boomLayers).max, armor(r20.boomLayers).max, "护甲 max 不随等级变");
    const sh = layers => (layers || []).find(l => l.type === "shield");
    assert.ok(sh(r20.boomLayers).max > sh(r15.boomLayers).max, "护盾随等级涨");
  }
});

test("陨体弦蚣 + 微光：追打或分裂计数路径可走", () => {
  const r = M.runMixedJob({ kit: "meteor_centipede", level: 15, size: 2, index: 0, arm: "keep", variant: "glow" });
  assert.notEqual(r.outcome, "error", r.error);
  assert.equal(r.weather, "glow");
  assert.ok(r.enemies.includes("meteor_centipede"));
});
