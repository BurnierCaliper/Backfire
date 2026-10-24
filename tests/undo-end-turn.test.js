// 撤销「结束回合」后再结束回合，回合数跳一号（#340 第 3 条）。
// 原因：撤销快照不带规则层的日志（game.js · saveState 的 SKIP_KEYS 里有 logPages：战斗记录不删），
// 可 app.js · startLogTurn 按最后一页日志的回合号 +1 算下一回合——撤销后回合数回到 1，第 2 回合那一页还在，再结束回合就成了第 3 回合，
// 速杀奖励、援军、招式疲劳、首领倒计时跟着错位。
// 现在撤销时把那之后新开的回合页并回撤销后的这一页（game.js · undoRules → foldLogPages），记录一行不删。
// 规则在 Node 里跑（tests/headless.js）；撤销用 game.js 自己的：记快照的 pushUndo 从源码抠出来原样跑，撤销走 battle.undo 指令（game.js · undoRules）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");

const GAME_JS = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
function fnSrc(src, name) {
  const at = src.indexOf("function " + name + "(");
  assert.ok(at >= 0, "game.js 里有 " + name);
  let i = src.indexOf("{", at), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  return src.slice(at, i + 1);
}

/** 规则环境 + 战斗画面（game.js；没有网页，只用它的撤销）。pushUndo：game.js 记快照的那一段，连同它用到的 saveState / deepClone / undoLimit */
function load(seed) {
  const c = H.load();
  c.document = { readyState: "loading", addEventListener() {}, getElementById() { return null; } };
  vm.runInContext(GAME_JS, c, { filename: "game.js" });
  const skip = GAME_JS.match(/const SKIP_KEYS = \[[^\]]*\];/)[0];
  const pushUndo = vm.runInContext(`(() => { const G = GAME; const hotseat = () => false; ${skip}
    ${fnSrc(GAME_JS, "deepClone")} ${fnSrc(GAME_JS, "saveState")} ${fnSrc(GAME_JS, "undoLimit")} ${fnSrc(GAME_JS, "pushUndo")}
    return pushUndo; })()`, c, { filename: "game.js（抠出来的 pushUndo）" });
  c.BattleSim.setup({ party: ["tou", "kolt"], enemies: [{ id: "thug_knife", lv: 5, zone: 2 }], seed: seed || "UNDO-END-TURN" });
  const S = c.S.state;
  // 几个回合里谁都不会倒下
  S.units.forEach(u => u.layers.forEach(l => { l.current = l.max = 999; }));
  const D = (cmd) => c.Commands.dispatch(cmd);
  const drain = () => { for (let g = 0; g < 50 && S.blockQueue && S.blockQueue.length; g++) c.finishBlock(null); };
  return {
    c, S, D, pushUndo,
    /** 照 game.js · endTurn：先记快照，再结束玩家回合（按回合号的种子）、敌人回合结束 → 下一回合开始 */
    endTurn() { pushUndo(`结束第 ${S.turnNo} 回合`); D({ type: "endTurn", seed: `end:${S.turnNo}` }); drain(); D({ type: "battle.endEnemyTurn" }); drain(); },
    undo: () => D({ type: "battle.undo" }),
    // 规则环境里的数组换成这边的（deepEqual 才比得了）
    turns: () => Array.from(S.logPages, p => p.turn),
    lines: () => Array.from(S.logPages.flatMap(p => p.lines), l => l.text)
  };
}

test("撤销「结束回合」再结束回合：还是第 2 回合（以前跳成第 3 回合），日志页也只到第 2 回合", () => {
  const f = load();
  f.c.startCombat();
  assert.equal(f.S.turnNo, 1);
  f.endTurn();
  assert.equal(f.S.turnNo, 2);
  assert.deepEqual(f.turns(), [0, 1, 2]);
  assert.equal(f.undo().label, "结束第 1 回合");
  assert.equal(f.S.turnNo, 1, "撤销后回到第 1 回合");
  f.endTurn();
  assert.equal(f.S.turnNo, 2, "再结束回合是第 2 回合");
  assert.deepEqual(f.turns(), [0, 1, 2], "没有第 3 回合那一页");
  assert.equal(f.S.logIndex, f.S.logPages.length - 1);
  assert.equal(f.S.logPages[f.S.logIndex].lines[0].text, "—— 第 2 回合开始 ——");
  f.endTurn();
  assert.equal(f.S.turnNo, 3, "之后照常一回合加一");
});

test("撤销以后记录一行不删：结束回合之后记的几行并回第 1 回合那一页，接着往这一页记", () => {
  const f = load();
  f.c.startCombat();
  f.endTurn();
  const before = f.lines();
  assert.ok(before.includes("—— 第 2 回合开始 ——"));
  f.undo();
  assert.deepEqual(f.lines(), before, "撤销不删记录（README：战斗记录不删）");
  assert.deepEqual(f.turns(), [0, 1], "第 2 回合那一页并回了第 1 回合");
  assert.equal(f.S.logIndex, 1, "日志停在第 1 回合那一页");
  f.c.appendLog("撤销后的新一行");
  assert.equal(f.S.logPages[1].lines.slice(-1)[0].text, "撤销后的新一行", "撤销后接着往第 1 回合那一页记");
  assert.equal(f.S.logPages.length, 2);
});

test("回合数对了，跟着回合数走的规则也对：第 2 回合打完拿速杀 ×1.5（以前按第 3 回合算成 ×1.2）", () => {
  const f = load();
  f.c.startCombat();
  f.endTurn();
  f.undo();
  f.endTurn();
  f.S.units.filter(u => !u.isPlayer).forEach(u => { u.dead = true; u.layers.forEach(l => { l.current = 0; }); });
  assert.equal(f.c.applyFinishBonus().speedMult, 1.5);
});

test("跑团连撤几步：撤两次「结束回合」再结束回合，回合数、日志页都对", () => {
  const f = load("UNDO-END-TURN-TRPG");
  f.c.S.TRPG.active = true;   // 跑团模式最多撤 10 步（game.js · undoLimit）
  f.c.startCombat();
  f.endTurn(); f.endTurn();
  assert.equal(f.S.turnNo, 3);
  const before = f.lines();
  assert.equal(f.undo().label, "结束第 2 回合");
  assert.equal(f.undo().label, "结束第 1 回合");
  assert.equal(f.S.turnNo, 1);
  assert.deepEqual(f.turns(), [0, 1]);
  assert.deepEqual(f.lines(), before, "撤两步也一行不删");
  f.endTurn();
  assert.equal(f.S.turnNo, 2, "再结束回合是第 2 回合（以前跳成第 4 回合）");
  f.endTurn();
  assert.equal(f.S.turnNo, 3);
  assert.deepEqual(f.turns(), [0, 1, 2, 3]);
});

test("撤销「开始战斗」再开战：第 1 回合，日志页不多出一页「开战前」", () => {
  const f = load("UNDO-START");
  f.pushUndo("开始战斗");
  f.c.startCombat();
  assert.deepEqual(f.turns(), [0, 1]);
  assert.equal(f.undo().label, "开始战斗");
  assert.equal(f.S.combatStarted, false);
  assert.deepEqual(f.turns(), [0], "开战时新开的第 1 回合那一页并回开战前那一页");
  f.c.startCombat();
  assert.equal(f.S.turnNo, 1);
  assert.deepEqual(f.turns(), [0, 1]);
  f.endTurn();
  assert.equal(f.S.turnNo, 2);
});
