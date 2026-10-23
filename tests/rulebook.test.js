// 规则说明（rulebook.js，issue #263）：图鉴第七本「规则」。章节里的数值都在打开时从规则表 / 规则函数现读，
// 写成文字的公式和规则函数逐项核对；坚毅生命只写规则、不写任何数值；标题 / 单局 / 跑团的「图鉴」旁边都有入口
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");
const H = require("./headless");

const run = (c, code) => vm.runInContext(code, c);
/** 整套规则 + rulebook.js（和浏览器一样在同一个全局里，读得到顶层 const ROGUE_CHECKS 这些）。
 *  rulebook.js 是规则说明页的数据，不是战斗规则，不放进 headless 的 RULE_FILES（HD-2D 原型页照那张表加载） */
function loadRules() {
  const c = H.load();
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, "rulebook.js"), "utf8"), c, { filename: "rulebook.js" });
  return c;
}
function chapter(c, id) {
  const e = c.rulebookEntries().find(x => x.chapter === id);
  assert.ok(e, "没有这一章：" + id);
  return e;
}
/** 一章里给玩家看的全部文字：章名、导语、每节的标题 / 列表 / 表格 / 说明 */
function allText(e) {
  const out = [e.name, e.blurb];
  e.sections.forEach(s => {
    out.push(s.title, ...(s.lines || []));
    if (s.table) out.push(...s.table.head, ...[].concat(...s.table.rows));
    if (s.note) out.push(s.note);
  });
  return out.join("\n");
}
function section(e, title) {
  const s = e.sections.find(x => x.title === title);
  assert.ok(s, `「${e.name}」没有「${title}」这一节`);
  return s;
}
const pct = (v) => Math.round(v * 1000) / 10 + "%";
/** 规则环境（vm）里的数组和这边的不是同一个 Array，deepEqual 前先转成普通数据 */
const plain = (x) => JSON.parse(JSON.stringify(x));

test("章节表：每章都生成得出来，分类、id、导语齐全；issue 要的回合 / 行动 / 检定 / 武器 ATK / 义体改造率都在", () => {
  const c = loadRules();
  const groups = run(c, "RULEBOOK_GROUPS").map(g => g.id);
  const broken = run(c, "RULEBOOK_BROKEN");
  const all = c.rulebookEntries();
  assert.ok(all.length >= 15, String(all.length));
  assert.equal(new Set(all.map(e => e.id)).size, all.length, "id 不重复");
  all.forEach(e => {
    assert.ok(groups.includes(e.group), e.id + " 的分类不在 RULEBOOK_GROUPS 里");
    assert.ok(e.groupName && e.name && e.blurb, e.id);
    assert.equal(e.lines[0], e.blurb, "卡片上的摘要用导语");
    assert.ok(e.sections.length, e.id + " 没有内容");
    e.sections.forEach(s => {
      assert.ok(s.title, e.id + " 有一节没有标题");
      assert.ok((s.lines || []).length || s.table, `${e.id}「${s.title}」是空的`);
      (s.lines || []).forEach(l => assert.equal(typeof l, "string", `${e.id}「${s.title}」`));
      if (s.table) s.table.rows.forEach(r => assert.equal(r.length, s.table.head.length, `${e.id}「${s.title}」表格列数`));
    });
    const text = allText(e);
    assert.doesNotMatch(text, /undefined|NaN|null|\[object/, e.id + " 有没填上的数");
    assert.ok(!text.includes(broken), e.id + " 生成失败");
  });
  ["turn", "economy", "move", "check", "solo", "damage", "layers", "posture", "block", "assist", "down",
    "attrs", "atk", "parts", "durability", "cyber", "level", "rest", "time", "retreat"].forEach(id => chapter(c, id));
  const order = all.map(e => groups.indexOf(e.group));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b), "按分类排好");
});

test("某一章的数据没加载完整（或者出错）只影响这一章，其他章照常", () => {
  const c = loadRules();
  run(c, "ROGUE_CHECKS.chance = null");
  const broken = run(c, "RULEBOOK_BROKEN");
  const bad = c.rulebookEntries().filter(e => allText(e).includes(broken)).map(e => e.chapter);
  assert.deepEqual(plain(bad), ["check"]);
});

test("搜索：章名、正文、表格和关键词都搜得到（「改装率」找得到义体那一章）", () => {
  const c = loadRules();
  const hit = (q) => c.rulebookEntries().filter(e => c.codexMatch(e, q)).map(e => e.chapter);
  assert.ok(hit("改装率").includes("cyber"));
  assert.ok(hit("改造率上限").includes("cyber"));
  assert.ok(hit("成功率").includes("check"));
  assert.ok(hit("迎难直上").includes("check"), "表格 / 列表里的字也算");
  assert.ok(hit("补正").includes("atk"));
});

test("检定：成功率表、难度名、奖励、种族和熟练项都从规则表读；改了表，说明跟着变", () => {
  const c = loadRules();
  const K = run(c, "ROGUE_CHECKS");
  const diffs = Object.keys(K.diffs);
  const e = chapter(c, "check");
  const t = section(e, "成功率").table;
  assert.deepEqual(plain(t.head.slice(1)), diffs.map(d => K.diffs[d].name));
  assert.equal(t.rows.length, K.chance.length);
  K.chance.forEach((row, i) => row.forEach((p, j) => assert.equal(t.rows[i][j + 1], p > 0 ? pct(p) : "不能尝试", `熟练 ${i} · ${diffs[j]}`)));
  assert.ok(t.rows.some(r => r.includes("12.5%")), "小数照实写");
  const text = allText(e);
  const perks = run(c, "RACE_CHECK_PERKS");
  Object.keys(perks).forEach(r => assert.ok(section(e, "种族").lines.some(l => l.startsWith(r)), r));
  const P = run(c, "PROFICIENCIES");
  Object.keys(P).forEach(g => assert.ok(text.includes(`${g}：${P[g].join("、")}`), g));
  assert.ok(text.includes(`熟练等级最高 ${run(c, "PROF_MAX")} 级`));
  diffs.forEach(d => assert.ok(text.includes(`${K.diffs[d].name} ${K.diffs[d].reward}`), d + " 的奖励"));
  const B = run(c, "ROGUE_BOUNTY");
  assert.ok(text.includes(`成功 ${B.need} 次`) && text.includes(`失败 ${B.failMax} 次`));
  run(c, "ROGUE_CHECKS.chance[0][0] = 0.6; ROGUE_CHECKS.diffs.normal.name = '中等'; ROGUE_CHECKS.diffs.hard.reward = 2345");
  const e2 = chapter(c, "check");
  const t2 = section(e2, "成功率").table;
  assert.equal(t2.rows[0][1], "60%");
  assert.ok(t2.head.includes("中等"));
  assert.match(allText(e2), /困难 2345/);
});

test("武器 ATK：文字写的公式和 computeWeaponAtk 逐项一致（每把武器 × 1–10 级 × 几组属性 × 有无改装件）", () => {
  const c = loadRules();
  const e = chapter(c, "atk");
  const text = allText(e);
  assert.ok(text.includes("武器 atk = 四舍五入（基础 + (武器等级 − 1) + Σ（属性 × 补正）× 等级系数）+ 改装件的固定 atk"));
  assert.ok(text.includes("等级系数 = 0.5 × 武器等级"));
  assert.ok(text.includes("角色的 atk = 角色 atk + 手里那把武器的 atk"));
  assert.ok(text.includes("角色 atk = ⌈4 + (力量 − 5) ÷ 2⌉ + ⌈力量 × (等级 − 1) ÷ 7⌉"));
  const F = run(c, "WEAPON_FORMULA");
  // 照文字算一遍
  const byText = (kit, attrs, lv, parts) => {
    const coefs = c.weaponCoefs(kit, parts);
    const sum = Object.keys(coefs).reduce((s, a) => s + (attrs[a] || 0) * coefs[a], 0);
    const flat = parts.reduce((s, id) => s + c.weaponPartFlatAtk(id), 0);
    return Math.round(F[kit].base + (lv - 1) + sum * 0.5 * lv) + flat;
  };
  const attrSets = [{ str: 5, con: 5, dex: 5, wil: 5, int: 5, sta: 5 }, { str: 9, con: 3, dex: 8, wil: 6, int: 2, sta: 7 }, { str: 1, con: 12, dex: 2, wil: 9, int: 11, sta: 4 }];
  const partSets = [[], ["c_str_dex"], ["b_int_con", "c_block_wil"]];
  Object.keys(F).forEach(kit => attrSets.forEach(attrs => partSets.forEach(parts => {
    for (let lv = 1; lv <= 10; lv++) assert.equal(byText(kit, attrs, lv, parts), c.computeWeaponAtk(kit, attrs, lv, parts), `${kit} Lv${lv} ${JSON.stringify(attrs)} ${parts}`);
  })));
  for (let str = 1; str <= 15; str++) for (let lv = 1; lv <= 20; lv++) {
    assert.equal(Math.ceil(4 + (str - 5) / 2) + Math.ceil(str * (lv - 1) / 7), c.derivedFromAttrs({ str }, lv).personalAtk, `力量 ${str} Lv${lv}`);
  }
  // 每把武器的基础和补正照 WEAPON_FORMULA
  const rows = section(e, "各武器的基础和补正").table.rows;
  Object.keys(F).forEach(kit => {
    const r = rows.find(x => x[1] === c.weaponName(kit));
    assert.ok(r, kit);
    assert.equal(r[2], String(F[kit].base));
    assert.equal(r[3], c.weaponPartCoefText(c.weaponCoefs(kit, [])));
  });
  // 例子的数是 weaponAtkBreakdown 算的
  const ex = section(e, "算一个例子").lines.join("\n");
  const hero = c.livePartyCards().find(x => x.attrs && !x.weaponOf), kit = hero.linkedKits[0];
  [1, 5].forEach(lv => assert.ok(ex.includes(`→ 四舍五入 ${c.weaponAtkBreakdown(kit, hero.attrs, lv, []).atk}`), `${lv} 级的例子`));
  run(c, "WEAPON_FORMULA.mint.base = 9");
  assert.equal(section(chapter(c, "atk"), "各武器的基础和补正").table.rows.find(x => x[1] === c.weaponName("mint"))[2], "9");
});

test("角色属性：生命 / 架势 / 改造率上限 / 空手格挡的文字公式和规则函数一致；属性点照 ROGUE_LEVEL_REWARDS", () => {
  const c = loadRules();
  const text = allText(chapter(c, "attrs"));
  ["生命上限 = 体质 × 2 + 2 + 体质 × (等级 − 1)", "架势上限 = ⌈4 + (耐力 − 5) ÷ 2⌉ + ⌊等级 ÷ 10⌋",
    "义体改造率上限 = 50% + (智力 − 5) × 10%（0%–99%）", "空手格挡率 = 30% + (敏捷 − 5) × 5%（15%–50%）"].forEach(f => assert.ok(text.includes(f), f));
  for (let v = 1; v <= 15; v++) for (let lv = 1; lv <= 20; lv++) {
    const d = c.derivedFromAttrs({ str: v, con: v, dex: v, wil: v, int: v, sta: v }, lv);
    assert.equal(d.hp, v * 2 + 2 + v * (lv - 1), `体质 ${v} Lv${lv}`);
    assert.equal(d.def, Math.ceil(4 + (v - 5) / 2) + Math.floor(lv / 10), `耐力 ${v} Lv${lv}`);
    assert.equal(d.cyber, Math.max(0, Math.min(99, 50 + (v - 5) * 10)), `智力 ${v}`);
  }
  for (let dex = 0; dex <= 15; dex++) assert.equal(c.bareBlockFromDex(dex), Math.max(15, Math.min(50, 30 + (dex - 5) * 5)), `敏捷 ${dex}`);
  const R = run(c, "ROGUE_LEVEL_REWARDS");
  const lv = Object.keys(R).filter(L => R[L].some(r => r.type === "attr"));
  assert.ok(text.includes(`升到 ${lv.join(" / ")} 级各得 1 点属性`));
  Object.keys(R).filter(L => R[L].some(r => r.type === "attr" && r.noRepeat)).forEach(L => assert.ok(text.includes(`${L} 级那一点不能加在之前加过的那一项上`)));
});

test("义体与改造率：档位表、攻击义体伤害、换算比例从 cyberware.js / growth.js 读；过度安装的专长看 FEATS", () => {
  const c = loadRules();
  const e = chapter(c, "cyber");
  const T = run(c, "CYBERWARE_TIER"), tiers = run(c, "CYBERWARE_TIERS"), V = run(c, "CYBERWARE_VOL");
  const tb = section(e, "义体").table;
  // 最后一列：装这一档要角色几级（#315：等级 ≥ 档位，和 5 级总开关取高的）
  tiers.forEach((t, i) => assert.deepEqual(plain(tb.rows[i]), [`${t} 级`, `.vol${V[t]}`, `−${T[t].hpCut}`, pct(T[t].occupancy), `${Math.max(t, run(c, "CYBERWARE_UNLOCK_LEVEL"))} 级`]));
  const at = section(e, "发动义体（单体伤害型）").table;
  tiers.forEach((t, i) => assert.deepEqual(plain(at.rows[i]), [`${t} 级`, c.cyberwareDamageSpec(t, "melee").text, c.cyberwareDamageSpec(t, "ranged").text]));
  const text = allText(e);
  const R = run(c, "CYBER_RATIO");
  assert.ok(text.includes(`肉体 ${R.flesh} : 装甲 ${R.armor} : 护盾 ${R.shield} : 沙尘 ${R.sand}`));
  assert.ok(text.includes(`剩下的肉体按 ${R.flesh} : ${R.spirit} 全部换成星灵`));
  assert.ok(text.includes(`最多 ${run(c, "CYBER_MAX_TYPES")} 种血量`));
  assert.ok(text.includes("改造率上限 = 50% + (智力 − 5) × 10%，最低 0%，最高 99%"));
  assert.ok(text.includes(`${run(c, "CYBERWARE_ATTACK.break")} 击破`));
  assert.ok(text.includes(`每超出 ${pct(run(c, "CYBERWARE_OVER_STEP"))}`));
  assert.match(text, /这个专长还没加入游戏/, "FEATS 里还没有过度安装的专长");
  run(c, "CYBERWARE_TIER[5].hpCut = 6; FEATS[CYBERWARE_OVERINSTALL_FEAT] = { name: '超限改造', tier: 1, text: '测试' }");
  const e2 = chapter(c, "cyber");
  assert.equal(section(e2, "义体").table.rows[0][2], "−6");
  assert.match(allText(e2), /专长「超限改造」/);
});

test("坚毅生命红线：规则说明里没有任何坚毅生命的数值（剩余、上限、加成、消耗都不写），也没有 shp 字样", () => {
  const c = loadRules();
  c.BattleSim.setup({ party: ["ruby", "kolt", "xia"], enemies: [] });
  c.S.state.units.filter(u => u.isPlayer).forEach(u => { u.shp = 987654; u.shpMax = 987655; u.shpBonus = 15; });
  c.rulebookEntries().forEach(e => {
    const t = allText(e) + "\n" + (e.lines || []).join("\n");
    assert.doesNotMatch(t, /98765/, e.id);
    assert.doesNotMatch(t, /shp/i, e.id);
    assert.doesNotMatch(t, /坚毅(生命)?(上限)?\s*[+＋\-−]?\s*[0-9０-９]/, e.id + "：坚毅后面跟着数字");
    assert.doesNotMatch(t, /[0-9０-９]\s*点?\s*坚毅/, e.id + "：数字后面跟着坚毅");
  });
});

test("行动点：角色和武器人每回合 1 行动点 + 1 附赠，单人模式主角照 ROGUE_SOLO.apPerRound；敌人、唤出武器人照规则函数", () => {
  const c = loadRules();
  c.BattleSim.setup({ party: ["ruby", "kolt"], enemies: [{ id: "thug_knife", lv: 1, zone: 2 }] });
  c.startCombat();
  const st = c.S.state;
  const ruby = c.findKit("ruby", st.units);
  assert.deepEqual([ruby.ap, ruby.bonus], [1, 1]);
  const torque = c.spawnWeapon(c.findKit("kolt", st.units), "torque");
  c.refreshEconomy(torque);
  assert.deepEqual([torque.ap, torque.bonus], [1, 1], "武器人也有自己的行动点和附赠");
  const text = allText(chapter(c, "economy"));
  assert.ok(text.includes("每回合有 1 行动点、1 附赠动作"));
  assert.ok(text.includes(`单人模式的主角是 ${run(c, "ROGUE_SOLO.apPerRound")} 行动点`));
  const minion = c.enemyActBudget({ kit: "thug_knife" }), elite = c.enemyActBudget({ kit: "mecha_mg" }), boss = c.enemyActBudget({ kit: "outlaw_king" });
  assert.equal(minion.bonus, 0);
  assert.ok(text.includes(`杂兵每回合 ${minion.ap} 行动点、没有附赠动作`));
  assert.deepEqual(elite, boss);
  assert.ok(text.includes(`精英和首领每回合 ${elite.ap} 行动点 + ${elite.bonus} 附赠动作`));
  assert.ok(text.includes(`唤出武器人：${c.skillCost("ruby_summon").ap} 行动点 + ${c.skillCost("ruby_summon").bonus} 附赠动作`));
  assert.ok(text.includes(`武器人变回武器：${c.skillCost("mint_return").ap} 行动点`));
  run(c, "ROGUE_SOLO.apPerRound = 3");
  assert.ok(allText(chapter(c, "economy")).includes("单人模式的主角是 3 行动点"));
  assert.ok(allText(chapter(c, "solo")).includes("主角每回合 3 行动点"));
});

test("伤害、血量层：克制表照 CHART，天气加减照 weatherDamagePct，改了表跟着变", () => {
  const c = loadRules();
  const CH = run(c, "CHART"), ELE = run(c, "ELE"), LAYER = run(c, "LAYER");
  const t = section(chapter(c, "layers"), "克制表（常态天气）").table;
  assert.deepEqual(plain(t.head.slice(1)), Object.keys(LAYER).map(l => LAYER[l]));
  Object.keys(ELE).forEach((el, i) => {
    assert.equal(t.rows[i][0], ELE[el]);
    Object.keys(LAYER).forEach((l, j) => assert.equal(t.rows[i][j + 1], c.codexPct(CH[el][l]), `${el} → ${l}`));
  });
  const w = section(chapter(c, "damage"), "天气对属性伤害").lines;
  const WN = run(c, "WEATHER_CN");
  Object.keys(WN).filter(k => k !== "none").forEach(k => {
    const parts = Object.keys(ELE).filter(el => c.weatherDamagePct(k, el)).map(el => `${ELE[el]} ${c.codexPct(c.weatherDamagePct(k, el))}`);
    if (parts.length) assert.ok(w.includes(`${WN[k]}：${parts.join("、")}`), k);
    else assert.ok(!w.some(l => l.startsWith(WN[k] + "：")), k + " 没有属性加减就不列");
  });
  run(c, "CHART.fire.flesh = 0.75");
  assert.equal(section(chapter(c, "layers"), "克制表（常态天气）").table.rows[0][1], "+75%");
});

test("协助格挡：空手格挡率的常数从 bareBlockFromDex 量出来，武器的格挡加成照 WEAPON_BLOCK_BONUS", () => {
  const c = loadRules();
  const e = chapter(c, "block");
  const text = allText(e);
  assert.ok(text.includes("空手格挡率 = 30% + (敏捷 − 5) × 5%，最低 15%，最高 50%"));
  assert.ok(text.includes(`最高 ${run(c, "BLOCK_CHANCE_CAP")}%`));
  const WB = run(c, "WEAPON_BLOCK_BONUS");
  const rows = section(e, "成功率").table.rows;
  Object.keys(WB).forEach(k => assert.ok(rows.some(r => r[1] === c.weaponName(k) && r[2] === `+${WB[k]}%`), k));
});

test("力竭、撤退、休息：阈值和代价照规则函数 / 规则表；短休恢复量照 ledgerShortRest", () => {
  const c = loadRules();
  const ex = section(chapter(c, "time"), "力竭").table;
  [1, 2, 3, 4].forEach((tier, i) => {
    const h = Number(ex.rows[i][0].match(/\d+/)[0]);
    assert.equal(c.exhaustTierFromHours(h), tier);
    assert.equal(c.exhaustTierFromHours(h - 1), tier - 1, "这是这一档的起点");
    assert.equal(ex.rows[i][1], c.exhaustText(tier));
  });
  const RR = run(c, "RETREAT_RULES"), keys = Object.keys(RR);
  const rt = section(chapter(c, "retreat"), "撤退的几档").table;
  assert.deepEqual(plain(rt.head.slice(1)), keys.map(k => RR[k].name));
  const row = (name) => plain(rt.rows.find(r => r[0] === name).slice(1));
  assert.deepEqual(row("耗时"), keys.map(k => `${RR[k].hours} 小时`));
  assert.deepEqual(row("奎支"), keys.map(k => (RR[k].kuizhiLoss ? `丢 ${pct(RR[k].kuizhiLoss)}` : "不丢")));
  // 长休消耗照 LONG_REST_COST
  const LR = run(c, "LONG_REST_COST");
  const lt = section(chapter(c, "rest"), "长休").table.rows;
  assert.equal(lt.length, Object.keys(LR).length);
  Object.keys(LR).forEach((k, i) => assert.deepEqual(plain(lt[i].slice(1)), [`${LR[k].water} ml`, `${LR[k].food} 份`]));
  // 短休：等级 × 2 + 体质（犬类人-犬 +25%）
  assert.ok(allText(chapter(c, "rest")).includes("恢复「等级 × 2 + 体质」点生命（犬类人-犬 +25%）"));
  c.BattleSim.setup({ party: ["ruby", "chuan"], enemies: [] });
  const st = c.S.state;
  const heal = {};
  ["ruby", "chuan"].forEach(k => { const u = c.findKit(k, st.units); u.layers.forEach(l => { l.current = 1; }); heal[k] = c.totalHp(u); });
  c.ledgerShortRest(null, []);
  const ruby = c.findKit("ruby", st.units), chuan = c.findKit("chuan", st.units);
  assert.equal(c.totalHp(ruby) - heal.ruby, ruby.level * 2 + ruby.attrs.con);
  assert.equal(c.totalHp(chuan) - heal.chuan, Math.floor((chuan.level * 2 + chuan.attrs.con) * 1.25), "川川是犬类人-犬");
});

test("升级：经验表照 xpToNext（单局按 ROGUE_CONFIG.xpReqScale），翻看规则不会改掉当前的经验倍率；每级奖励、职责路线照规则表", () => {
  const c = loadRules();
  c.setXpRequirementScale(0.5);
  const e = chapter(c, "level");
  assert.equal(run(c, "XP_REQ_SCALE"), 0.5, "生成完要还原");
  const t = section(e, "升级所需经验").table;
  c.setXpRequirementScale(1);
  const raw = [];
  for (let lv = 1; c.xpToNext(lv); lv++) raw.push(c.xpToNext(lv));
  assert.equal(t.rows.length, raw.length);
  c.setXpRequirementScale(run(c, "ROGUE_CONFIG.xpReqScale"));
  raw.forEach((n, i) => assert.deepEqual(plain(t.rows[i]), [`${i + 1} → ${i + 2}`, String(n), String(c.xpToNext(i + 1))]));
  const R = run(c, "ROGUE_LEVEL_REWARDS");
  const rew = section(e, "每一级得到什么").table.rows;
  assert.deepEqual(plain(rew.map(r => r[0])), Object.keys(R).map(Number).sort((a, b) => a - b).map(L => `${L} 级`));
  Object.keys(R).forEach(L => R[L].filter(r => r.type === "note" && r.key !== "feat").forEach(r => {
    assert.ok(rew.find(x => x[0] === `${L} 级`)[1].includes(`${r.text}（系统尚未实装）`), L);
  }));
  assert.match(rew.find(x => x[0] === "7 级")[1], /一项专长/);
  const text = allText(e);
  const rolePath = (sec) => run(c, "ROLE_MILESTONES").map(m => {
    const o = c.roleChoicesAt({ roles: { primary: "P", secondary: sec } }, m)[0];
    return `${m} 级${o.role === "P" ? "主" : "副"}职责 ${o.n} 号`;
  }).join(" → ");
  assert.ok(text.includes(`主副职责不同：${rolePath("S")}`));
  assert.ok(text.includes(`主副职责相同（专精）：${rolePath("P")}`));
  assert.ok(text.includes(`${run(c, "FEAT_LEVELS").join(" / ")} 级各选一项专长`));
});

test("武器耐久、改装件：耐久上限的文字公式照 weaponBaseDur；改装槽、被动升级、客制化的等级从规则表读", () => {
  const c = loadRules();
  const G = run(c, "WEAPON_GROWTH");
  assert.ok(allText(chapter(c, "durability")).includes("耐久上限 = 基础耐久 + ⌊武器等级 ÷ 2⌋"));
  Object.keys(G).forEach(k => { for (let lv = 1; lv <= 10; lv++) assert.equal(c.weaponBaseDur(k, lv), G[k].baseDur + Math.floor(lv / 2), `${k} Lv${lv}`); });
  const text = allText(chapter(c, "parts"));
  assert.ok(text.includes(`武器等级 + 羁绊到 ${run(c, "WEAPON_PART_SLOT_LEVELS").join(" / ")} 级各多 1 个改装槽`));
  const P = run(c, "PASSIVE_PLUS_LEVEL");
  Object.keys(P).forEach(n => assert.ok(text.includes(`${P[n]} 级：被动${"一二三"[n - 1]}升级`), "被动 " + n));
  assert.ok(text.includes(`到 ${run(c, "BLUEPRINT_MIN_LEVEL")} 级起才能装客制化图纸`));
  assert.ok(text.includes(`0–${run(c, "BOND_MAX")} 级`));
  run(c, "WEAPON_PART_SLOT_LEVELS[1] = 6");
  assert.ok(allText(chapter(c, "parts")).includes("武器等级 + 羁绊到 3 / 6 级各多 1 个改装槽"));
});

/* ---------- 按审查修（PR #275）：手写的规则说明照代码的实际结算 ---------- */
/** 开一场战斗（规则说明本身不读单位；这里是拿实际结算来对照文字） */
function battle(c, party, enemies, seed) {
  c.BattleSim.setup({ party, enemies: enemies || [{ id: "thug_knife", lv: 1, zone: 2 }], seed: seed || "RULEBOOK" });
  c.startCombat();
  return c.S.state;
}

test("协助格挡：空手挡住架势照常扣（会被打进失衡）；拿武器格挡一发动就扣耐久，没挡住也扣；范围攻击、炮台、首领机制不能格挡", () => {
  const c = loadRules();
  const e = chapter(c, "block");
  const after = section(e, "挡住以后").lines;
  const bare = after.find(l => l.startsWith("空手挡住"));
  assert.ok(bare, "有空手挡住那一条");
  assert.match(bare, /一半伤害/);
  assert.match(bare, /架势照常扣（可能被打进失衡）/);
  assert.doesNotMatch(bare, /最少留/, "空手挡住不保架势");
  assert.ok(after.every(l => !/耐久 −1/.test(l)), "扣耐久不写在「挡住以后」下面（没挡住也扣）");
  assert.match(section(e, "成功率").lines.join("\n"), /拿着武器格挡，不管挡没挡住，这把武器耐久 −1/);
  const who = section(e, "谁能挡").lines.join("\n");
  assert.match(who, /范围攻击（打一整区的）也不能/);
  assert.match(who, /防卫炮台/);
  assert.match(who, /首领机制/);
  // 实际结算 ①：空手挡住只把伤害减半，架势照扣到 0、失衡
  const st = battle(c, ["kolt", "helu"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = c.findKit("kolt", st.units), helu = c.findKit("helu", st.units), foe = st.units.find(u => !u.isPlayer);
  kolt.def = 2;
  const r = c.resolveAttack({ attacker: foe, target: kolt, atk: 4, mult: 1, hits: 1, baseBreak: 3, element: "fire",
    flags: { action: true, block: "bareOk" }, weather: "none", zoneMode: 2, attackerField: {}, targetField: {}, dist: 0, atkRange: "melee" });
  assert.equal(r.defAfter, 0, "空手挡住：架势照扣");
  assert.equal(r.broke, true, "被打进失衡");
  // 实际结算 ②：拿武器格挡没挡住，这把武器照样 −1 耐久
  helu.zone = kolt.zone; helu.bonus = 1;
  const before = c.weaponDur("ecmo");
  assert.equal(c.performAssistBlock(helu, kolt, foe, { ok: false }).ok, false);
  assert.equal(c.weaponDur("ecmo"), before - 1, "没挡住也扣耐久");
});

test("唤出 / 变回武器人写基础消耗：选中带「人器一心」的人（或者他的武器人）时规则页照样不变，生成完也不改 state.attackerId", () => {
  const c = loadRules();
  const st = battle(c, ["kolt", "ruby"]);
  const kolt = c.findKit("kolt", st.units);
  st.attackerId = null;
  const summon = c.rbCost(c.skillCost("kolt_summon")), back = c.rbCost(c.skillCost("torque_return"));
  assert.equal(summon, "1 行动点 + 1 附赠动作");
  const want = { economy: [`唤出武器人：${summon}；`, `武器人变回武器：${back}（`], durability: [`变成武器人一起打：${summon}；`, `武器人变回武器：${back}。`] };
  const check = (why) => Object.keys(want).forEach(id => {
    const t = allText(chapter(c, id));
    want[id].forEach(w => assert.ok(t.includes(w), `${why} · ${id}：${w}`));
  });
  check("没选中人");
  kolt.feats = ["onemind"];
  st.attackerId = kolt.id;
  assert.deepEqual(plain(c.skillCost("kolt_summon")), { bonus: 1 }, "对照：选中的人有人器一心时，技能的实际消耗确实变了");
  check("选中带人器一心的柯尔特");
  assert.equal(st.attackerId, kolt.id, "生成完还原选中的人");
  const torque = c.spawnWeapon(kolt, "torque");
  kolt.resources.featUsed = Object.assign({}, kolt.resources.featUsed, { onemind: 1 });
  st.attackerId = torque.id;
  assert.deepEqual(plain(c.skillCost("torque_return")), {}, "对照：人器一心用过以后，变回武器不花行动点");
  check("选中扭矩");
  assert.equal(st.attackerId, torque.id);
});

test("战斗中用维修工具包修过的武器：规则页写这一场按受损算（atk、格挡加成减半，不能再唤出），和 ledgerRepair 的实际结果一致", () => {
  const c = loadRules();
  const atk = section(chapter(c, "atk"), "会让 atk 变的情况").lines[0];
  assert.match(atk, /战斗中用维修工具包修过/);
  assert.match(atk, /不能再唤出武器人/);
  assert.match(section(chapter(c, "durability"), "耐久").lines.join("\n"), /战斗中也能修，但修好的武器这一场仍按受损算/);
  assert.match(section(chapter(c, "block"), "成功率").lines.join("\n"), /战斗中修过/);
  const st = battle(c, ["kolt", "helu"]);
  st.bag = { items: [] };
  c.bagAdd("repair_kit", 1);
  c.LEDGER.dur.torque = 2;
  c.ledgerRepair("torque", []);
  assert.ok(c.weaponDur("torque") > 2, "修好了");
  assert.equal(c.weaponHalved("torque"), true, "这一场按受损算");
  assert.equal(c.spawnWeapon(c.findKit("kolt", st.units), "torque"), null, "不能再唤出");
});

test("首领 / 精英的晕眩标记：没攒满时失衡马上结束、架势回满，排上队的协助攻击打到时它已经不在失衡（照 bossQuickRecover 写）", () => {
  const c = loadRules();
  const lines = section(chapter(c, "posture"), "失衡").lines.join("\n");
  assert.doesNotMatch(lines, /这次失衡照常结算/);
  assert.match(lines, /失衡马上结束、架势回满/);
  assert.match(lines, /打到时它已经不在失衡/);
  assert.match(lines, /算进下一个标记/);
  assert.match(lines, /和载具合并的驾驶员/);
  const st = battle(c, ["kolt", "ruby"], [{ id: "outlaw_king", lv: 1, zone: 2 }]);
  const king = st.units.find(u => u.kit === "outlaw_king"), kolt = c.findKit("kolt", st.units);
  st.assistQueue = [];
  c.dealBreak(king, 99, "physical", [], "测试", { by: kolt });
  assert.equal(king.stunMarks, 1);
  assert.equal(king.stunned, false, "没攒满：失衡马上结束");
  assert.equal(king.def, king.defMax, "架势回满");
  assert.ok(st.assistQueue.some(j => j.targetId === king.id), "协助攻击照样排上队");
});

test("天气：相位波谷 / 波峰是 ∓50% 和其他百分比加在一起、微光不反转能量——文字和 resolveAttack 的结果一致", () => {
  const c = loadRules();
  const note = section(chapter(c, "damage"), "天气对属性伤害").note;
  assert.match(note, /微光还会反转克制表（能量除外）/);
  assert.match(note, /不另外相乘/);
  const trough = Number((note.match(/波谷全场伤害 −(\d+)%/) || [])[1]);
  const crest = Number((note.match(/波峰全场伤害 \+(\d+)%/) || [])[1]);
  assert.ok(trough > 0 && crest > 0, note);
  assert.match(section(chapter(c, "layers"), "克制表（常态天气）").note, /微光反转克制（能量除外）/);
  // 实际结算：atk 100 打 9999 点的一层
  const st = battle(c, ["ras"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const a = c.findKit("ras", st.units), t = st.units.find(u => !u.isPlayer);
  a.zone = t.zone = 1; a.statuses = c.defaultStatuses ? c.defaultStatuses() : {};
  const hit = (element, weather, phaseStep, layer) => {
    t.layers = [{ type: layer, current: 9999, max: 9999 }]; t.def = t.defMax = 99; t.flying = false; t.instant = {};
    return c.resolveAttack({ attacker: a, target: t, atk: 100, mult: 1, hits: 1, baseBreak: 0, element, flags: { action: true },
      weather, phaseStep, zoneMode: 2, attackerField: {}, targetField: {}, dist: 0, atkRange: "any" }).total;
  };
  const CH = run(c, "CHART");
  // 火打肉体（克制 +50%）：波谷 = 100 × (1 + 50% − 50%) = 100，不是 100 × 1.5 × 0.5
  assert.equal(hit("fire", "phase", 0, "flesh"), Math.floor(100 * (1 + CH.fire.flesh - trough / 100)));
  assert.equal(hit("fire", "phase", 2, "flesh"), Math.floor(100 * (1 + CH.fire.flesh + crest / 100)));
  // 微光：能量打星灵照常克制；火打肉体反过来
  assert.equal(hit("energy", "glow", null, "spirit"), Math.floor(100 * (1 + CH.energy.spirit + c.weatherDamagePct("glow", "energy"))));
  assert.equal(hit("fire", "glow", null, "flesh"), Math.floor(100 * (1 - CH.fire.flesh + c.weatherDamagePct("glow", "fire"))));
});

test("血量层改造：能换的肉体 = 改造率上限 × 肉体上限（装了义体先扣义体的占用），和诊所算的上限一致", () => {
  const c = loadRules();
  const lines = section(chapter(c, "cyber"), "血量层改造").lines.join("\n");
  assert.match(lines, /能换的肉体最多 = 改造率上限 × 肉体生命上限，向下取整/);
  assert.match(lines, /装了义体时改成 \(改造率上限 − 义体的占用\) × 原生命上限/);
  assert.doesNotMatch(lines, /最多 = 改造率 ×/, "「改造率」是现在的占用，不是上限");
  let n = 0;
  for (const con of [3, 5, 7]) for (const int of [3, 5, 6, 8, 10]) for (const lv of [1, 4, 9, 15]) for (const cw of [[], ["strike_v1"], ["shot_v2"], ["strike_v2", "shot_v1"]]) {
    const u = { kit: "rb_test", attrs: { str: 5, con, dex: 5, wil: 5, int, sta: 5 }, level: lv, cyberware: cw.map(id => ({ id })) };
    const base = c.cyberwareBaseHp(u), cap = c.cyberwareCap(u), fleshMax = base - c.cyberwareHpCut(u);
    if (fleshMax <= 0) continue;
    // 诊所（rogue.js · cyberInfo、trpg.js · trpgCyberInfo）的算法
    const game = c.cyberConvertLimit(fleshMax, cw.length ? c.cyberwareLayerRateFor(u, fleshMax) : c.cyberRateOf(u.attrs, lv));
    // 照规则页的文字算
    const raw = cw.length ? Math.max(0, cap - c.cyberwareOccupancy(u)) * base : cap * fleshMax;
    const byText = Math.floor(raw + 1e-9);
    // 文字的结果恰好是整数时，诊所的浮点误差会少算 1 点（规则代码的问题，见 PR #275 的说明，这里不改）
    const edge = Math.abs(raw - Math.round(raw)) < 1e-9;
    assert.ok(game === byText || (edge && game === byText - 1), `体质 ${con} 智力 ${int} Lv${lv} ${cw}：诊所 ${game}，文字 ${byText}`);
    n++;
  }
  assert.ok(n > 100);
});

test("义体已经做进游戏：规则页写目前的系列、以新换旧、战斗里怎么发动（消耗、次数、射程、击破照目录和 skillCost）", () => {
  const c = loadRules();
  const e = chapter(c, "cyber");
  const text = allText(e);
  const fire = section(e, "发动义体（单体伤害型）");
  assert.doesNotMatch(section(e, "义体").lines.join("\n") + fire.lines.join("\n"), /还没|尚未|暂无/, "义体已经能装、能发动");
  run(c, "CYBERWARE_LINES").forEach(l => assert.ok(section(e, "义体").lines[0].includes(`「${l.name}」`), l.name));
  assert.match(text, /以新换旧（付旧的拆除费 \+ 新的价格）/);
  assert.match(text, /图鉴「义体」/, "具体的坚毅生命消耗指到义体图鉴");
  const cat = c.cyberwareCatalog();
  assert.ok(cat.length > 0, "正式目录不是空的");
  const use = fire.lines.join("\n");
  cat.forEach(d => {
    assert.ok(use.includes(`发动花 ${c.rbCost(c.skillCost("cw_" + d.id))}`), d.id + " 的消耗照 skillCost");
    assert.ok(use.includes(`每次短休 ${d.usesPerShortRest} 次`), d.id);
    assert.ok(use.includes(`${d.break} 击破`), d.id);
  });
  const K = run(c, "CYBERWARE_KINDS.attack");
  assert.deepEqual(plain(K.range({ range: "melee" })), { min: 0, max: 0 });
  assert.deepEqual(plain(K.range({ range: "ranged" })), { min: 1, max: 1 });
  assert.match(use, /近战打同区的一名、远程打距离 1 的一名/);
  // 目录里的消耗改了，文字跟着变
  run(c, "Object.keys(CYBERWARE).forEach(k => { CYBERWARE[k].cost = { bonus: 1 }; })");
  assert.ok(section(chapter(c, "cyber"), "发动义体（单体伤害型）").lines.join("\n").includes("发动花 1 附赠动作"));
});

test("经验来源：评价倍率照 SCORE_GRADES；跑团每场胜利的额外经验和 settleBattleRewards 一致；遭遇战照 ROGUE_CONFIG.ambush.xpPerLevel", () => {
  const c = loadRules();
  const lines = section(chapter(c, "level"), "经验").lines;
  // 「B ×1.2、A ×1.5、S / SS / SSS ×2；C、D 不加」→ 每个评价的倍率
  const gl = lines.find(l => l.startsWith("打赢时看战斗评价"));
  assert.ok(gl, lines.join("\n"));
  const seg = gl.slice(gl.indexOf("（") + 1, gl.indexOf("）"));
  const [ups, none] = seg.split("；");
  const said = {};
  ups.split("、").forEach(p => { const [names, m] = p.split(" ×"); names.split(" / ").forEach(g => { said[g] = Number(m); }); });
  (none || "").replace(/ 不加$/, "").split("、").filter(Boolean).forEach(g => { said[g] = 1; });
  run(c, "SCORE_GRADES").forEach(g => assert.equal(said[g[0]], g[2], `评价 ${g[0]}`));
  // 跑团：每人另加「队伍最高等级 × N ÷ 上场人数」
  const tl = lines.find(l => l.startsWith("跑团和长线养成"));
  const N = Number((tl.match(/队伍最高等级 × (\d+) ÷ 上场人数/) || [])[1]);
  assert.ok(N > 0, tl);
  const st = battle(c, ["ruby", "kolt", "tou"]);
  c.setXpRequirementScale(1000);
  c.S.TRPG.active = true;
  const heroes = st.units.filter(u => u.isPlayer && !c.isWeaponUnit(u));
  heroes[0].level = 6; heroes[1].level = 3; heroes[2].level = 1;
  const r = c.settleBattleRewards("win");
  heroes.forEach(u => assert.equal((r.trpgXp.find(x => x.name === u.name) || {}).xp, Math.floor(6 * N / heroes.length), u.name));
  c.S.TRPG.active = false;
  c.setXpRequirementScale(1);
  // 遭遇战、单人模式
  const A = run(c, "ROGUE_CONFIG.ambush.xpPerLevel"), S = run(c, "ROGUE_SOLO.battleXp");
  assert.ok(lines.some(l => l.includes(`每人另加 ${A} × 敌人等级`) && l.includes(`单人模式每场胜利另加 ${S}`)));
  run(c, "ROGUE_CONFIG.ambush.xpPerLevel = 77");
  assert.ok(section(chapter(c, "level"), "经验").lines.some(l => l.includes("每人另加 77 × 敌人等级")));
});

test("检定：种族特长照 RACE_CHECK_PERKS 的字段写（猫只有侦察、躲藏优势），和 checkPerksFor 一致；跑团的熟练项由主持人记在角色卡上", () => {
  const c = loadRules();
  const e = chapter(c, "check");
  const perks = run(c, "RACE_CHECK_PERKS");
  const lines = section(e, "种族").lines;
  const known = ["adv", "dis", "reroll", "softFail", "lowHpDis", "text"];
  Object.keys(perks).forEach(r => {
    Object.keys(perks[r]).forEach(k => assert.ok(known.includes(k), `${r} 的新字段 ${k}：规则页要跟着写`));
    const l = lines.find(x => x.startsWith(r));
    assert.ok(l, r);
    const p = perks[r];
    if ((p.adv || []).length) assert.ok(l.includes(`${p.adv.join("、")}检定优势`), l);
    if ((p.dis || []).length) assert.ok(l.includes(`${p.dis.join("、")}检定劣势`), l);
    assert.equal(/血量低于一半时所有检定劣势/.test(l), !!p.lowHpDis, l);
    assert.equal(/检定失败后重掷一次/.test(l), !!p.reroll, l);
    assert.equal(/检定失败时受的伤减半/.test(l), !!p.softFail, l);
  });
  const cat = lines.find(l => l.startsWith("猫类人-猫"));
  assert.doesNotMatch(cat, /潜行/, "熟练项里没有潜行");
  // 猫类人-猫（结人）：侦察、躲藏有优势，聆听没有
  assert.equal(c.checkPerksFor("yuito", "侦察", false).adv, true);
  assert.equal(c.checkPerksFor("yuito", "躲藏", false).adv, true);
  assert.equal(c.checkPerksFor("yuito", "聆听", false).adv, false);
  assert.match(section(e, "熟练项").lines.join("\n"), /跑团里熟练项由主持人记在角色卡上/);
  assert.match(section(chapter(c, "level"), "每一级得到什么").note, /跑团里属性点、专长、职责技能照这张表，熟练项由主持人记在角色卡上/);
});

test("检定：战斗里的几种检定（空隙、冻土、改写炮台、上下车）照配置表写；制作也用这张成功率表", () => {
  const c = loadRules();
  const where = section(chapter(c, "check"), "在哪里检定").lines.join("\n");
  const K = run(c, "ROGUE_CHECKS"), name = (i) => K.diffs[Object.keys(K.diffs)[i]].name;
  const ck = (o) => `${name(o.diff)}「${o.prof}」`;
  const V = run(c, "VOID_CROSS"), T = run(c, "TURRET_HACK"), VR = run(c, "VEHICLE_RULES");
  assert.ok(where.includes(`越过空隙要过${ck(V)}检定`), where);
  assert.ok(where.includes(`改写防卫炮台要过${ck(T)}检定`), where);
  assert.ok(where.includes(`上车要过${ck(VR.boardCheck)}检定`), where);
  assert.ok(where.includes(`把人拉下车要过${ck(VR.pullCheck)}检定`), where);
  assert.match(where, /制作道具也按这张表算成功率/);
  run(c, "TURRET_HACK.diff = 1");
  assert.ok(section(chapter(c, "check"), "在哪里检定").lines.join("\n").includes(`改写防卫炮台要过${name(1)}「${T.prof}」检定`));
});

test("移动：危墙 / 关着的门挡移动（推、拉也过不去）；被推过空隙的地面单位坠落；不稳桥梁——文字和实际结算一致", () => {
  const c = loadRules();
  const e = chapter(c, "move");
  const move = section(e, "移动").lines.join("\n");
  assert.match(section(e, "挡在中间的东西").lines.join("\n"), /危墙、关着的机关门：摧毁 \/ 打开之前过不去（自己走、被推 \/ 拉都一样/);
  assert.match(move, /不稳桥梁：地面单位每过一次（自己走、被推 \/ 拉都算），桥的耐久 −1d6/);
  assert.match(move, /专长「跃迁」/);
  const fall = Number((move.match(/被推 \/ 拉过空隙的地面单位会坠落：失去最大生命的 (\d+)%，留在原区/) || [])[1]);
  assert.ok(fall > 0, move);
  const st = battle(c, ["kolt"], [{ id: "thug_knife", lv: 1, zone: 1 }]);
  const kolt = c.findKit("kolt", st.units);
  kolt.zone = 1; kolt.flying = false;
  st.gaps["1-2"] = { type: "wall", hp: 5 };
  assert.equal(c.displaceTo(kolt, 2, [], "测试"), false, "危墙推不过去");
  assert.equal(kolt.zone, 1);
  st.gaps["1-2"] = { type: "void" };
  const hp = c.totalHp(kolt), max = c.totalMaxHp(kolt);
  assert.equal(c.displaceTo(kolt, 2, [], "测试"), false);
  assert.equal(kolt.zone, 1, "留在原区");
  assert.equal(hp - c.totalHp(kolt), Math.floor(max * fall / 100), "坠落失去最大生命的这个比例");
});

test("单人模式的支援消耗照 skillCost（不读没人用的 ROGUE_SOLO.supportCost）；短休花的时间和 ledgerShortRest 实际推进的一致", () => {
  const c = loadRules();
  const solo = () => section(chapter(c, "solo"), "和普通单局不同的地方").lines.join("\n");
  assert.ok(solo().includes(`支援：花 ${c.rbCost(c.skillCost("solo_support"))}叫一名伙伴登场`), solo());
  run(c, "ROGUE_SOLO.supportCost = 9");
  assert.doesNotMatch(solo(), /花 9 行动点/, "游戏里扣的不是这个值");
  assert.ok(allText(chapter(c, "rest")).includes(`花 ${run(c, "ROGUE_CONFIG.hours.shortRest")} 小时，恢复`));
  battle(c, ["ruby"]);
  const h0 = Number(c.LEDGER.hours) || 0;
  c.ledgerShortRest(null, []);
  assert.equal((Number(c.LEDGER.hours) || 0) - h0, run(c, "ROGUE_CONFIG.hours.shortRest"), "规则页读的短休时长就是实际推进的时间");
});

test("小处：主线期限、武器自己升到几级、装甲减伤就是克制表那一列、多段攻击的伤害骰、武器人不能协助攻击、起身后治疗无效、近程打飞行的例外、诊所价格、绯秋两把刀", () => {
  const c = loadRules();
  const T = (id) => allText(chapter(c, id));
  assert.match(T("time"), /剩下的天数不够做主线时，本局直接结束，不用等到最后一天/);
  assert.doesNotMatch(T("time"), /期限到了还没完成/);
  assert.ok(T("parts").includes(`跑团里自己在工作站最多升到 ${run(c, "HANDBOOK_WEAPON_UPGRADE.selfMaxLevel")} 级`));
  // 装甲的「25% 减伤」就是克制表装甲那一列（除了酸、冰都是 −25%），不另外再减
  assert.match(T("layers"), /装甲写的「25% 减伤」就是克制表装甲那一列的 −25%，不另外再减一次/);
  const CH = run(c, "CHART");
  Object.keys(CH).forEach(el => assert.equal(CH[el].armor, el === "acid" ? 0.5 : el === "ice" ? 0 : -0.25, el));
  assert.match(T("damage"), /伤害骰整次攻击只掷一次，每一段加同一个点数/);
  assert.match(T("turn"), /晕眩标记/);
  assert.match(T("assist"), /武器人自己不能发动协助攻击/);
  assert.match(T("down"), /一般的治疗也无效/);
  assert.match(T("economy"), /范围攻击、协助攻击、借机攻击，以及攻击者自己也在飞时不用付/);
  assert.ok(T("cyber").includes(`每点 ${run(c, "ROGUE_CLINIC.cyberPerHp")} 奎支`));
  assert.doesNotMatch(T("cyber"), /单局每点/);
  ["atk", "block", "durability"].forEach(id => assert.match(T(id), /绯秋/, id));
  // 绯秋分出丹生谷：手里换成鳴門，格挡加成按鳴門算
  const st = battle(c, ["hiaki"]);
  const hiaki = c.findKit("hiaki", st.units);
  c.spawnWeapon(hiaki, "niu");
  assert.equal(c.heldWeaponBlockBonus(hiaki), run(c, "WEAPON_BLOCK_BONUS").naruto);
});

/* ---------- 界面 ---------- */
function loadUI(c) {
  // 和浏览器一样：bestiary-ui.js 和规则文件在同一个全局里
  c.window = c.window || {};
  return vm.runInContext(fs.readFileSync(path.join(H.ROOT, "bestiary-ui.js"), "utf8") + "\n;Bestiary", c, { filename: "bestiary-ui.js" });
}

test("界面：图鉴多了「规则」这一本；章节详情画出每一节的列表、表格和说明，文字都转义", () => {
  const c = loadRules(), B = loadUI(c);
  assert.ok(B.modes.some(([k, n]) => k === "rules" && n === "规则"));
  const e = chapter(c, "check");
  const html = B.rulebookHtml(e);
  assert.match(html, /规则 · 基础/);
  assert.match(html, /<h4>检定<\/h4>/);
  assert.match(html, /<table class="rx-table">/);
  e.sections.forEach(s => assert.ok(html.includes(`<span>${s.title}</span>`), s.title));
  const evil = B.rulebookHtml({ name: "<img src=x>", groupName: "基础", blurb: "a&b", sections: [{ title: "t<", lines: ["<script>x</script>"], table: { head: ["<th>"], rows: [["<td>"]] }, note: "<i>n</i>" }] });
  assert.doesNotMatch(evil, /<img|<script|<i>/);
  assert.match(evil, /&lt;script&gt;/);
  assert.match(evil, /a&amp;b/);
});

test("界面：「：」前面的短标签加粗，括号里的「：」不算（「瑞比（角色卡：…）」不会只加粗半个括号）", () => {
  const c = loadRules(), B = loadUI(c);
  const html = B.rulebookHtml({ name: "t", groupName: "基础", blurb: "", sections: [{ title: "s", lines: [
    "瑞比（角色卡：力量 6、体质 5）拿着「明特」：", "猫类人-猫（夜视）：侦察、躲藏检定优势", "回合开始：结算场地效果"] }] });
  assert.doesNotMatch(html, /<b>瑞比（角色卡<\/b>/);
  assert.match(html, /<b>猫类人-猫（夜视）<\/b>：侦察/);
  assert.match(html, /<b>回合开始<\/b>：结算/);
  // 真的章节里：例子那一行不加粗半个括号
  assert.doesNotMatch(B.rulebookHtml(chapter(c, "atk")), /<b>[^<]*（角色卡<\/b>/);
});

test("入口：标题、单局顶栏、跑团顶栏的「图鉴」旁边都有「规则」，点了打开图鉴的「规则」这一本；规则文件按顺序加载", () => {
  const read = f => fs.readFileSync(path.join(H.ROOT, f), "utf8");
  const html = read("game.html");
  const next = (a, b) => {
    const i = html.indexOf(`id="${a}"`), j = html.indexOf(`id="${b}"`);
    assert.ok(i > 0 && j > i && html.slice(i, j).split("<button").length === 2, `${b} 紧挨在 ${a} 后面`);
  };
  next("t-codex", "t-rules"); next("run-bestiary", "run-rules"); next("tr-bestiary", "tr-rules");
  assert.match(read("screens.js"), /\$\("t-rules"\)[^\n]*Bestiary\.open\(\{ mode: "rules"/);
  assert.match(read("rogue-ui.js"), /\$\("run-rules"\)\.onclick[\s\S]{0,200}?Bestiary\.open\(\{ mode: "rules"/);
  assert.match(read("trpg-ui.js"), /\$\("tr-rules"\)\.onclick[\s\S]{0,200}?Bestiary\.open\(\{ mode: "rules"/);
  const at = (f) => html.indexOf(`src="${f}"`);
  assert.ok(at("codex.js") > 0 && at("codex.js") < at("rulebook.js") && at("rulebook.js") < at("bestiary-ui.js"), "加载顺序");
});

/* ---------- 真浏览器（没装 Playwright 时跳过） ---------- */
function findPlaywright() {
  try { return require("playwright"); } catch (_) {}
  try { return require(path.join(execSync("npm root -g", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(), "playwright")); } catch (_) {}
  return null;
}
const pw = findPlaywright();
let browser;
test.before(async () => { try { if (pw) browser = await pw.chromium.launch(); } catch (e) { browser = null; } });
test.after(async () => { if (browser) await browser.close(); });

test("画面：标题画面点「规则说明」打开图鉴的「规则」，能按分类筛、能搜，点开看章节", async t => {
  if (!browser) { t.skip("Playwright/browser unavailable"); return; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await require("./old-screen")(context);   // #316：新画面默认开，这里测的是旧画面
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve(__dirname, "..", "game.html")).href);
  await page.click("#t-rules");
  assert.equal(await page.textContent(".bx-head h3"), "规则说明");
  const total = await page.$$eval(".bx-grid .bx-card", ns => ns.length);
  assert.equal(total, await page.evaluate(() => rulebookEntries().length));
  await page.click('.bx-tabs [data-filter="growth"]');
  const growth = await page.$$eval(".bx-grid .bx-card", ns => ns.length);
  assert.ok(growth > 0 && growth < total);
  await page.click('.bx-tabs [data-filter="all"]');
  await page.fill(".bx-search", "改装率");
  await page.click(".bx-grid .bx-card");
  const detail = await page.textContent(".bx-detail");
  assert.match(detail, /改造率上限/);
  assert.doesNotMatch(detail, /坚毅(生命)?\s*[+−-]?\s*\d/);
  assert.equal(await page.$$eval(".bx-detail table.rx-table", ns => ns.length) > 0, true);
  await page.click('.bx [data-mode="hero"]');
  assert.equal(await page.textContent(".bx-head h3"), "角色图鉴");
  await page.click('.bx [data-mode="rules"]');
  assert.equal(await page.textContent(".bx-head h3"), "规则说明");
  assert.deepEqual(errors, []);
});
