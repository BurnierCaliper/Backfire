// issue #124：画面效果用独立的随机源，不消耗战斗用的种子随机数
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");

test("fxRandom 不动种子随机数：同一个种子，中间有没有画面效果，骰子都一样", () => {
  const c = H.load();
  const seq = (fx) => vm.runInContext(`(() => {
    RNG.install("FX124");
    const out = [];
    for (let i = 0; i < 6; i++) { if (${fx}) for (let k = 0; k < i * 3 + 1; k++) fxRandom(); out.push(Math.random()); }
    const draws = RNG.draws();
    RNG.uninstall();
    return JSON.stringify({ out, draws });
  })()`, c);
  const quiet = JSON.parse(seq(false)), noisy = JSON.parse(seq(true));
  assert.deepEqual(noisy.out, quiet.out, "画面效果抽了随机数，骰子不变");
  assert.equal(noisy.draws, quiet.draws, "种子随机数被抽的次数不变");
  assert.equal(quiet.draws, 6);
});

test("fxRandom 在种子随机数顶替 Math.random 之后仍然是真随机", () => {
  const c = H.load();
  const r = JSON.parse(vm.runInContext(`(() => {
    RNG.install("FX124B");
    const xs = Array.from({ length: 50 }, () => fxRandom());
    RNG.uninstall();
    return JSON.stringify({ distinct: new Set(xs).size, ok: xs.every(x => x >= 0 && x < 1) });
  })()`, c));
  assert.ok(r.ok && r.distinct > 40);
});

test("画面效果的文件不再直接用 Math.random（只剩 fxRand 的兜底）", () => {
  for (const f of ["attack-fx.js", "hit-fx.js", "sfx.js", "weather-fx.js", "routemap.js", "online-ui.js"]) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").filter(l => /Math\.random/.test(l) && !/const fxRand = /.test(l));
    assert.deepEqual(lines, [], f + " 还在直接用 Math.random");
  }
  // game.js 里剩下的是战斗用的种子随机数的接管 / 还原（withSeed、预演），不是画面效果
  const g = fs.readFileSync(path.join(ROOT, "game.js"), "utf8").split("\n").filter(l => /Math\.random/.test(l));
  assert.ok(g.every(l => /Math\.random\s*=|=\s*Math\.random|blockRollFor|makeRng|return 1 \+ Math\.floor\(Math\.random/.test(l)), g.join("\n"));
});
