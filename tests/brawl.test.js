// 联机新玩法「争斗」第 1 步：规则和布置（#543，brawl.js）。固定等级段（Lv20 · 武器 10 级 / Lv10 · 武器 5 级）的 PvP：
// 选人数（两队一样，1v1 ~ 4v4）、角色（同一队里不能重复，两队之间可以）、每个角色的专长 / 属性加点 / 血量层改造（照单局 / 跑团升级和诊所的规则），
// 职责照角色自己的、熟练项不给，翻硬币定先手，然后照决斗的规则打（enemies.js · PVP_DUEL_CFG）。和存档无关（队伍档案、背包开局收起来，打完放回去）。
// 两队同一个角色：按 kit 找单位的地方改成按单位 id / 结算上下文找（party.js · findKit / withKitScope / weaponOwnerUnit），
// 武器耐久、长休次数分开记（ledger.js · ledgerKitKey）。AI 整队用 BattleSim.SKILL_POLICY（brawlPolicy）。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const H = require("./headless");
const plain = v => JSON.parse(JSON.stringify(v));
const run = (c, expr) => vm.runInContext(expr, c);
const logText = c => c.S.state.logPages.flatMap(p => p.lines).map(l => l.text).join("\n");

/** 照规则合法的一份养成（brawl.js · brawlSimEntry：每一级的被动专长、主属性加点、一半可换的肉体换成装甲），over 盖在上面 */
const entry = (c, kit, tier, over) => Object.assign(plain(c.brawlSimEntry(kit, tier)), over || {});
/** 布置一场争斗：a / b 是两队的 kit（或者写好的角色），opt.spec 盖在 spec 上；opt.first 定谁先手（包住翻硬币，和 tools/pvp-balance.js 一样） */
function brawl(a, b, opt = {}) {
  const c = H.load();
  const tier = opt.tier == null ? 1 : opt.tier;
  const side = list => list.map(x => (typeof x === "string" ? entry(c, x, tier) : x));
  if (opt.first) {
    const toss = c.pvpDuelToss;
    c.pvpDuelToss = () => { const keep = c.Math.random; c.Math.random = () => (opt.first === "1队" ? 0.1 : 0.9); try { return toss(); } finally { c.Math.random = keep; } };
  }
  if (opt.before) opt.before(c);
  const spec = Object.assign({ tier, size: a.length, teams: { "1队": side(a), "2队": side(b) }, seed: opt.seed || "BRAWL543" }, opt.spec || {});
  const out = c.brawlSetup(spec);
  const S = c.S.state;
  const team = t => S.pvpDuel.teams[t].map(id => c.unitById(id));
  return { c, S, out, spec, one: team("1队"), two: team("2队") };
}
/** 不合法的 spec：抛出写着原因的错误（re），什么都没布置、存档没被收起来 */
function rejects(make, re, msg) {
  const c = H.load();
  const spec = make(c);
  assert.throws(() => c.brawlSetup(spec), re, msg);
  assert.throws(() => c.Commands.dispatch(Object.assign({ type: "battle.brawl" }, spec)), re, msg + "（指令）");
  assert.equal(c.S.state.brawl == null, true, msg + "：没布置");
  assert.equal(c.brawlStashed(), false, msg + "：存档没被收起来");
}
/** 一下重击，直接结算（不等协助格挡） */
const smash = (c, a, t, dmg) => c.dealTo(a, t, { atk: 0, mult: 0, flat: dmg, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } });
const hp = u => (u.layers || []).reduce((s, l) => s + (Number(l.current) || 0), 0);

test("配置表：两个等级段（Lv20 · 武器 10 级、Lv10 · 武器 5 级）、每队 1–4 人、打开回合上限默认 10 回合、AI 不带道具；能选的角色是全部 11 张角色卡", () => {
  const c = H.load();
  const C = plain(run(c, "BRAWL_CFG"));
  assert.deepEqual(C.tiers.map(t => [t.level, t.weapon]), [[20, 10], [10, 5]]);
  assert.deepEqual([C.sizeMin, C.sizeMax, C.roundsDefault], [1, 4, 10]);
  assert.equal(C.ai.cfg.items, false);
  assert.deepEqual(Array.from(c.brawlHeroKits()).sort(), ["chuan", "helu", "hiaki", "kolt", "longge", "nora", "ras", "ruby", "tou", "xia", "yuito"]);
  assert.equal(c.S.state.brawl == null, true, "默认不是争斗");
  assert.equal(c.brawlOn(), false);
});

test("专长、属性的数量照 ROGUE_LEVEL_REWARDS 算：Lv20 是 7 / 11 / 13 / 16 级四项专长、4 / 8 / 19 级三点属性；Lv10 是 7 级一项、4 / 8 级两点；职责 5 / 10 / 15 级", () => {
  const c = H.load();
  const R = c.S.ROGUE_CONFIG && run(c, "ROGUE_LEVEL_REWARDS");
  const want = level => {
    const L = Object.keys(R).map(Number).filter(x => x <= level).sort((a, b) => a - b);
    return {
      feats: L.filter(x => R[x].some(r => r.type === "note" && r.key === "feat")),
      attrs: L.filter(x => R[x].some(r => r.type === "attr")),
      roles: L.filter(x => R[x].some(r => r.type === "role"))
    };
  };
  for (const level of [20, 10]) {
    const got = plain(c.brawlRewards(level));
    assert.deepEqual({ feats: got.feats, attrs: got.attrs.map(a => a.level), roles: got.roles }, want(level), level + " 级");
  }
  assert.deepEqual(plain(c.brawlRewards(20)).attrs, [{ level: 4, noRepeat: false }, { level: 8, noRepeat: true }, { level: 19, noRepeat: false }]);
  assert.deepEqual(plain(c.brawlRewards(10)).feats, [7]);
});

test("两个等级段造出来的角色：等级、所有武器（含唤出的武器人）的等级照等级段；职责照角色自己的那一条；熟练项只有角色卡自带的；没有待选的点、没有义体 / 改装件", () => {
  for (const tier of [0, 1]) {
    const { c, S, one, two } = brawl(["hiaki", "kolt"], ["nora", "ruby"], { tier, seed: "BRAWL543-T" + tier });
    const T = plain(run(c, "BRAWL_CFG")).tiers[tier];
    for (const u of one.concat(two)) {
      assert.equal(u.level, T.level, `${u.name} ${T.level} 级`);
      assert.ok(u.linkedKits.length >= 1);
      u.linkedKits.forEach(k => assert.equal(u.weaponLevels[k], T.weapon, `${u.name} 的 ${k} ${T.weapon} 级`));
      // 职责：每个里程碑只有一个选项，照它给
      const card = c.livePartyCards().find(x => x.kit === u.kit);
      [5, 10, 15].filter(m => m <= T.level).forEach(m => {
        const probe = c.spawnLiveCard(card, 1); probe.level = m; probe.rolePicks = Object.assign({}, u.rolePicks);
        const opts = plain(c.roleChoicesAt(probe, m));
        assert.equal(opts.length, 1, `${u.name} ${m} 级职责只有一个选项`);
        assert.deepEqual(plain(u.rolePicks[m]), opts[0], `${u.name} ${m} 级职责照角色自己的`);
      });
      assert.deepEqual(Object.keys(u.rolePicks).map(Number).sort((a, b) => a - b), [5, 10, 15].filter(m => m <= T.level));
      // 熟练项：不给（type: "prof" 那几级不选），只有角色卡自带的
      assert.equal(u.profs, undefined, `${u.name} 没有升级得的熟练项`);
      const own = (c.heroProfile(u.kit) || {}).profs || {};
      Object.keys(own).forEach(p => assert.equal(c.unitProfLevel(u, p), Math.min(3, own[p]), `${u.name} ${p} 照角色卡`));
      assert.equal(c.unitProfLevel(u, "数据操作"), Math.min(3, Number(own["数据操作"]) || 0));
      assert.deepEqual([u.featPoints, u.attrPoints, u.role2, (u.cyberware || []).length], [0, 0, null, 0]);
      assert.deepEqual(plain(u.weaponParts || {}), {});
      assert.equal(u.shp, u.shpMax, "满坚毅");
      assert.equal(hp(u), c.totalMaxHp(u), "满血");
    }
    // 唤出来的武器人也是这一级
    const hiaki = one[0], kolt = one[1];
    const niu = c.spawnWeapon(hiaki, "niu"), torque = c.spawnWeapon(kolt, "torque");
    assert.deepEqual([niu.level, torque.level], [T.weapon, T.weapon], "武器人等级照等级段");
    assert.equal(S.brawl.level, T.level);
  }
});

test("专长、属性照 spec 生效；多选 / 少选 / 不合法的选项被拒绝并写原因（层级不够、重复、已会的职责技能、探索专长、8 级属性重复、不认识的）", () => {
  // 生效：Lv20 柯尔特 蛮劲 / 冲阵 / 乘势 / 还魂、属性 力 / 体 / 力
  const ok = H.load();
  const card = ok.livePartyCards().find(x => x.kit === "kolt");
  const spec = t => ({ tier: 0, size: 1, teams: { "1队": [Object.assign(entry(ok, "kolt", 0), t)], "2队": [entry(ok, "tou", 0)] }, seed: "BRAWL543-F" });
  ok.brawlSetup(spec({ feats: ["brute", "charge", "momentum", "revive"], attrs: ["str", "con", "str"] }));
  const k = ok.S.state.units.find(u => u.kit === "kolt");
  assert.deepEqual(Array.from(k.feats), ["brute", "charge", "momentum", "revive"]);
  assert.deepEqual([k.attrs.str, k.attrs.con], [card.attrs.str + 2, card.attrs.con + 1], "属性照加点加上去");
  assert.deepEqual(Array.from(k.attrPicks), ["str", "con", "str"], "19 级那点可以加在加过的同一项上");
  // 拒绝
  const bad = (over, re, msg, tier = 0, kit = "kolt") => rejects(c2 => ({ tier, size: 1, teams: { "1队": [Object.assign(entry(c2, kit, tier), over)], "2队": [entry(c2, "tou", tier)] } }), re, msg);
  bad({ feats: ["tough", "charge", "momentum"] }, /专长要 4 项.*给了 3 项/, "Lv20 少选一项专长");
  bad({ feats: ["tough", "charge"] }, /专长要 1 项.*给了 2 项/, "Lv10 多选一项专长", 1);
  bad({ feats: ["charge"] }, /7 级不能选「冲阵」：要 11 级才能选/, "7 级选 11 级的专长", 1);
  bad({ feats: ["tough", "tough", "momentum", "revive"] }, /11 级不能选「硬骨头」：已经有了/, "不能重复的专长选两次");
  bad({ feats: ["whet"] }, /不能选「磨刀」：已经会这个职责技能了/, "瑞比本来就会直伤一（磨刀是直伤涉猎）", 1, "ruby");
  bad({ feats: ["sharpeye"] }, /探索专长只在跑团规则下提供/, "探索专长", 1);
  bad({ feats: ["nope"] }, /专长不认识：nope/, "不认识的专长", 1);
  bad({ feats: "tough" }, /专长要写成数组/, "专长不是数组", 1);
  bad({ feats: ["tough", "charge", "momentum", "dualclass"] }, /不能选「兼修」：没有可以升级的①–③职责涉猎专长/, "兼修的前提");
  bad({ attrs: ["str", "con"] }, /属性加点要 3 点.*给了 2 点/, "Lv20 少一点属性");
  bad({ attrs: ["str", "con", "dex"] }, /属性加点要 2 点.*给了 3 点/, "Lv10 多一点属性", 1);
  bad({ attrs: ["str", "str"] }, /8 级的属性加点不能加在之前加过的同一项上/, "8 级那点重复", 1);
  bad({ attrs: ["luck", "str"] }, /4 级的属性加点不认识：luck/, "不认识的属性", 1);
  bad({ profs: ["运动"] }, /不认识的字段 profs/, "熟练项不给（也不收）", 1);
  // 兼修：拿了要选一张升级（featFull），没拿不能给
  const dual = H.load();
  const e = Object.assign(entry(dual, "kolt", 0), { feats: ["cheer", "charge", "momentum", "dualclass"], featFull: ["cheer"] });
  dual.brawlSetup({ tier: 0, size: 1, teams: { "1队": [e], "2队": [entry(dual, "tou", 0)] }, seed: "BRAWL543-D" });
  assert.deepEqual(Array.from(dual.S.state.units.find(u => u.kit === "kolt").featFull), ["cheer"], "兼修把打气升成完整版");
  bad({ feats: ["cheer", "charge", "momentum", "dualclass"] }, /拿了兼修，要选 1 张/, "拿了兼修没选升级哪张");
  bad({ featFull: ["cheer"] }, /没有兼修，不能选兼修升级/, "没拿兼修");
});

test("血量层改造照 spec 生效（层的种类、上限照 cyberLayersFor），可换的肉体上限按选完属性以后的改造率算，超出、种类太多、格式不对被拒绝；可以全换成星灵；不收钱", () => {
  const c = H.load();
  const lv10 = (over, kit = "ras") => Object.assign(entry(c, kit, 1), { feats: ["wanderer"] }, over);   // 荒原行者：不改血量，层的上限好比对
  const chk = c.brawlCheck({ tier: 1, size: 1, teams: { "1队": [lv10({ attrs: ["int", "con"], cyberPlan: null })], "2队": [lv10({ attrs: ["con", "str"], cyberPlan: null })] } });
  const [smart] = chk.builds["1队"], [dull] = chk.builds["2队"];
  const card = c.livePartyCards().find(x => x.kit === "ras");
  const attrs = Object.assign({}, card.attrs, { int: card.attrs.int + 1, con: card.attrs.con + 1 });
  const flesh = c.derivedFromAttrs(attrs, 10).hp, rate = c.cyberRateOf(attrs, 10);
  assert.deepEqual([smart.fleshMax, smart.rate, smart.limit], [flesh, rate, c.cyberConvertLimit(flesh, rate)], "按选完属性以后的肉体上限、改造率");
  assert.ok(smart.rate > dull.rate, "加了智力，改造率高一些");
  // 生效：装甲 + 护盾，外到内照 cyberLayersFor
  const plan = { armor: 8, shield: Math.min(6, smart.limit - 8) };
  const { S, one } = brawl([lv10({ attrs: ["int", "con"], cyberPlan: plan })], [lv10({ attrs: ["con", "str"], cyberPlan: null })], { seed: "BRAWL543-C" });
  const ras = one[0];
  const want = plain(c.cyberLayersFor(flesh, Object.assign({ sand: 0, spirit: false }, plan)));
  assert.deepEqual(plain(ras.layers.map(l => [l.type, l.max])), want.map(l => [l.type, l.max]), "层的种类、上限");
  assert.deepEqual(plain(ras.layers.map(l => l.type)), ["shield", "armor", "flesh"]);
  assert.ok(ras.layers.every(l => l.current === l.max), "满的");
  assert.deepEqual(plain(ras.cyberPlan), { armor: 8, shield: plan.shield, sand: 0, spirit: false });
  assert.equal(S.kuizhi, 0, "不收钱（争斗用的是空的奎支，打完放回去）");
  // 刚好用满上限可以，多 1 点不行
  brawl([lv10({ attrs: ["int", "con"], cyberPlan: { armor: smart.limit } })], ["tou"]);
  const bad = (over, re, msg) => rejects(c2 => ({ tier: 1, size: 1, teams: { "1队": [Object.assign(entry(c2, "ras", 1), { feats: ["wanderer"], attrs: ["int", "con"] }, over)], "2队": [entry(c2, "tou", 1)] } }), re, msg);
  bad({ cyberPlan: { armor: smart.limit + 1 } }, new RegExp(`改造方案不合法：最多只能改造 ${smart.limit} 点肉体`), "超出可换的上限");
  bad({ attrs: ["con", "str"], cyberPlan: { armor: smart.limit } }, /最多只能改造/, "同样的量，没加智力就超了");
  bad({ cyberPlan: { armor: 2, shield: 2, sand: 2 } }, /一个角色最多 3 种血量/, "种类太多");
  bad({ cyberPlan: { armor: 2.5 } }, /改造量必须是非负整数/, "不是整数");
  bad({ cyberPlan: { armor: -1 } }, /改造量必须是非负整数/, "负数");
  bad({ cyberPlan: { armor: "8" } }, /改造量必须是非负整数/, "字符串");
  bad({ cyberPlan: { flesh: 4 } }, /改造方案不认识 flesh/, "不认识的层");
  bad({ cyberPlan: { spirit: "yes" } }, /spirit（换成星灵）只收 true \/ false/, "星灵不是布尔");
  bad({ cyberPlan: [8] }, /改造方案要写成/, "不是对象");
  // 全换成星灵（不受改造率限制）
  const sp = brawl([lv10({ attrs: ["int", "con"], cyberPlan: { spirit: true } })], ["tou"]).one[0];
  assert.deepEqual(plain(sp.layers.map(l => l.type)), ["spirit"]);
  assert.equal(sp.layers[0].max, plain(c.cyberLayersFor(flesh, { spirit: true }))[0].max);
});

test("人数、队伍：两队人数要一样（1–4）、同一队里角色不能重复（两队之间可以）、等级段 / 字段 / AI 设置不对都被拒绝", () => {
  const two = (c, kits) => kits.map(k => entry(c, k, 1));
  rejects(c => ({ tier: 1, size: 2, teams: { "1队": two(c, ["kolt", "tou"]), "2队": two(c, ["xia"]) } }), /两队人数要一样，每队 2 人：2 队给了 1 人/, "人数不一致");
  rejects(c => ({ tier: 1, size: 2, teams: { "1队": two(c, ["kolt", "kolt"]), "2队": two(c, ["xia", "tou"]) } }), /1 队里不能有两个柯尔特/, "队内重复");
  rejects(c => ({ tier: 1, size: 5, teams: { "1队": two(c, ["kolt", "tou", "xia", "ruby", "helu"]), "2队": two(c, ["kolt", "tou", "xia", "ruby", "helu"]) } }), /每队人数要 1–4，给了 5/, "5v5");
  rejects(c => ({ tier: 1, size: 0, teams: { "1队": [], "2队": [] } }), /每队人数要 1–4，给了 0/, "0v0");
  rejects(c => ({ tier: 2, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]) } }), /等级段只有 0（Lv20 · 武器 10 级）、1（Lv10 · 武器 5 级），给了 2/, "没有的等级段");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]), "3队": two(c, ["tou"]) } }), /没有这一队：3队/, "第三队");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": [{ kit: "mint", feats: ["tough"], attrs: ["str", "con"] }] } }), /没有这名角色：mint/, "武器不能当角色选");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]) }, first: "1队" }), /不认识的字段 first/, "不能自己定先手");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]) }, ai: { "1队": "yes" } }), /ai\.1队 只收 true \/ false/, "AI 只能整队（布尔）");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]) }, rounds: 0 }), /回合上限（rounds）只收 null 或 1–99/, "回合上限 0");
  rejects(c => ({ tier: 1, size: 1, teams: { "1队": two(c, ["kolt"]), "2队": two(c, ["xia"]) }, stand: "no" }), /允许起身（stand）只收 true \/ false/, "起身不是布尔");
  // 两队用同一个角色可以；4v4 也可以
  const { S, one, two: t2 } = brawl(["kolt", "tou", "xia", "ruby"], ["kolt", "tou", "xia", "ruby"]);
  assert.deepEqual([one.length, t2.length], [4, 4]);
  assert.equal(new Set(S.units.map(u => u.id)).size, S.units.length, "每个单位的 id 都不一样");
  assert.deepEqual(one.map(u => u.zone).concat(t2.map(u => u.zone)), [1, 1, 1, 1, 3, 3, 3, 3], "3 区制两头站");
});

test("两队用同一个角色能正常开打：伤害、协助格挡、倒地 / 再起不能落在对的人身上；武器人、耐久、刀头、引擎、纳米各是各的", () => {
  const { c, S, one: [k1, t1], two: [k2, t2] } = brawl(["kolt", "tou"], ["kolt", "tou"], { first: "1队" });
  c.startCombat();
  assert.equal(c.hostileTo(k1, k2), true, "两个柯尔特互相敌对");
  assert.equal(c.hostileTo(t2, k2), false);
  // 伤害：打 2 队的柯尔特（走到同一区），只有他掉血
  k1.zone = 3;
  const before = [k1, t1, k2, t2].map(hp);
  const hit = smash(c, k1, k2, 7);
  assert.ok(hp(k2) < before[2], "打中了：" + JSON.stringify(hit && hit.extra));
  assert.deepEqual([hp(k1), hp(t1), hp(t2)], [before[0], before[1], before[3]], "只有 2 队的柯尔特掉了血");
  // 协助格挡：打 2 队的柯尔特，能替他挡的只有 2 队的灯；挡下来扣的是 2 队那把年糕（灯的武器）的耐久
  k1.zone = 3; k2.zone = 3; t2.zone = 3; t1.zone = 3;
  t2.bonus = 1; t1.bonus = 1;
  c.dealTo(k1, k2, { atk: 10, mult: 1, element: "physical", baseBreak: 1, atkRange: "any", flags: { action: true } });
  const job = S.blockQueue[0];
  assert.ok(job && job.targetId === k2.id, "排进协助格挡");
  const helpers = Array.from(c.eligibleBlockers(k2, job), u => u.id);
  assert.ok(helpers.includes(t2.id) && !helpers.includes(t1.id) && !helpers.includes(k1.id), "只有 2 队的人能挡：" + helpers);
  const dur = (kit, who) => c.weaponDur(kit, who);
  const mochi1 = dur("mochi", t1), mochi2 = dur("mochi", t2);
  const k2hp = hp(k2);
  c.finishBlock(t2.id, { roll: 1, ok: true, chance: 100 });
  assert.equal(hp(k2), k2hp, "挡下来了");
  assert.deepEqual([dur("mochi", t1), dur("mochi", t2)], [mochi1, mochi2 - 1], "扣的是 2 队灯的耐久，1 队的没动");
  assert.ok(c.S.LEDGER.dur["mochi@2队"] != null && c.S.LEDGER.dur["mochi@1队"] != null, "两把分开记（kit@队伍）");
  // 武器人：两个柯尔特都能唤出扭矩，各是各的持有者；收回一把不影响另一把
  const w1 = c.spawnWeapon(k1, "torque"), w2 = c.spawnWeapon(k2, "torque");
  assert.ok(w1 && w2 && w1 !== w2, "两把扭矩都唤得出来");
  assert.deepEqual([c.weaponOwnerUnit(w1), c.weaponOwnerUnit(w2)], [k1, k2]);
  assert.deepEqual([c.pvpDuelTeamOf(w1), c.pvpDuelTeamOf(w2)], ["1队", "2队"]);
  assert.equal(c.hostileTo(w1, k2), true);
  assert.equal(c.heldWeaponKit(k1), null, "1 队的柯尔特手里没扭矩了");
  c.returnWeapon(w2);
  assert.equal(c.heldWeaponKit(k2), "torque", "2 队的收回来了");
  assert.equal(c.heldWeaponKit(k1), null, "1 队的那把还在场上");
  // 过度自信：扭矩打到的人被嘲讽，嘲讽的是这把扭矩的柯尔特
  c.dealTo(w1, t2, { atk: 5, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none", friendlyFire: true } });
  assert.equal(t2.tauntTo, k1.id, "嘲讽指向 1 队的柯尔特");
  // 刀头：2 队的柯尔特换刀头，1 队的不变
  const bit1 = (k1.resources || {}).bit || "drill";
  c.withKitScope(k2, () => c.swapKoltBit(k2, []));
  assert.equal((k1.resources || {}).bit || "drill", bit1, "1 队的刀头没变");
  assert.notEqual((k2.resources || {}).bit || "drill", bit1, "2 队的换了");
  // 倒地、再起不能：落在被打的那个人身上
  t1.zone = 1; k2.zone = 1;
  (k2.layers || []).forEach(l => { l.current = 1; });
  smash(c, t1, k2, 50);
  assert.equal(k2.dying, true, "2 队的柯尔特倒地");
  assert.equal(k1.dying, false, "1 队的柯尔特没事");
  k2.dying = false; k2.upOnShp = true; k2.shp = 2;
  smash(c, t1, k2, 50);
  assert.equal(k2.pvpOut, true, "2 队的柯尔特再起不能");
  assert.ok(!k1.pvpOut && !k1.dead && !k1._removed, "1 队的柯尔特还在");
  assert.deepEqual(Array.from(S.pvpDuel.out), [k2.id]);
  assert.equal(w1._removed, undefined, "1 队的扭矩没被一起带走");
  assert.equal(c.__errors.length, 0, c.__errors.join("\n"));
});

test("两队用同一个角色：资源、回合效果各是各的（夕夏的引擎 / 燃油、瑞比的纳米、诺拉的双相各抛一次），技能指令按出手的人结算", () => {
  const { c, S, one: [x1, r1, n1], two: [x2, r2, n2] } = brawl(["xia", "ruby", "nora"], ["xia", "ruby", "nora"], { first: "2队", tier: 0 });
  // 诺拉的双相：两个诺拉都抛过（以前只抛第一个）
  assert.ok(["gentle", "cruel"].includes(n1.resources.mood) && ["gentle", "cruel"].includes(n2.resources.mood));
  c.startCombat();
  // 拉响引擎：只点着出手的那个夕夏（2 队的那个；以前按 kit 找到的是 1 队那个）
  x2.ap = 2; x2.bonus = 2;
  c.Commands.dispatch({ type: "skill", actor: x2.id, skill: "xia_engine", target: null });
  assert.equal(!!x2.resources.engine, true, "2 队的夕夏引擎启动");
  assert.equal(!!x1.resources.engine, false, "1 队的没动");
  // 燃油（启动引擎+）：加在结算上下文那个夕夏身上
  const fuel1 = Number(x1.resources.fuel) || 0;
  c.withKitScope(x2, () => c.addFuel(2, "测试", []));
  assert.equal(Number(x1.resources.fuel) || 0, fuel1, "1 队夕夏的燃油没变");
  assert.ok((Number(x2.resources.fuel) || 0) >= 2, "2 队的夕夏拿到燃油");
  // 纳米：瑞比被高能自爆以外的规则加纳米时，加给结算上下文那一边的瑞比
  const nano1 = r1.resources.nano, nano2 = r2.resources.nano;
  c.withKitScope(r2, () => c.addNano(10));
  assert.deepEqual([r1.resources.nano, r2.resources.nano], [nano1, Math.min(100, nano2 + 10)]);
  // 高能自爆：每个瑞比的「纳米科技」都触发
  const n1a = r1.resources.nano, n2a = r2.resources.nano;
  x2.statuses.high = true; x2.highEnergy = 30; x2.zone = 2;
  c.explodeHigh(x2);
  assert.deepEqual([r1.resources.nano, r2.resources.nano], [Math.min(100, n1a + 40), Math.min(100, n2a + 40)], "两个瑞比都 +40");
  // 按 kit 找：没有上下文时和以前一样找第一个；有上下文找自己那一边的
  assert.equal(c.findKit("xia", S.units), x1);
  assert.equal(c.withKitScope(x2, () => c.findKit("xia", S.units)), x2);
  assert.equal(c.findKit("xia", S.units, n2), x2, "near：同一队的");
  assert.equal(c.__errors.length, 0, c.__errors.join("\n"));
});

test("翻硬币：全部选完就定先手（写进战斗记录），先手在我方回合、后手在敌人回合；开战时后手每人补偿 1 个附赠；起身 / 回合上限照决斗", () => {
  for (const first of ["1队", "2队"]) {
    const { c, S, out, one, two } = brawl(["kolt", "tou"], ["xia", "helu"], { first });
    assert.equal(S.pvpDuel.first, first, "布置完就翻了硬币");
    assert.equal(out.brawl.first, first);
    assert.equal(out.duel.first, first);
    assert.match(logText(c), new RegExp(`抛硬币：${first === "1队" ? "1 队" : "2 队"}先手`));
    const second = first === "1队" ? two : one, firstTeam = first === "1队" ? one : two;
    c.startCombat();
    assert.equal(S.pvpDuel.first, first, "开战时不再抛");
    assert.deepEqual(firstTeam.map(u => c.unitTurnPhase(u)), ["player", "player"], "先手在我方回合");
    assert.deepEqual(second.map(u => c.unitTurnPhase(u)), ["enemy", "enemy"], "后手在敌人回合");
    assert.deepEqual(second.map(u => u.bonus), [1, 1], "后手补偿 1 个附赠");
  }
  // 不允许起身、限定回合数
  const { c, S, one } = brawl(["kolt"], ["xia"], { spec: { stand: false, rounds: 3 } });
  assert.deepEqual([S.pvpDuel.stand, S.pvpDuel.rounds], [false, 3]);
  assert.equal(c.pvpDuelNoStand(one[0]), true);
  // 两队都不动（没有 AI、也没有给真人打法）：打满 3 回合按剩余血量百分比判，一样是平局
  const res = c.BattleSim.run({ maxRounds: 10, policy: c.brawlPolicy() });
  assert.deepEqual(plain(res.duel), { winner: null, draw: true, why: "rounds", pct: { "1队": 1, "2队": 1 } });
  // 默认：允许起身、不限回合
  const d = brawl(["kolt"], ["xia"]).S.pvpDuel;
  assert.deepEqual([d.stand, d.rounds], [true, null]);
});

test("AI 整队：标成 AI 的一队用 SKILL_POLICY 自己打完一整场（固定种子，同一场重跑结果一样）；不是 AI 的一队不归它管", () => {
  const once = () => {
    const { c, S } = brawl(["kolt"], ["hiaki"], { spec: { ai: { "1队": false, "2队": true } }, seed: "BRAWL543-AI" });
    assert.deepEqual(plain(S.brawl.ai), { "1队": false, "2队": true });
    const pol = c.brawlPolicy({ human: c.BattleSim.BASIC_POLICY });   // 1 队（真人）在测试里用普攻版代打
    const seen = new Set();
    const act = pol.ai.act;
    pol.ai.act = u => { seen.add(c.pvpDuelTeamOf(u)); return act(u); };
    const res = c.BattleSim.run({ maxRounds: 30, policy: pol });
    assert.ok(res.duel && (res.duel.winner || res.duel.draw), "分出了结果：" + JSON.stringify(res.duel));
    assert.ok(pol.stats.decisions > 0, "AI 想过");
    assert.deepEqual([...seen], ["2队"], "AI 只替 2 队行动");
    assert.equal(c.__errors.length, 0, c.__errors.join("\n"));
    assert.equal(c.brawlAiUnit(S.units.find(u => u.kit === "hiaki")), true);
    assert.equal(c.brawlAiUnit(S.units.find(u => u.kit === "kolt")), false);
    return plain({ duel: res.duel, rounds: res.rounds, actions: res.actions, log: logText(c) });
  };
  assert.deepEqual(once(), once(), "同一个种子结果一样");
});

test("两队用同一个角色，两队都是 AI：每个角色的镜像对局都能打完（不报错、没有人真的死亡）", () => {
  for (const kit of ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras", "longge"]) {
    const { c, S } = brawl([kit], [kit], { spec: { ai: { "1队": true, "2队": true }, rounds: 4 }, seed: "BRAWL543-MIRROR-" + kit });
    const res = c.BattleSim.run({ maxRounds: 8, policy: c.brawlPolicy() });
    assert.ok(res.duel, kit + "：分出了结果");
    assert.equal(c.__errors.length, 0, kit + "：" + c.__errors.slice(0, 3).join("\n"));
    assert.ok(!S.units.some(u => u.isPlayer && !c.isWeaponUnit(u) && u.dead && !u.pvpOut), kit + "：不致死");
  }
});

test("争斗和存档无关：开局把队伍档案、背包、奎支收起来（打的时候是空的），打完 / 开新的一场原样放回去；不给经验、掉落", () => {
  const { c, S } = brawl(["kolt"], ["xia"], {
    before: c0 => {
      c0.S.LEDGER.dur = { torque: 1, berniel: 2 }; c0.S.LEDGER.heroes = { kolt: { shp: 3 } }; c0.S.LEDGER.restOnce = { kolt: { rally: 1 } };
      c0.S.LEDGER.purse = { kolt: 99 }; c0.S.LEDGER.day = 7;
      c0.ensureBag(); c0.bagAdd("stim", 2); c0.S.state.kuizhi = 123;
    }
  });
  const fresh = H.load();
  assert.deepEqual(plain(c.S.LEDGER.dur), {}, "打的时候是一份空的档案");
  assert.equal(c.S.LEDGER.day, fresh.S.LEDGER.day);
  assert.deepEqual(plain(S.bag.items), [], "背包是空的（不带道具）");
  assert.equal(S.kuizhi, 0);
  assert.equal(c.brawlStashed(), true);
  const res = c.BattleSim.run({ maxRounds: 20, policy: Object.assign(c.brawlPolicy({ human: c.BattleSim.BASIC_POLICY })) });
  assert.ok(res.duel);
  const settle = c.Commands.dispatch({ type: "battle.finish", outcome: res.duel.draw ? "draw" : "win" });
  assert.deepEqual([settle.xpBonus, settle.ups.length, settle.drops], [0, 0, null], "不给经验、掉落");
  c.Commands.dispatch({ type: "battle.afterBattle" });
  assert.equal(c.brawlStashed(), false);
  assert.deepEqual(plain(c.S.LEDGER.dur), { torque: 1, berniel: 2 }, "耐久放回去");
  assert.deepEqual(plain(c.S.LEDGER.heroes), { kolt: { shp: 3 } });
  assert.deepEqual(plain(c.S.LEDGER.restOnce), { kolt: { rally: 1 } });
  assert.deepEqual([c.S.LEDGER.purse.kolt, c.S.LEDGER.day], [99, 7]);
  assert.equal(c.bagCount("stim"), 2, "背包放回去");
  assert.equal(c.S.state.kuizhi, 123, "奎支放回去");
  // 没打完就开新的一场：也放回去
  const again = brawl(["kolt"], ["xia"], { before: c0 => { c0.S.LEDGER.dur = { torque: 4 }; } });
  assert.deepEqual(plain(again.c.S.LEDGER.dur), {});
  again.c.BattleSim.setup({ party: ["kolt"], enemies: [] });
  assert.deepEqual(plain(again.c.S.LEDGER.dur), { torque: 4 }, "开新的一场时放回去");
  assert.equal(again.c.S.state.brawl, null);
});

test("指令 battle.brawl：和 brawlSetup 一样布置，返回公开部分（等级段、人数、AI、两队的角色、先手；不带养成细节和坚毅）", () => {
  const c = H.load();
  const spec = { tier: 1, size: 1, teams: { "1队": [entry(c, "xia", 1)], "2队": [entry(c, "xia", 1)] }, ai: { "2队": true }, seed: "BRAWL543-CMD" };
  const out = c.Commands.dispatch(Object.assign({ type: "battle.brawl" }, spec));
  const S = c.S.state;
  assert.deepEqual(Object.keys(out.brawl).sort(), ["ai", "first", "level", "size", "teams", "tier", "weapon"]);
  assert.deepEqual([out.brawl.level, out.brawl.weapon, out.brawl.size], [10, 5, 1]);
  assert.deepEqual(plain(out.brawl.ai), { "1队": false, "2队": true });
  assert.deepEqual(plain(out.brawl.teams["1队"].map(x => x.kit).concat(out.brawl.teams["2队"].map(x => x.kit))), ["xia", "xia"]);
  assert.ok(!/shp|attrs|feats|cyber/.test(JSON.stringify(out)), "公开部分不带坚毅、养成细节");
  assert.equal(S.pvpDuel.brawl, true);
  assert.match(logText(c), /争斗：Lv10 · 武器 5 级，1v1，2 队是 AI。/);
  assert.equal(c.__errors.length, 0, c.__errors.join("\n"));
});
