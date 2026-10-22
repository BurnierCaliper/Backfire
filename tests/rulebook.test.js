// 规则说明（rulebook.js，issue #263）：图鉴第六本「规则」。章节里的数值都在打开时从规则表 / 规则函数现读，
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
  Object.keys(perks).forEach(r => assert.ok(text.includes(`${r}：${perks[r].text}`), r));
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
  const T = run(c, "CYBERWARE_TIER"), tiers = run(c, "CYBERWARE_TIERS");
  const tb = section(e, "义体").table;
  tiers.forEach((t, i) => assert.deepEqual(plain(tb.rows[i]), [`${t} 级`, `−${T[t].hpCut}`, pct(T[t].occupancy)]));
  const at = section(e, "攻击义体").table;
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
  assert.equal(section(e2, "义体").table.rows[0][1], "−6");
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
