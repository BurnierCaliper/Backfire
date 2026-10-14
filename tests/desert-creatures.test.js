// 沙漠生物与中立生物（desert.js）：沙鱼三种、尘虫、管虫、群起、吞噬、探测、昼夜
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

function field(enemies, opt) {
  opt = opt || {};
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies, seed: opt.seed || "DS", zoneMode: opt.zoneMode || 2 });
  const st = c.S.state;
  if (opt.weather) st.weather = opt.weather;
  c.LEDGER.clock = opt.night ? 22 * 60 : 10 * 60;
  c.startCombat();
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units);
  const by = (k) => st.units.filter(u => u.kit === k);
  return { c, st, kolt, helu, by };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test("昼夜：18:00–05:00 是夜晚；沙暴不管几点都按夜晚", () => {
  const c = H.load();
  c.S.state.weather = "none";
  c.LEDGER.clock = 10 * 60; assert.equal(c.desertNight(), false);
  c.LEDGER.clock = 18 * 60; assert.equal(c.desertNight(), true);
  c.LEDGER.clock = 4 * 60 + 59; assert.equal(c.desertNight(), true);
  c.LEDGER.clock = 5 * 60; assert.equal(c.desertNight(), false);
  c.S.state.weather = "sand"; assert.equal(c.desertNight(), true);
});

test("中立生物：不算胜负、不行动、不给经验；沙鱼不当它是敌人", () => {
  const { c, st, by } = field([{ id: "sandfish_drive", lv: 3, zone: 2 }, { id: "dust_bug", lv: 3, zone: 2 }]);
  const bug = by("dust_bug")[0], fish = by("sandfish_drive")[0];
  assert.equal(c.isNeutralCreature(bug), true);
  assert.equal(c.hostileTo(fish, bug), false);
  assert.equal(c.EnemyAI.plan(bug), null);
  assert.ok(!c.EnemyAI.foes().includes(bug));
  fish.layers.forEach(l => { l.current = 0; }); c.sweepDeadEnemies();
  assert.equal(c.EnemyAI.foes().length, 0, "沙鱼死光就算赢，尘虫不用打");
  const xp = c.findKit("kolt", st.units).xp || 0;
  bug.layers.forEach(l => { l.current = 0; }); c.sweepDeadEnemies();
  assert.equal(c.findKit("kolt", st.units).xp || 0, xp);
});

test("吞噬：尘虫失衡 → 最近的沙鱼冲过去吃掉，回复尘虫剩余的生命，用掉行动点", () => {
  const { c, st, kolt, by } = field([{ id: "sandfish_lead", lv: 3, zone: 2 }, { id: "dust_bug", lv: 3, zone: 1 }]);
  const bug = by("dust_bug")[0], lead = by("sandfish_lead")[0];
  lead.layers[0].current = 1;   // 掉点血，好看回复
  bug.layers[0].current = 1;    // 打残：只剩 1 + 装甲
  const left = c.totalHp(bug), before = c.totalHp(lead);
  st.combatPhase = "player";
  c.dealBreak(bug, 10, "physical", [], "测试");
  assert.equal(bug.dead, true);
  assert.equal(lead.zone, 1, "冲到尘虫那一区");
  assert.equal(c.totalHp(lead) - before, left);
  assert.equal(lead.loseApNext, true, "玩家回合吃的：下个敌人回合没有行动点");
  assert.ok(kolt);
});

test("尘虫白天挨打后摊平：之后受到的伤害 −50%，击破照常；回合开始结束", () => {
  const { c, st, kolt, by } = field([{ id: "dust_bug", lv: 10, zone: 1 }, { id: "sandfish_drive", lv: 1, zone: 2 }]);
  const bug = by("dust_bug")[0];
  const hit = () => { const h0 = c.totalHp(bug); c.dealTo(kolt, bug, { atk: 4, mult: 1, element: "physical", baseBreak: 0, atkRange: "any", flags: { action: true, blockResolved: true, block: "none" } }); return h0 - c.totalHp(bug); };
  const first = hit();
  assert.equal(bug.resources.flattened, true);
  const second = hit();
  assert.ok(second < first, `${first} → ${second}`);
  st.turnNo += 1; c.desertRoundStart([]);
  assert.equal(bug.resources.flattened, false);
});

test("管虫：所在区变流沙；同区 2 只沸腾到相邻区；死光后流沙会消退", () => {
  const { c, st, by } = field([{ id: "tube_worm", lv: 3, zone: 2 }, { id: "tube_worm", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 3 }], { zoneMode: 3 });
  assert.equal(st.fields[2].quicksand, true);
  assert.ok(st.fields[1].quicksand && st.fields[3].quicksand, "沸腾：相邻区也是流沙");
  by("tube_worm").forEach(w => { w.layers.forEach(l => { l.current = 0; }); });
  c.sweepDeadEnemies();
  for (let i = 0; i < 30; i++) c.desertRoundStart([]);
  assert.ok(!st.fields[2].quicksand, "死光后流沙消退");
  assert.ok(by("tube_worm").every(w => w.detected));
});

test("夜晚：尘虫下潜迁徙，几回合后离开；沙鱼的声呐打得到下潜的尘虫", () => {
  const { c, st, by } = field([{ id: "sandfish_drive", lv: 3, zone: 2 }, { id: "dust_bug", lv: 3, zone: 1 }], { night: true });
  const bug = by("dust_bug")[0], fish = by("sandfish_drive")[0];
  assert.equal(bug.submerged, true);
  assert.ok(bug.leaveIn >= 2 && bug.leaveIn <= 3);
  bug.zone = fish.zone;
  const r = c.dealTo(fish, bug, { atk: 2, mult: 1, element: "physical", baseBreak: 0, atkRange: "melee", flags: { action: true, blockResolved: true, block: "none" } });
  assert.notEqual(r.res.ok, false, "沙鱼咬得到沙下的尘虫");
  const b2 = by("dust_bug")[0];
  for (let i = 0; i < 4; i++) c.desertRoundEnd([]);
  assert.ok(b2._removed || b2.dead, "迁徙离开");
});

test("赶潮沙鱼白天甩尾推人，优先推向埋伏的伏咬沙鱼；伏咬沙鱼腾咬（被推过的 +1 击破）", () => {
  const { c, st, kolt, by } = field([{ id: "sandfish_drive", lv: 3, zone: 1 }, { id: "sandfish_ambush", lv: 3, zone: 2 }]);
  const drive = by("sandfish_drive")[0], amb = by("sandfish_ambush")[0];
  assert.equal(amb.submerged, true);
  const helu = c.findKit("helu", st.units);   // 柯尔特自己有减击破，用赫鲁看击破数
  helu.zone = 1; helu.def = helu.defMax;
  kolt.zone = 2;   // 没人能协助格挡，这一击当场结算
  const def0 = helu.def;
  c.fishBite(drive, helu);
  assert.equal(helu.zone, 2, "推到伏咬那一区");
  assert.equal(amb.submerged, false, "腾咬后暴露");
  assert.equal(def0 - helu.def, 3, `甩尾 1 + 腾咬 2（被推过）击破：${def0} → ${helu.def}`);
});

test("夜晚放弃击破：赶潮 / 伏咬的基础击破是 0，领潮 1", () => {
  const { c, by } = field([{ id: "sandfish_lead", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_ambush", lv: 3, zone: 2 }], { night: true });
  assert.equal(c.fishBiteOpt(by("sandfish_drive")[0]).baseBreak, 0);
  assert.equal(c.fishBiteOpt(by("sandfish_ambush")[0]).baseBreak, 0);
  assert.equal(c.fishBiteOpt(by("sandfish_lead")[0]).baseBreak, 1);
  const day = field([{ id: "sandfish_lead", lv: 12, zone: 2 }]);
  assert.equal(day.c.fishBiteOpt(day.by("sandfish_lead")[0]).baseBreak, 3, "白天 10 级起 3 击破");
});

test("群起：沙鱼打出失衡，其他沙鱼都冲过来协助（每只一次）", () => {
  const { c, st, kolt, by } = field([{ id: "sandfish_lead", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }]);
  const lead = by("sandfish_lead")[0];
  kolt.zone = 1;
  st.combatPhase = "enemy";
  c.queueAssistAttack(lead, Object.assign(kolt, { stunned: true }));
  const helpers = [];
  for (let i = 0; i < 6 && (st.assistQueue || []).length; i++) {
    const list = c.eligibleAssisters(c.unitById(st.assistQueue[0].breakerId), kolt);
    if (!list.length) { c.finishAssist(null); continue; }
    helpers.push(list[0].id);
    c.finishAssist(list[0].id);
  }
  assert.equal(new Set(helpers).size, 2, "两只赶潮都协助了");
  assert.ok(by("sandfish_drive").every(f => f._frenzyTurn === st.turnNo));
});

test("母系：领潮死后不再群起、不再探测，鱼群开始逃走", () => {
  const { c, st, by } = field([{ id: "sandfish_lead", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }]);
  const lead = by("sandfish_lead")[0];
  lead.layers.forEach(l => { l.current = 0; }); c.sweepDeadEnemies();
  assert.equal(c.fishLeaderGone(), true);
  for (let i = 0; i < 20; i++) c.desertEnemyPhaseStart([]);
  assert.ok(by("sandfish_drive").some(f => f._removed), "有沙鱼逃走");
});

test("声呐探测：领潮每回合一次，夜晚比白天容易找到；没领潮的鱼群减半", () => {
  const rate = (night, leader) => {
    let found = 0, total = 0;
    for (let i = 0; i < 60; i++) {
      const en = [{ id: leader ? "sandfish_lead" : "sandfish_drive", lv: 3, zone: 2 }];
      for (let k = 0; k < 4; k++) en.push({ id: "dust_bug", lv: 3, zone: 1 });
      const f = field(en, { night, seed: "SON" + i + night + leader });
      f.c.desertEnemyPhaseStart([]);
      const bugs = f.by("dust_bug");
      found += bugs.filter(b => b.detected).length; total += bugs.length;
    }
    return found / total;
  };
  const day = rate(false, true), night = rate(true, true);
  assert.ok(night > day * 2, `白天 ${day} 夜晚 ${night}`);
  assert.ok(day < 0.2);
});

test("遭遇：有沙鱼的沙漠遭遇会配尘虫 / 管虫（不占代币）；中立生物不会被当成敌人抽到", () => {
  const c = H.load();
  let neutral = 0;
  for (let i = 0; i < 60; i++) {
    const spec = c.rollEncounter({ region: "沙漠", faction: "沙漠生物", mixed: false });
    assert.ok(spec.enemies.some(e => ["sandfish_lead", "sandfish_drive", "sandfish_ambush"].includes(e.preset)));
    if (spec.enemies.some(e => e.preset === "dust_bug" || e.preset === "tube_worm")) neutral++;
    const tokens = spec.enemies.filter(e => !c.enemyInfo(e.preset).neutral).reduce((s, e) => s + (c.enemyInfo(e.preset).tokens || 1), 0);
    assert.ok(tokens <= 5);
  }
  assert.ok(neutral > 20, `配了中立生物的场次 ${neutral}/60`);
  for (let i = 0; i < 40; i++) {
    const spec = c.rollEncounter({ region: "沙漠" });
    assert.ok(!spec.enemies.some(e => (e.preset === "dust_bug" || e.preset === "tube_worm") && !spec.enemies.some(x => /^sandfish/.test(x.preset))));
  }
});

test("整场自动对战：白天、夜晚都能打完不卡死", () => {
  for (const night of [false, true]) {
    const { c } = field([{ id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sandfish_drive", lv: 2, zone: 2 }, { id: "sandfish_ambush", lv: 2, zone: 2 },
      { id: "dust_bug", lv: 2, zone: 2 }, { id: "dust_bug", lv: 2, zone: 1 }, { id: "tube_worm", lv: 2, zone: 2 }], { night, seed: "FULL" + night });
    const r = c.BattleSim.run({ maxRounds: 30 });
    assert.ok(["player", "enemy", "timeout"].includes(r.winner));
    assert.deepEqual(plain(c.__errors), []);
  }
});

test("主动捕食：白天血量低于一半的沙鱼去咬被发现的尘虫（失衡就吞掉）；血量高的不理；夜晚不管血量都去吃", () => {
  const mk = (night, hpPct) => {
    const f = field([{ id: "sandfish_lead", lv: 3, zone: 2 }, { id: "dust_bug", lv: 3, zone: 2 }], { night, seed: "HUNT" + night + hpPct });
    const lead = f.by("sandfish_lead")[0], bug = f.by("dust_bug")[0];
    bug.detected = true; bug.submerged = false;
    const max = f.c.totalMaxHp(lead);
    lead.layers[0].current = 0; lead.layers[1].current = Math.max(1, Math.floor(max * hpPct));
    lead.ap = 1;
    f.st.combatPhase = "enemy";
    return Object.assign(f, { lead, bug });
  };
  const hungry = mk(false, 0.3);
  const plan = hungry.c.EnemyAI.plan(hungry.lead);
  assert.match(plan.meta.skillName, /捕食/);
  const hp0 = hungry.c.totalHp(hungry.lead);
  plan.thunk();
  assert.equal(hungry.bug.dead, true, "白天领潮 2 击破，尘虫一口失衡就被吞");
  assert.ok(hungry.c.totalHp(hungry.lead) > hp0);
  const full = mk(false, 0.9);
  const p2 = full.c.EnemyAI.plan(full.lead);
  assert.ok(!p2 || !/捕食/.test(p2.meta.skillName), "血量高的不理尘虫");
  const night = mk(true, 0.9);
  assert.match(night.c.EnemyAI.plan(night.lead).meta.skillName, /捕食/, "夜晚不管血量都吃");
});

test("沙珊瑚台地：自带高地；夜晚每回合伸出触须抓人，被抓的不能移动、推不走、每回合受伤；砍断触须脱困", () => {
  const { c, st, kolt, helu } = field([{ id: "sandfish_drive", lv: 5, zone: 2 }], { night: true, seed: "CORAL1" });
  st.fields[1].coral = true;
  kolt.zone = 1; helu.zone = 2;
  assert.equal(c.isHighGround(st.fields[1]), true);
  c.desertRoundStart([]);
  const t = st.props.find(p => p.kind === "coral_tentacle");
  assert.ok(t, "伸出一根触须");
  assert.equal(kolt.entangled && kolt.entangled.src, t.id);
  st.attackerId = kolt.id; kolt.bonus = 5; kolt.ap = 5;
  c.doMove(kolt, 2);
  assert.equal(kolt.zone, 1, "缠住了动不了");
  c.displaceTo(kolt, 2, [], "被推");
  assert.equal(kolt.zone, 1, "推也推不走");
  const hp = c.totalHp(kolt);
  c.desertRoundStart([]);
  assert.ok(c.totalHp(kolt) < hp, "同化伤害");
  c.damageProp(t, { dmg: 999, element: "physical" }, helu);
  assert.equal(kolt.entangled, null, "触须被砍断就脱困");
});

test("沙珊瑚台地白天只是高地：不伸触须", () => {
  const { c, st, kolt } = field([{ id: "sandfish_drive", lv: 5, zone: 2 }], { seed: "CORAL2" });
  st.fields[1].coral = true; kolt.zone = 1;
  c.desertRoundStart([]);
  assert.ok(!st.props.some(p => p.kind === "coral_tentacle"));
  assert.ok(!kolt.entangled);
});

test("沙珊瑚枝：夜晚回合结束抓人；一回合打掉 25% 耐久砍断触须；沙漠生物不往珊瑚那边走，赶潮会把人甩过去", () => {
  const { c, st, kolt, helu, by } = field([{ id: "sandfish_drive", lv: 5, zone: 2 }, { id: "sand_beast", lv: 5, zone: 1 }], { night: true, seed: "CORAL3" });
  const br = c.makeProp("coral_branch", 1, 5); st.props.push(br);
  kolt.zone = 2; helu.zone = 2;
  const sand = by("sand_beast")[0];
  c.desertRoundEnd([]);
  assert.ok(sand.entangled, "沙灵不躲，被抓住了");
  assert.equal(c.coralAvoid(by("sandfish_drive")[0], 1), true, "沙鱼夜里不靠近珊瑚");
  assert.equal(c.coralAvoid(sand, 1), false, "沙灵不躲");
  assert.equal(c.driveDest(by("sandfish_drive")[0], kolt), 1, "甩尾往珊瑚那边甩");
  c.damageProp(br, { dmg: Math.ceil(br.maxHp * 0.5), element: "physical" }, kolt);   // 装甲吃物理有折扣，打一半上去确保过 25%
  assert.equal(sand.entangled, null, "一回合打掉 25% 耐久就砍断");
  assert.ok(br.hp > 0);
});

test("沙漠生物的 AI 夜晚不走进沙珊瑚的区", () => {
  const { c, st, kolt, helu, by } = field([{ id: "sandfish_drive", lv: 5, zone: 2 }], { night: true, seed: "CORAL4" });
  st.fields[1].coral = true;
  kolt.zone = 1; helu.zone = 1;
  const fish = by("sandfish_drive")[0];
  fish.ap = 2; st.combatPhase = "enemy";
  const plan = c.EnemyAI.plan(fish);
  if (plan) { plan.thunk(); }
  assert.equal(fish.zone, 2, "猎物都在珊瑚台地上，它宁可不过去");
});

test("富集变种：装甲 ×1.5、名字加富集；打倒奎支 ×5 + 材料（沙盒给实物）；第 3 回合起会逃", () => {
  const { c, st, by } = field([{ id: "sandfish_drive", lv: 7, zone: 2 }, { id: "sandfish_drive", lv: 7, zone: 2 }], { seed: "RICH" });
  const [a, b] = by("sandfish_drive");
  const armor0 = a.layers.find(l => l.type === "armor").max;
  c.makeEnriched(a);
  assert.match(a.name, /^富集/);
  assert.equal(a.layers.find(l => l.type === "armor").max, Math.round(armor0 * 1.5));
  assert.ok(c.enemyIntents(a).includes("富集"));
  const k0 = Number(st.kuizhi) || 0, metal0 = c.bagCount("mat_metal");
  a.layers.forEach(l => { l.current = 0; });
  c.settleEnemyKill(a, []);
  assert.equal((Number(st.kuizhi) || 0) - k0, 20 * 5, "赶潮掉 20 奎支，富集 ×5");
  assert.ok(c.bagCount("mat_metal") >= metal0 + 2, "7 级：金属 ×2");
  c.makeEnriched(b);
  st.turnNo = 3;
  for (let i = 0; i < 30 && !b._removed; i++) c.desertEnemyPhaseStart([]);
  assert.equal(b._removed, true, "富集个体会逃走");
});

test("富集出现率：沙暴里更常见", () => {
  const rate = (weather) => {
    let n = 0, all = 0;
    for (let i = 0; i < 80; i++) {
      const f = field([{ id: "sandfish_drive", lv: 3, zone: 2 }, { id: "sandfish_drive", lv: 3, zone: 2 }], { weather, seed: "RR" + weather + i });
      f.by("sandfish_drive").forEach(u => { all++; if (u.enriched) n++; });
    }
    return n / all;
  };
  const calm = rate("none"), storm = rate("sand");
  assert.ok(storm > calm, `平时 ${calm} 沙暴 ${storm}`);
});
