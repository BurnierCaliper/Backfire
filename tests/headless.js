// 在 Node 里加载规则文件（不带任何网页元素），供测试与批量模拟使用。
//
//   const H = require("./headless");
//   const ctx = H.load();          // 每次调用都是一套全新的、互不影响的规则环境
//   ctx.startCombat();
//
// 规则文件原样加载，和浏览器里用的是同一份代码。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
// 与 game.html 的加载顺序一致（不含 game.js：它是战斗画面）
const RULE_FILES = [
  "run.js", "engine.js", "party.js", "props.js", "enemies.js",
  "growth.js", "items.js", "ledger.js", "app.js", "effects.js", "mods.js", "ai.js", "sim.js", "save.js", "trpg-data.js", "trpg.js", "rogue-data.js", "rogue.js"
];

const cache = new Map();
function compiled(file) {
  if (!cache.has(file)) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    cache.set(file, new vm.Script(src, { filename: file }));
  }
  return cache.get(file);
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear()
  };
}

function load(opt) {
  opt = opt || {};
  const logs = [];
  const sandbox = {
    console: opt.quiet === false ? console : { log() {}, warn() {}, error: (...a) => logs.push(a.join(" ")), info() {} },
    localStorage: memoryStorage(),
    // 规则里的计时器只用于演出（死亡淡出等），无界面时直接丢掉
    setTimeout: () => 0,
    clearTimeout: () => {},
    Math: Object.create(Math)
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  RULE_FILES.forEach(f => {
    if (!fs.existsSync(path.join(ROOT, f))) return;
    compiled(f).runInContext(ctx);
  });
  ctx.__errors = logs;
  // 顶层 const / let 不会挂到 window 上，这里取出常用的几个
  const names = ["state", "RUN", "RNG", "EnemyAI", "BattleSim", "SaveStore", "Rogue", "SKILL_RANGE", "ENEMY_RANK", "ITEM_CATALOG", "LEDGER", "ROGUE_CONFIG", "ROGUE_SHOP", "ROGUE_SMITH", "ROGUE_CLINIC", "ROGUE_SMITHS", "ROGUE_SMITH_RULES", "ROGUE_CHECKS", "ROGUE_NODE_TYPES", "HERO_PROFILES", "PROF_LIST", "HANDBOOK_SHOP", "HANDBOOK_WEAPON_UPGRADE", "TRPG", "SCORE_GRADES", "SCORE_RULES", "SCORE_SPEED"];
  ctx.S = vm.runInContext("({" + names.map(n =>
    `get ${n}() { return typeof ${n} === "undefined" ? undefined : ${n}; }`).join(",") + "})", ctx);
  ctx.BattleSim = ctx.S.BattleSim;
  ctx.EnemyAI = ctx.S.EnemyAI;
  ctx.SaveStore = ctx.S.SaveStore;
  ctx.Rogue = ctx.S.Rogue;
  ctx.ITEM_CATALOG = ctx.S.ITEM_CATALOG;
  ctx.LEDGER = ctx.S.LEDGER;
  ctx.localStorage = sandbox.localStorage;
  return ctx;
}

module.exports = { load, ROOT, RULE_FILES };
