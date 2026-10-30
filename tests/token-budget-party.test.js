// 4 人队 + 敌人等级 ≥ 10 时普通战代币基线 5（否则 4）；5% 上滚仍 +1；单位上限仍生效
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const H = require("./headless");

const get = (c, expr) => vm.runInContext(expr, c);
const plain = (x) => JSON.parse(JSON.stringify(x));

/** 强制下一次 Math.random 返回 v，之后恢复（用来钉死 5% 上滚） */
function withRandom(c, values, fn) {
  const seq = values.slice();
  const orig = c.Math.random;
  c.Math.random = () => (seq.length ? seq.shift() : 0.99);
  try { return fn(); } finally { c.Math.random = orig; }
}

function fresh(party, seed) {
  const c = H.load();
  const run = c.Rogue.newRun({ party, seed });
  return { c, run, R: c.Rogue };
}

test("encounterTokenBudget / ENCOUNTER_TOKEN_RULES：4p L10 → 5，4p L9 → 4，3p L20 → 4，缺省 → 4", () => {
  const c = H.load();
  const budget = get(c, "encounterTokenBudget");
  assert.equal(typeof budget, "function", "必须有命名函数 encounterTokenBudget（旧代码没有）");
  const rules = get(c, "ENCOUNTER_TOKEN_RULES");
  assert.ok(Array.isArray(rules) && rules.length >= 1, "必须有 ENCOUNTER_TOKEN_RULES 配置表");
  assert.equal(rules[0].partySize, 4);
  assert.equal(rules[0].minLevel, 10);
  assert.equal(rules[0].tokens, 5);
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
});

test("rollEncounter：4p L10 基线 5；4p L9 / 3p L20 基线 4（钉死不上滚）", () => {
  const c = H.load();
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
  const rollExtra = (opt) => withRandom(c, [0.01, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5], () =>
    c.rollEncounter(Object.assign({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2 }, opt)));

  const low = rollExtra({ partySize: 2, level: 5 });
  assert.equal(low.tokens, 5, "普通基线 4 + 上滚 = 5");
  assert.equal(low.extraToken, true);

  const hi = rollExtra({ partySize: 4, level: 10 });
  assert.equal(hi.tokens, 6, "4p L10 基线 5 + 上滚 = 6");
  assert.equal(hi.extraToken, true);

  const fixed = withRandom(c, [0.01, 0.01, 0.01], () =>
    c.rollEncounter({ region: "外城区", faction: "盗匪", mixed: false, zoneMode: 2, tokens: 4, partySize: 4, level: 20 }));
  assert.equal(fixed.tokens, 4);
  assert.equal(!!fixed.extraToken, false);
});

test("单位上限：6 枚代币也受 ENCOUNTER_UNIT_CAP=12（成组杂兵装不下就停 / 改抽）", () => {
  const c = H.load();
  const cap = get(c, "ENCOUNTER_UNIT_CAP");
  assert.equal(cap, 12);
  c.S.RNG.install("BUDGET-CAP-SWEEP");
  const only = c.pickByTokens(["sewer_sweeper"], 6);
  const units = only.reduce((n, e) => n + Math.max(1, Number(e.count) || 1), 0);
  assert.ok(units <= 12, `6 枚清扫机仍 ≤12：${units} ${JSON.stringify(only)}`);
  assert.equal(units, 12);
  assert.equal(only.length, 4, "第 5、6 枚装不下");

  for (let i = 0; i < 80; i++) {
    c.S.RNG.install("BUDGET-CAP-ENC-" + i);
    const enc = c.rollEncounter({
      region: "下水道", faction: "下水道维护", mixed: false, zoneMode: 2, tokens: 6
    });
    const u = (enc.enemies || []).reduce((n, e) => n + Math.max(1, Number(e.count) || 1), 0);
    assert.ok(u <= cap, `下水道 6 枚 #${i}: ${u} ${JSON.stringify(enc.enemies)}`);
  }
});

test("面板 dispatch：4p L10 → 5；level null 不抛；缺 partySize 用 liveHeroCount 且不改缩放", () => {
  const c = H.load();
  c.BattleSim.setup({
    party: ["ruby", "kolt", "hiaki", "tou"],
    enemies: [{ id: "thug_knife", lv: 1, zone: 2 }],
    seed: "TB-PANEL"
  });
  assert.equal(c.liveHeroCount(), 4);

  // level: undefined 会撞 commands.js 严格 JSON；level: null 必须能过
  assert.throws(
    () => c.dispatch({ type: "battle.panel", action: "rollEncounter", region: "外城区", faction: null, partySize: 4, level: undefined }),
    /JSON/
  );
  const okNull = withRandom(c, [0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5], () =>
    c.dispatch({ type: "battle.panel", action: "rollEncounter", region: "外城区", faction: "盗匪", partySize: 4, level: null }).value);
  assert.equal(okNull.tokens, 4, "level null → 不按 L10+ 基线");

  const hi = withRandom(c, [0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5], () =>
    c.dispatch({ type: "battle.panel", action: "rollEncounter", region: "外城区", faction: "盗匪", partySize: 4, level: 10 }).value);
  assert.equal(hi.tokens, 5, "面板显式 4p L10 → 5");

  // 缺 partySize：按场上英雄数；故意把缩放人数设成 2，兜底不得调用 syncPartySizeFromField
  c.S.state.partySize = 2;
  if (c.GAME) c.GAME.partySize = 2;
  const beforePs = c.S.state.partySize;
  const fromField = withRandom(c, [0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5], () =>
    c.dispatch({ type: "battle.panel", action: "rollEncounter", region: "外城区", faction: "盗匪", level: 10 }).value);
  assert.equal(c.S.state.partySize, beforePs, "兜底不得改 state.partySize");
  assert.equal(fromField.tokens, 5, "场上 4 英雄 → 基线 5");

  // 源码：game.js 用 liveHeroCount / || null，不用 state.partySize / undefined
  const gsrc = fs.readFileSync(path.join(H.ROOT, "game.js"), "utf8");
  assert.match(gsrc, /action:\s*"rollEncounter"[\s\S]{0,600}liveHeroCount/, "game.js 掷遭遇用 liveHeroCount");
  assert.match(gsrc, /action:\s*"rollEncounter"[\s\S]{0,600}\|\|\s*null/, "game.js level 兜底用 null");
  assert.doesNotMatch(gsrc, /action:\s*"rollEncounter"[\s\S]{0,600}state\.partySize/, "game.js 不用 state.partySize 当人数");
  assert.match(gsrc, /spec\.tokens/, "encSummary 按 spec.tokens 显示");
  assert.doesNotMatch(gsrc, /["']\s*·\s*五代币["']/, "不再写死「· 五代币」标签");
  const bsrc = fs.readFileSync(path.join(H.ROOT, "battle-commands.js"), "utf8");
  assert.match(bsrc, /case\s+"rollEncounter"[\s\S]*?liveHeroCount/, "battle-commands 兜底用 liveHeroCount");
  assert.doesNotMatch(bsrc, /case\s+"rollEncounter"[\s\S]*?syncPartySizeFromField\s*\(/, "rollEncounter 兜底不调 syncPartySizeFromField");
});

test("Rogue.battleSpec：4p 普通 L10+ → 5；3p 普通 → 4；4p 精英仍精英预算；4p L8 → 4", () => {
  // actLevels: [[1,4],[5,8],[9,12],[12,15]]；actDay=8 取本幕上限
  function atBattle(party, seed, act, actDay, nodeType) {
    const { c, run, R } = fresh(party, seed);
    R.acceptTask(run, "main");
    run.act = act;
    run.actDay = actDay;
    run.task.nodes[run.task.index] = { type: nodeType, done: false };
    const spec = R.battleSpec(run);
    assert.ok(spec && spec.encounter, "有遭遇");
    return { c, run, R, spec };
  }

  const four = ["kolt", "helu", "ruby", "tou"];
  const three = ["kolt", "helu", "ruby"];

  // 4p · 第 3 幕末日 → 敌人 Lv12 ≥ 10 → 基线 5（种子决定是否上滚到 6）
  const a = atBattle(four, "TB-4P-L12", 3, 8, "battle");
  assert.ok(a.spec.level >= 10, "敌人等级 ≥ 10：" + a.spec.level);
  assert.ok([5, 6].includes(a.spec.encounter.tokens), "4p 普通 L10+ 代币 5 或 6：" + a.spec.encounter.tokens);
  assert.equal(a.spec.encounter.tokens === 6, !!a.spec.encounter.extraToken);

  // 多多种子钉死「多数是 5、偶有 6」，且绝不是 4
  let saw5 = 0, saw6 = 0;
  for (let i = 0; i < 40; i++) {
    const x = atBattle(four, "TB-4P-MANY-" + i, 3, 8, "battle");
    assert.ok([5, 6].includes(x.spec.encounter.tokens), x.spec.encounter.tokens);
    if (x.spec.encounter.tokens === 5) saw5++;
    else saw6++;
  }
  assert.ok(saw5 >= 30, "多数种子基线 5（不上滚）：" + saw5);
  assert.ok(saw6 >= 1 && saw6 <= 10, "约 5% 上滚到 6：" + saw6);

  // 3p · 同级 → 仍 4（或上滚 5）
  const b = atBattle(three, "TB-3P-L12", 3, 8, "battle");
  assert.ok(b.spec.level >= 10, b.spec.level);
  assert.ok([4, 5].includes(b.spec.encounter.tokens), "3p 普通仍基线 4：" + b.spec.encounter.tokens);
  let saw4 = 0;
  for (let i = 0; i < 30; i++) {
    const x = atBattle(three, "TB-3P-MANY-" + i, 3, 8, "battle");
    assert.ok([4, 5].includes(x.spec.encounter.tokens));
    if (x.spec.encounter.tokens === 4) saw4++;
  }
  assert.ok(saw4 >= 20, "3p 多数是 4：" + saw4);

  // 4p · 精英战：写死 NODE.elite.tokens（5），不走上滚、不看人数基线
  const eliteTok = get(H.load(), "ROGUE_NODE_TYPES.elite.tokens") || 5;
  const e = atBattle(four, "TB-4P-ELITE", 3, 8, "elite");
  assert.equal(e.spec.encounter.tokens, eliteTok, "精英战预算不变");
  assert.equal(!!e.spec.encounter.extraToken, false);
  for (let i = 0; i < 20; i++) {
    const x = atBattle(four, "TB-ELITE-" + i, 3, 8, "elite");
    assert.equal(x.spec.encounter.tokens, eliteTok);
  }

  // 4p · 第 2 幕末日 → 敌人 Lv8 < 10 → 基线 4
  const low = atBattle(four, "TB-4P-L8", 2, 8, "battle");
  assert.ok(low.spec.level <= 9, "敌人等级 < 10：" + low.spec.level);
  assert.equal(low.spec.level, 8);
  assert.ok([4, 5].includes(low.spec.encounter.tokens), "4p L8 基线 4：" + low.spec.encounter.tokens);
  let low4 = 0;
  for (let i = 0; i < 30; i++) {
    const x = atBattle(four, "TB-4P-L8-" + i, 2, 8, "battle");
    assert.equal(x.spec.level, 8);
    assert.ok([4, 5].includes(x.spec.encounter.tokens));
    if (x.spec.encounter.tokens === 4) low4++;
  }
  assert.ok(low4 >= 20, "4p L8 多数是 4：" + low4);
});

test("README：代币制章节与规则改动记录整节按条目标题写了 4 人 L10+ 基线 5", () => {
  const md = fs.readFileSync(path.join(H.ROOT, "README.md"), "utf8");
  const rec = md.split("## 规则改动记录")[1] || "";
  // 整节按条目标题找，不 slice(0, 2500)
  const entryTitle = /4 人队且敌人等级\s*≥\s*10：普通战代币基线 5/;
  assert.match(rec, entryTitle, "规则改动记录有本条标题");
  const idx = rec.search(entryTitle);
  const entry = rec.slice(idx, idx + 2500);
  assert.match(entry, /ENCOUNTER_TOKEN_RULES|encounterTokenBudget/, "条目提到规则表 / 函数");
  assert.match(entry, /#425|PR\s*#425/, "条目引用模拟 PR #425");
  assert.match(entry, /未合并/, "标明 #425 未合并");
  const sec = md.split("### 2. 随机遭遇（代币制）")[1] || "";
  const body = sec.split("### 3.")[0] || "";
  assert.match(body, /4\s*人|四人/);
  assert.match(body, /10/);
  assert.match(body, /5\s*杂兵|1\s*精英\s*\+\s*3\s*杂兵|2\s*精英\s*\+\s*1\s*杂兵/);
});
