// #348：高能状态从施加的那一刻起，受到能量伤害就累积高能值（去掉「本回合刚被施加高能不累积」）；
// 不是打中的能量伤害（共振分享、衍射回传、激活高能、主持人环境伤害、检定失败受伤）也照打中 / 余波的口径累积：
// 只认带高能状态的单位、只认能量、真的扣到血才掷 1d4+1；加倍计量 ×2、微光 +1 照旧；先累积再判自爆，只炸一次
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./headless");

/** 同一区的狂徒 A、B（1 级，高能骰 1d4+1，血量 100 肉体）。骰子都掷最大（1d4 → 4，每次累积 +5） */
function field(opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: opt.party || ["kolt", "helu"], seed: "H348",
    enemies: [1, 2].map(() => ({ id: "thug_knife", lv: 1, zone: 1 })) });
  c.startCombat();
  const st = c.S.state;
  const [a, b] = st.units.filter(u => !u.isPlayer);
  [a, b].forEach(u => { u.zone = 1; u.layers = [{ type: "flesh", current: 100, max: 100 }]; });
  c.Math.random = () => 0.99;
  return { c, st, a, b };
}
const lines = st => st.logPages.flatMap(p => p.lines).map(l => l.text);
const has = (st, text) => lines(st).some(s => s.includes(text));
/** 日志里 u 的【高能自爆】一共几次 */
const booms = (st, u) => lines(st).join("\n").split(`【高能自爆】${u.name} `).length - 1;
const setHp = (u, hp) => { u.layers = [{ type: "flesh", current: hp, max: 100 }]; };
const high = (u, he) => { u.statuses.high = true; u.highEnergy = he; };

/** 打 A 一下能量伤害（action false：不判射程、不弹格挡），A 的共振把一半分给 B——分给 B 的那一下不是打中 */
const zap = (c, from, to, dmg, element) => c.dealTo(from, to, { atk: 0, mult: 0, flat: dmg, element: element || "energy", baseBreak: 0,
  flags: { action: false, environment: true, blockResolved: true, atkFx: [] } });
const env = (c, u, dmg, element) => c.dmDealEnv({ dmEnvScope: "pick", dmEnvZone: String(u.zone), dmEnvEle: element || "energy",
  dmEnvFlat: String(dmg), dmEnvBrk: "0", hits: [u.id] });

test("瑞比扳机刚挂上高能：同一回合受到能量伤害马上累积；日志说明不再写「本回合不累积」", () => {
  const { c, st, b } = field({ party: ["ruby", "kolt"] });
  const ruby = c.findKit("ruby", st.units);
  ruby.zone = 1; ruby.ap = 5;
  st.attackerId = ruby.id; st.targetId = b.id;
  c.runSkill("ruby_trigger");
  assert.equal(b.statuses.high, true, "扳机挂上高能");
  assert.ok(has(st, `${b.name} 被施加高能。从现在起受到的每段能量伤害各掷一次 1d4+1 累积高能值。`), lines(st).join("\n"));
  assert.ok(!lines(st).some(s => /不累积|从下回合起/.test(s)), lines(st).join("\n"));
  env(c, b, 10);
  assert.equal(c.totalHp(b), 90);
  assert.equal(b.highEnergy, 5, "同一回合就累积 1d4+1〔4+1〕");
  assert.ok(!("highApplyTurn" in b), "highApplyTurn 没有地方读了，不再记");
});

test("说明文字：规则文件、图鉴、技能说明里都没有「本回合受到的能量伤害不累积高能值」这类话", () => {
  for (const f of H.RULE_FILES.concat(["game.js", "unit-card.js", "unit-tip.js", "bestiary-ui.js", "hud-icons.js"])) {
    const file = path.join(H.ROOT, f);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /本回合[^\n]{0,30}不累积/, f);
    assert.doesNotMatch(src, /从下回合起每段能量伤害/, f);
    assert.doesNotMatch(src, /highApplyTurn|highFreshThisTurn/, f);
  }
  // 图鉴本来就写「每次受到能量伤害都会积攒」，和现在的规则一致
  const c = H.load();
  const card = c.S.CODEX_EFFECTS.find(e => e.name === "高能");
  assert.ok(card.lines.some(s => s.includes("每次受到能量伤害都会积攒")), JSON.stringify(card));
});

test("共振分享：能量伤害分给带高能的共振单位 → 累积；涨够了自爆（先累积再判）；分享的不是能量不累积", () => {
  {
    const { c, st, a, b } = field();
    const kolt = c.findKit("kolt", st.units);
    a.statuses.reso = true; b.statuses.reso = true; high(b, 3);
    const out = zap(c, kolt, a, 20);
    assert.equal(c.totalHp(a), 80);
    assert.equal(c.totalHp(b), 90, "共振分享一半 10 点能量");
    assert.equal(b.highEnergy, 8, "3 + 1d4+1〔4+1〕");
    assert.ok(out.extra.some(s => s.includes(`${b.name} 共振分享能量伤害 1d4+1〔4+1〕=5 → 高能值 8`)), out.extra.join("\n"));
  }
  {
    // 分享 10 打到剩 15：原来的高能值 12 不够炸，累积 +5 = 17 就炸，只炸一次
    const { c, st, a, b } = field();
    const kolt = c.findKit("kolt", st.units);
    a.statuses.reso = true; b.statuses.reso = true; high(b, 12); setHp(b, 25);
    zap(c, kolt, a, 20);
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 15`), lines(st).join("\n"));
    assert.equal(booms(st, b), 1);
    assert.equal(b.highEnergy, 0);
  }
  {
    const { c, st, a, b } = field();
    const kolt = c.findKit("kolt", st.units);
    a.statuses.reso = true; b.statuses.reso = true; high(b, 3);
    zap(c, kolt, a, 20, "fire");
    assert.ok(c.totalHp(b) < 100, "火焰照样分享");
    assert.equal(b.highEnergy, 3, "不是能量：不累积");
  }
});

test("衍射回传：能量攻击回传的那一下也累积（和打中各算一次）；回传打到线下时先累积再判，炸累积后的值", () => {
  {
    const { c, st, b } = field();
    const kolt = c.findKit("kolt", st.units);
    kolt.zone = 1;
    b.statuses.reso = true; high(b, 3);
    c.hangAtkFx(kolt, "diffract");
    const out = c.dealTo(kolt, b, { atk: 0, mult: 0, flat: 20, element: "energy", baseBreak: 0, flags: { action: true } });
    assert.equal(c.totalHp(b), 70, "打中 20 + 回传 10");
    assert.equal(b.highEnergy, 13, "回传 +5、打中 +5");
    assert.ok(out.extra.some(s => s.includes(`${b.name} 衍射回传能量伤害 1d4+1〔4+1〕=5 → 高能值 8`)), out.extra.join("\n"));
  }
  {
    // 打中 20 剩 20（高能值 12 不炸），回传 10 剩 10：先累积到 17 再判，炸 17（不是 12），只炸一次
    const { c, st, b } = field();
    const kolt = c.findKit("kolt", st.units);
    kolt.zone = 1;
    b.statuses.reso = true; high(b, 12); setHp(b, 40);
    c.hangAtkFx(kolt, "diffract");
    c.dealTo(kolt, b, { atk: 0, mult: 0, flat: 20, element: "energy", baseBreak: 0, flags: { action: true } });
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 10`), lines(st).join("\n"));
    assert.ok(!has(st, `【高能自爆】${b.name} 高能值 12`), "没有先拿旧的高能值炸");
    assert.equal(booms(st, b), 1);
  }
});

test("激活高能：按高能值打自己一下能量伤害，这一下也累积；涨了以后再判自爆", () => {
  {
    const { c, st, b } = field();
    high(b, 10);
    const notes = c.triggerOneStatus(b, c.findKit("kolt", st.units), "high");
    assert.equal(c.totalHp(b), 90, "激活打 10");
    assert.equal(b.highEnergy, 15, "10 + 1d4+1〔4+1〕");
    assert.ok(notes.some(s => s.includes(`${b.name} 激活高能的能量伤害 1d4+1〔4+1〕=5 → 高能值 15`)), notes.join("\n"));
    assert.equal(booms(st, b), 0, "血量 90 高于 15：不炸");
  }
  {
    // 22 血挨 10 剩 12：原来的 10 不够炸，累积到 15 就炸
    const { c, st, b } = field();
    high(b, 10); setHp(b, 22);
    c.triggerOneStatus(b, c.findKit("kolt", st.units), "high");
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 15 ≥ 当前生命 12`), lines(st).join("\n"));
    assert.equal(booms(st, b), 1, "只炸一次");
  }
  {
    // 激活本身就把血量打到原来的高能值以下：也是先累积再炸（炸 15，不是 10）
    const { c, st, b } = field();
    high(b, 10); setHp(b, 15);
    c.triggerOneStatus(b, c.findKit("kolt", st.units), "high");
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 15 ≥ 当前生命 5`), lines(st).join("\n"));
    assert.ok(!has(st, `【高能自爆】${b.name} 高能值 10`), "没有先拿旧的高能值炸");
    assert.equal(booms(st, b), 1, "只炸一次");
  }
  {
    // 激活直接打死：照样带着累积后的高能值自爆一次，击杀只结算一次
    const { c, st, b } = field();
    high(b, 10); setHp(b, 8);
    c.triggerOneStatus(b, c.findKit("kolt", st.units), "high");
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 15 ≥ 当前生命 0`), lines(st).join("\n"));
    assert.equal(booms(st, b), 1);
    assert.equal(b._xpGiven, true);
  }
  {
    // 加倍计量：激活伤害 ×2、累积也 ×2
    const { c, st, b } = field();
    high(b, 10); b.instant.doubleStatus = true;
    c.triggerOneStatus(b, c.findKit("kolt", st.units), "high");
    assert.equal(c.totalHp(b), 80);
    assert.equal(b.highEnergy, 20, "10 + (4+1) ×2");
  }
});

test("激活高能走职责技能（行动里）：先累积，行动结束统一判，只炸一次", () => {
  const { c, st, b } = field({ party: ["nora", "kolt"] });
  const nora = c.findKit("nora", st.units);
  high(b, 10); setHp(b, 22);
  st.attackerId = nora.id; st.targetId = b.id;
  st.skillFlow = { id: "role_activate", actorId: nora.id, picks: { target: b.id, status: "high" }, index: 99 };
  try { c.runSkill("role_activate"); } finally { st.skillFlow = null; }
  const log = lines(st).join("\n");
  const gain = log.indexOf(`${b.name} 激活高能的能量伤害 1d4+1〔4+1〕=5 → 高能值 15`);
  const boom = log.indexOf(`【高能自爆】${b.name} 高能值 15 ≥ 当前生命 12`);
  assert.ok(gain >= 0 && boom > gain, log);
  assert.equal(booms(st, b), 1);
  assert.equal(b.highEnergy, 0);
  assert.equal(b.statuses.high, false);
});

test("主持人环境伤害选能量（环境伤害 / 安排攻击里的环境伤害）：带高能的单位累积；涨够了自爆；别的属性不累积", () => {
  {
    const { c, st, b } = field();
    high(b, 3);
    env(c, b, 10);
    assert.equal(c.totalHp(b), 90);
    assert.equal(b.highEnergy, 8);
    assert.ok(has(st, `${b.name} 环境能量伤害 1d4+1〔4+1〕=5 → 高能值 8`), lines(st).join("\n"));
  }
  {
    const { c, b } = field();
    high(b, 3);
    c.dmDealAttack({ dmAtk: "__env", dmTgt: b.id, dmEle: "energy", dmFlat: 10, dmMult: 0, dmBrk: 0, dmSkipBlock: true, hits: [] });
    assert.equal(c.totalHp(b), 90);
    assert.equal(b.highEnergy, 8);
  }
  {
    const { c, st, b } = field();
    high(b, 12); setHp(b, 25);
    env(c, b, 10);
    assert.ok(has(st, `【高能自爆】${b.name} 高能值 17 ≥ 当前生命 15`), lines(st).join("\n"));
    assert.equal(booms(st, b), 1);
  }
  {
    const { c, b } = field();
    high(b, 3);
    env(c, b, 10, "fire");
    assert.equal(b.highEnergy, 3, "火焰：不累积");
  }
  {
    // 没有高能状态的（蓄能）：不涨，也不会被挂上高能
    const { c, b } = field();
    b.self = "store"; b.highEnergy = 5;
    env(c, b, 10);
    assert.equal(b.highEnergy, 5);
    assert.equal(b.statuses.high, false);
  }
  {
    // 微光：能量伤害 +25%，累积时 +1
    const { c, b } = field();
    c.setWeather("glow", { force: true });
    high(b, 0);
    env(c, b, 10);
    assert.ok(c.totalHp(b) < 90, "微光能量伤害 +25%");
    assert.equal(b.highEnergy, 6, "4+1+1");
  }
});

/** 跑团单局的检定失败（rogue.js · injureHero）：属性固定成能量，一直试到失败。
 *  战斗外的人身上本来不带高能（每次检定都摆一个新场地），这里在摆场地之后给他挂上，验证这一下能量伤害也走累积 */
function failCheckWithHigh(he) {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["kolt", "helu"], seed: "H348R" });
  c.Rogue.acceptTask(run, "main");
  const h = run.party[0];
  c.S.ROGUE_CHECKS.elements = ["energy"];
  let unit = null;
  const setup0 = c.BattleSim.setup;
  c.BattleSim.setup = function () {
    const out = setup0.apply(this, arguments);
    unit = c.findKit(h.kit, c.S.state.units);
    if (unit) high(unit, he);
    c.Math.random = () => 0.99;   // 累积的骰子掷最大（伤害数值照旧由检定的种子决定）
    return out;
  };
  for (let i = 0; i < 60; i++) {
    run.taskNo = 2000 + i; run.stage = "task"; run.task.index = 0;
    run.task.nodes = [{ type: "check", done: false, check: { diff: "extreme", prof: "运动", injure: true, reward: 3500 } },
      { type: "battle", done: false }];
    h.hp = null; delete h.pendingBreaks;
    c.S.LEDGER.hours = 0;
    unit = null;
    const notes = c.Rogue.attemptCheck(run, h.kit).join("\n");
    const m = notes.match(/受伤：能量属性 (\d+) 点，实际损失 (\d+) 点生命/);
    if (m) return { c, h, unit, notes, amount: Number(m[1]), lost: Number(m[2]) };
  }
  throw new Error("60 次都没有失败");
}

test("检定失败受伤随机到能量：带高能的单位累积；涨够了自爆（照旧不致死，留 1 点）", () => {
  {
    const { unit, amount, lost, notes } = failCheckWithHigh(3);
    assert.ok(amount >= 5 && amount <= 8 && lost === amount, notes);
    assert.equal(unit.highEnergy, 8, "3 + 1d4+1〔4+1〕");
  }
  {
    // 柯尔特 20 血，挨 5–8 剩 12–15：原来的 11 不够炸，累积到 16 就炸
    const { c, h, unit, notes } = failCheckWithHigh(11);
    assert.ok(lines(c.S.state).some(s => s.includes(`【高能自爆】${unit.name} 高能值 16`)), lines(c.S.state).join("\n"));
    assert.equal(booms(c.S.state, unit), 1);
    assert.equal(unit.highEnergy, 0);
    assert.match(notes, /（剩 1）/, "检定失败不致死");
    assert.ok(h.hp.some(l => l.current === 1), JSON.stringify(h.hp));
  }
});
