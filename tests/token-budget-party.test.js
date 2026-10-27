// 4 人队 + 敌人等级 ≥ 10 时普通战代币基线 5（否则 4）；5% 上滚仍 +1；单位上限仍生效
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const H = require("./headless");

const get = (c, expr) => vm.runInContext(expr, c);

/** 强制下一次 Math.random 返回 v，之后恢复（用来钉死 5% 上滚） */
function withRandom(c, values, fn) {
  const seq = values.slice();
  const orig = c.Math.random;
  c.Math.random = () => (seq.length ? seq.shift() : 0.99);
  try { return fn(); } finally { c.Math.random = orig; }
}

test("encounterTokenBudget：4p L10 → 5，4p L9 → 4，3p L20 → 4，缺省 → 4", () => {
  const c = H.load();
  const budget = get(c, "encounterTokenBudget");
  assert.equal(typeof budget, "function", "必须有命名函数 encounterTokenBudget（旧代码没有）");
  assert.equal(budget(4, 10), 5);
  assert.equal(budget(4, 11), 5);
  assert.equal(budget(4, 20), 5);
  assert.equal(budget(4, 9), 4);
  assert.equal(budget(4, 1), 4);
  assert.equal(budget(3, 20), 4);
  assert.equal(budget(3, 10), 4);
  assert.equal(budget(2, 15), 4);
  assert.equal(budget(1, 20), 4);
  assert.equal(budget(5, 20), 4, "不是恰好 4 人仍是 4");
  assert.equal(budget(undefined, 20), 4);
  assert.equal(budget(4, undefined), 4);
  assert.equal(budget(null, null), 4);
  assert.equal(get(c, "ENCOUNTER_TOKENS"), 4);
  assert.equal(get(c, "ENCOUNTER_TOKENS_4P_L10"), 5);
});

test("rollEncounter：4p L10 基线 5；4p L9 / 3p L20 基线 4（钉死不上滚）", () => {
  const c = H.load();
  // 第一个 random 给代币上滚（>0.05 → 不上滚），后面给混战 / 区制等
  const roll = (opt) => withRandom(c, [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5], () =>
    c.rollEncounter(Object.assign({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2 }, opt)));

  const a = roll({ partySize: 4, level: 10 });
  assert.equal(a.tokens, 5, "4p L10 基线 5");
  assert.equal(!!a.extraToken, false);

  const b = roll({ partySize: 4, level: 9 });
  assert.equal(b.tokens, 4, "4p L9 仍是 4");

  const d = roll({ partySize: 3, level: 20 });
  assert.equal(d.tokens, 4, "3p L20 仍是 4");

  const e = roll({ partySize: 4, level: 20 });
  assert.equal(e.tokens, 5, "4p L20 基线 5");
});

test("5% 上滚：基线 4 → 5；4p L10 基线 5 → 6（+1），显式 tokens 不上滚", () => {
  const c = H.load();
  // 第一个 random < 0.05 → 触发上滚
  const rollExtra = (opt) => withRandom(c, [0.01, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5], () =>
    c.rollEncounter(Object.assign({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2 }, opt)));

  const low = rollExtra({ partySize: 2, level: 5 });
  assert.equal(low.tokens, 5, "普通基线 4 + 上滚 = 5");
  assert.equal(low.extraToken, true);

  const hi = rollExtra({ partySize: 4, level: 10 });
  assert.equal(hi.tokens, 6, "4p L10 基线 5 + 上滚 = 6");
  assert.equal(hi.extraToken, true);

  // 显式 tokens：不掷上滚，也不看人数
  const fixed = withRandom(c, [0.01, 0.01, 0.01], () =>
    c.rollEncounter({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2, tokens: 4, partySize: 4, level: 20 }));
  assert.equal(fixed.tokens, 4);
  assert.equal(!!fixed.extraToken, false);
});

test("单位上限：6 枚代币也受 ENCOUNTER_UNIT_CAP=12（成组杂兵装不下就停 / 改抽）", () => {
  const c = H.load();
  const cap = get(c, "ENCOUNTER_UNIT_CAP");
  assert.equal(cap, 12);
  // 只有清扫机：6 枚也最多 12 只（4 组）——4p L10 上滚到 6 时同样走这套上限
  c.S.RNG.install("BUDGET-CAP-SWEEP");
  const only = c.pickByTokens(["sewer_sweeper"], 6);
  const units = only.reduce((n, e) => n + Math.max(1, Number(e.count) || 1), 0);
  assert.ok(units <= 12, `6 枚清扫机仍 ≤12：${units} ${JSON.stringify(only)}`);
  assert.equal(units, 12);
  assert.equal(only.length, 4, "第 5、6 枚装不下");

  // 显式 6 枚（等同 4p L10 + 5% 上滚）的下水道维护遭遇：场上单位 ≤12
  for (let i = 0; i < 80; i++) {
    c.S.RNG.install("BUDGET-CAP-ENC-" + i);
    const enc = c.rollEncounter({
      region: "下水道", faction: "下水道维护", mixed: false, zoneMode: 2, tokens: 6
    });
    const u = (enc.enemies || []).reduce((n, e) => n + Math.max(1, Number(e.count) || 1), 0);
    assert.ok(u <= cap, `下水道 6 枚 #${i}: ${u} ${JSON.stringify(enc.enemies)}`);
  }
});

test("战斗面板 / 联机 / 单局路径：rollEncounter 带上 partySize（和 level）", () => {
  const c = H.load();
  // 语义：传入 partySize+level 时基线生效（联机 / 同屏最终也是调 rollEncounter）
  const enc = withRandom(c, [0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5], () =>
    c.rollEncounter({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2, partySize: 4, level: 10 }));
  assert.equal(enc.tokens, 5);

  // 源码守卫：防止回归只传 region、忘了人数（game.js 不在 headless 加载列表里，必须读文件）
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(H.ROOT, "battle-commands.js"), "utf8");
  assert.match(src, /case\s+"rollEncounter"[\s\S]*?partySize/, "battle-commands rollEncounter 必须传 partySize");
  const gsrc = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(gsrc, /action:\s*"rollEncounter"[\s\S]{0,500}partySize/, "game.js 掷遭遇必须带 partySize");
  const rsrc = fs.readFileSync(path.join(H.ROOT, "rogue.js"), "utf8");
  assert.match(rsrc, /partySize:\s*run\.party\.length/, "rogue 普通战必须把队伍人数传进 rollEncounter");
  assert.match(rsrc, /level:\s*lvl/, "rogue 普通战必须把敌人等级传进 rollEncounter");
});

test("README：代币制章节与规则改动记录置顶写了 4 人 L10+ 基线 5", () => {
  const fs = require("fs");
  const path = require("path");
  const md = fs.readFileSync(path.join(H.ROOT, "README.md"), "utf8");
  const rec = md.split("## 规则改动记录")[1] || "";
  const top = rec.slice(0, 2500);
  assert.match(top, /4\s*人|四人/, "规则改动记录置顶提到 4 人队");
  assert.match(top, /≥\s*10|>=\s*10|等级\s*≥\s*10|敌人等级.*10/, "置顶提到等级 ≥ 10");
  assert.match(top, /encounterTokenBudget|代币基线|5\s*枚/, "置顶提到基线 / 函数名");
  assert.match(top, /#425|PR\s*#425/, "置顶引用模拟 PR #425");
  const sec = md.split("### 2. 随机遭遇（代币制）")[1] || "";
  const body = sec.slice(0, 1200);
  assert.match(body, /4\s*人|四人/);
  assert.match(body, /10/);
  assert.match(body, /5/);
});
