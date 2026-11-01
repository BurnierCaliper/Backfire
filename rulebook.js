/* Antlerscale: Backfire · 规则说明（教程 / 规则说明页，issue #263）
 *
 * 图鉴（bestiary-ui.js）顶上的第七本「规则」：回合、行动点、检定、伤害、武器 ATK、义体改造率、休息……
 * 不用解锁，一直都能查；标题画面、单局顶栏、跑团顶栏「图鉴」旁边的「规则」按钮直接打开这一本。
 *
 * 一章是 RULEBOOK_CHAPTERS 里的一行：{ id, group, name, blurb, keywords?, build() }，
 *   build() 返回几节：[{ title, lines?: [文字], table?: { head: [...], rows: [[...]] }, note? }]。
 *   加新章节：在 RULEBOOK_CHAPTERS 里加一行（分类在 RULEBOOK_GROUPS），界面不用改。
 * 数值一律在 build() 里现读规则表 / 规则函数（ROGUE_CHECKS、WEAPON_FORMULA、CYBERWARE_TIER、exhaustTierFromHours……），
 *   改了数值这里跟着变；写成文字的公式由 tests/rulebook.test.js 和规则函数逐项核对，改了算法记得一起改文字。
 * 手写的规则说明以代码的实际结算为准（不是手册、不是战斗日志的说法）：拿不准就去看结算函数，测试也拿实际结算对照文字。
 * 不读任何单位的状态：技能消耗用 rbBaseCost（专长会按选中的人改消耗，算的时候临时清掉 state.attackerId）。
 * 某一章用到的数据没加载（或者出错）只影响这一章：显示 RULEBOOK_BROKEN，别的章照常。
 * 红线：坚毅生命（shp）只写规则，不写任何数值——剩余、上限、加成、消耗多少都不写（玩家手册：坚毅生命对玩家不可见）。 */
"use strict";

/** 分类：顺序就是图鉴里标签的顺序 */
const RULEBOOK_GROUPS = [
  { id: "basic", name: "基础" },       // 回合、行动点、移动、检定、单人模式
  { id: "combat", name: "战斗" },      // 伤害、血量层、架势、协助、倒地
  { id: "growth", name: "成长" },      // 属性、武器 ATK、改装、耐久、义体、升级
  { id: "rest", name: "休息与时间" }   // 休息、力竭、撤退
];
const RULEBOOK_BROKEN = "这一章用到的数据没有加载完整，暂时显示不了。";
/** 熟练等级的叫法（检定成功率表的行） */
const RULEBOOK_PROF_LEVEL = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
/** 长休消耗表的种族名（ledger.js · LONG_REST_COST 的键） */
const RULEBOOK_RACE_NAME = { human: "人类", red: "红皮人", canine: "犬类人", feline: "猫类人", rodent: "鼠类人", bovine: "牛类人", beast: "兽人" };

/* ---------- 小工具 ---------- */
/** 0.125 → "12.5%"，0.5 → "50%" */
function rbPct(v) { return Math.round((Number(v) || 0) * 1000) / 10 + "%"; }
/** 带正负号：+25% / −25% / ±0%（和效果图鉴、克制表一样） */
function rbSigned(v) { return codexPct(Number(v) || 0); }
/** 1/3 这种倍率写成分数 */
function rbFrac(v) {
  const n = Number(v) || 0, inv = n ? 1 / n : 0;
  return inv > 1 && Math.abs(inv - Math.round(inv)) < 1e-9 ? `1/${Math.round(inv)}` : String(Math.round(n * 1000) / 1000);
}
/** 技能消耗 { ap, bonus } → "1 行动点 + 1 附赠动作" */
function rbCost(c) {
  c = c || {};
  const out = [];
  if (c.ap) out.push(`${c.ap} 行动点`);
  if (c.bonus) out.push(`${c.bonus} 附赠动作`);
  return out.join(" + ") || "不花行动";
}
/** 技能的基础消耗：不看当前选中的单位。专长（人器一心……）会按 state.attackerId 改消耗，规则页不读任何单位的状态，
 *  所以算的时候临时清掉选中的人，算完马上还原 */
function rbBaseCost(id) {
  const st = typeof state !== "undefined" && state ? state : null;
  if (!st) return skillCost(id);
  const prev = st.attackerId;
  st.attackerId = null;
  try {
    return skillCost(id);
  } finally {
    st.attackerId = prev;
  }
}
/** 一组技能的消耗都一样就写出来，不一样请看技能说明 */
function rbSameCost(ids) {
  const texts = Array.from(new Set(ids.map(id => rbCost(rbBaseCost(id)))));
  return texts.length === 1 ? texts[0] : "看各自的技能说明";
}
/** 一项检定 { prof, diff }（diff 是 ROGUE_CHECKS.chance 的列，0 = 简单）→ 简单「运动」 */
function rbCheckText(c) {
  const k = Object.keys(ROGUE_CHECKS.diffs)[c.diff];
  return `${k ? ROGUE_CHECKS.diffs[k].name : ""}「${c.prof}」`;
}
/** 种族的检定特长：照 RACE_CHECK_PERKS 的字段写（数据里的 text 只取「：」前面的名字，后面的说明不一定和字段一致） */
function rbRacePerk(race, p) {
  const name = String(p.text || "").indexOf("：") > 0 ? String(p.text).split("：")[0] : "";
  const out = [];
  if ((p.adv || []).length) out.push(`${p.adv.join("、")}检定优势`);
  if ((p.dis || []).length) out.push(`${p.dis.join("、")}检定劣势`);
  if (p.lowHpDis) out.push("血量低于一半时所有检定劣势");
  if (p.reroll) out.push("检定失败后重掷一次");
  if (p.softFail) out.push("检定失败时受的伤减半");
  return `${race}${name ? `（${name}）` : ""}：${out.join("；")}`;
}
/** 战斗评价的经验倍率（app.js · SCORE_GRADES）："B ×1.2、A ×1.5、S / SS / SSS ×2；C、D 不加" */
function rbGradeXp() {
  const G = SCORE_GRADES;   // 高到低：[评价, 固定线, 经验倍率, 基准分倍数]
  const mults = Array.from(new Set(G.map(g => g[2]))).sort((a, b) => a - b);
  const up = mults.filter(m => m > 1).map(m => `${G.filter(g => g[2] === m).map(g => g[0]).reverse().join(" / ")} ×${m}`);
  const flat = G.filter(g => g[2] <= 1).map(g => g[0]);
  return up.join("、") + (flat.length ? `；${flat.join("、")} 不加` : "");
}
/** 射程 { min, max }（engine.js · SKILL_RANGE 的写法）→ 同区 / 距离 1 / 距离 1–2 */
function rbReach(r) {
  if (!r) return "";
  if (!r.max) return "同区";
  return r.min === r.max ? `距离 ${r.min}` : `距离 ${r.min}–${r.max}`;
}
/** 角色卡（有六维属性的）和各自的武器 */
function rbHeroes() {
  return livePartyCards().filter(c => c.attrs && !c.weaponOf).map(c => ({ kit: c.kit, name: c.name, attrs: c.attrs,
    weapons: (c.linkedKits || (typeof defaultLinkedKits === "function" ? defaultLinkedKits(c.kit) : [])).slice() }));
}
/** 杂兵 / 精英 / 首领最常见的行动预算（个别敌人另有规定，看敌人图鉴） */
function rbEnemyBudget(rank) {
  const count = {};
  Object.keys(ENEMY_RANK).filter(k => ENEMY_RANK[k] === rank).forEach(k => {
    const b = enemyActBudget({ kit: k });
    const key = b.ap + "/" + b.bonus;
    count[key] = (count[key] || 0) + 1;
  });
  const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || "1/0";
  const [ap, bonus] = best.split("/").map(Number);
  return { ap, bonus };
}
function rbBudgetText(b) { return `${b.ap} 行动点${b.bonus ? ` + ${b.bonus} 附赠动作` : "、没有附赠动作"}`; }
/** 力竭第 tier 档从距上次长休几小时开始（量 app.js · exhaustTierFromHours） */
function rbExhaustHours(tier) {
  for (let h = 0; h <= 1000; h++) if (exhaustTierFromHours(h) >= tier) return h;
  return null;
}
/** 升级所需经验：[["1 → 2", 跑团 / 长线养成, 单局]]。要临时换经验倍率，算完一定还原 */
function rbXpRows() {
  const prev = XP_REQ_SCALE, out = [];
  try {
    for (let lv = 1; lv < 100; lv++) {
      setXpRequirementScale(1);
      const raw = xpToNext(lv);
      if (!raw) break;
      setXpRequirementScale(ROGUE_CONFIG.xpReqScale);
      out.push([`${lv} → ${lv + 1}`, String(raw), String(xpToNext(lv))]);
    }
  } finally {
    setXpRequirementScale(prev);
  }
  return out;
}
/** 升级奖励（rogue-data.js · ROGUE_LEVEL_REWARDS 的一项）写成一句话 */
function rbRewardText(r) {
  if (r.type === "attr") return "1 点属性" + (r.noRepeat ? "（不能加在之前加过的那一项上）" : "");
  if (r.type === "role") return "一项职责技能";
  if (r.type === "prof") return "一个熟练项";
  if (r.type === "note" && r.key === "feat") return "一项专长";
  if (r.type === "note") return `${r.text}（系统尚未实装）`;
  return r.text || r.type;
}
/** 职责路线（growth.js · roleChoicesAt）："5 级副职责 1 号 → 10 级主职责 2 号 → …" */
function rbRolePath(spec) {
  const u = { roles: { primary: "P", secondary: spec ? "P" : "S" } };
  return ROLE_MILESTONES.map(m => {
    const o = (roleChoicesAt(u, m) || [])[0];
    return o ? { m, main: o.role === "P", n: o.n } : null;
  }).filter(Boolean);
}

/* ---------- 章节 ---------- */
const RULEBOOK_CHAPTERS = [
  /* ===== 基础 ===== */
  { id: "turn", group: "basic", name: "回合流程", blurb: "每回合：回合开始 → 我方回合 → 敌人回合 → 回合结束。",
    keywords: ["结束回合", "行动顺序"],
    build() {
      const instants = Object.keys(INSTANT_NAME).map(k => INSTANT_NAME[k]).join("、");
      return [
        { title: "一个回合", lines: [
          `回合开始：结算场地效果（火场、酸液地面、治愈场地、能量场……）和自我效果；沙尘层恢复；一整个回合没挨过打的护盾回满；只管一回合的即时效果（${instants}）在这时结束。`,
          "我方回合：每个我方单位（角色和场上的武器人）拿到这一回合的行动点和附赠动作，按自己定的顺序行动；点「结束回合」轮到敌人。联机时每回合开始先在「行动顺序」画面给自己的单位选格子。",
          "敌人回合：敌人照各自的行动方式行动（见敌人图鉴）。",
          "回合结束：持续状态结算（灼烧、腐蚀、冻伤、感电……），坚挺、振奋这类只管一回合的效果结束，然后进入下一回合。"
        ] },
        { title: "跳过回合", lines: [
          "晕眩（架势被打空、失衡）：到自己那一方的回合开始时解除晕眩、架势回满，但这一回合没有行动点和附赠动作。" +
            `首领和 ${ELITE_RULE_MIN_LEVEL} 级起的精英要攒满晕眩标记才真正晕眩（见「架势、击破与失衡」）。`,
          "遭遇战（单局里长休时被偷袭）：我方跳过第一回合，没有行动点和附赠动作。"
        ] }
      ];
    } },
  { id: "economy", group: "basic", name: "行动点与附赠动作", blurb: "每回合 1 行动点 + 1 附赠动作，花在技能、移动、道具和协助上。",
    keywords: ["行动点", "附赠"],
    build() {
      const solo = typeof ROGUE_SOLO !== "undefined" ? ROGUE_SOLO.apPerRound : null;
      const heroes = rbHeroes();
      const summon = rbSameCost(heroes.map(h => h.kit + "_summon"));
      const back = rbSameCost([].concat(...heroes.map(h => h.weapons)).map(k => k + "_return"));
      const minion = rbEnemyBudget("minion"), elite = rbEnemyBudget("elite"), boss = rbEnemyBudget("boss");
      const big = elite.ap === boss.ap && elite.bonus === boss.bonus
        ? [`精英和首领每回合 ${rbBudgetText(elite)}，只用附赠动作移动。`]
        : [`精英每回合 ${rbBudgetText(elite)}，首领每回合 ${rbBudgetText(boss)}，都只用附赠动作移动。`];
      return [
        { title: "每回合有多少", lines: [
          `每个我方单位（角色和场上的武器人）每回合有 1 行动点、1 附赠动作${solo ? `；单人模式的主角是 ${solo} 行动点` : ""}。没用完的不会留到下回合。`,
          "能量场：站在里面的单位每回合 +1 行动点。",
          "沙暴：顺风的地面单位 +1 附赠动作，顺风的飞行单位 +1 行动点，逆风的飞行单位 −1 行动点。",
          "不稳：这一回合附赠动作 −1（所有附赠加成算完再扣，包括剑术+ 留下的、敌人的载具驾驶员最少 1 个；最少 0；和空手格挡的 −1 叠加）。晕眩：这一回合什么都没有。"
        ] },
        { title: "花在哪里", lines: [
          "技能：每个技能都写着消耗——行动点、附赠动作、两样都要，或者不花。",
          `移动：走到相连的一个区花 ${rbCost(moveBaseCost({}))}（见「移动与距离」）。`,
          "战斗中用道具：花 1 附赠动作（道具没用出去不扣；濒死时不能用道具）。",
          `唤出武器人：${summon}；武器人变回武器：${back}（武器人自己出）。`,
          "协助格挡花 1 附赠动作；协助攻击不花（见「协助格挡」「协助攻击」）。",
          "在同一个区攻击飞行单位（近程）：要额外再花 1 附赠动作（同一次行动只付一次），付不起就打不到；范围攻击、协助攻击、借机攻击，以及攻击者自己也在飞时不用付。"
        ] },
        { title: "敌人", lines: [
          `杂兵每回合 ${rbBudgetText(minion)}，移动也花行动点。`
        ].concat(big, ["个别敌人另有规定（例如指挥官一回合动好几次），看敌人图鉴。"]) }
      ];
    } },
  { id: "move", group: "basic", name: "移动与距离", blurb: "战场分成几个区，一次走一个相连的区；射程按隔几步算。",
    keywords: ["射程", "距离", "区"],
    build() {
      const boards = Object.keys(BOARD_LAYOUTS).map(k => BOARD_LAYOUTS[k].name).join("、");
      return [
        { title: "区与距离", lines: [
          `战场分成几个区，排法有：${boards}。`,
          "距离 = 从一个区走到另一个区要走几步：同一个区距离 0，相连的区距离 1。",
          "射程照技能说明写的算：「同区」「近距离」只打同一个区；「距离 1」打正好隔 1 步的区；「距离 1 以内」同区和隔 1 步的都行；「距离 1–2」打隔 1 到 2 步的；「任意距离」不限。"
        ] },
        { title: "移动", lines: [
          `一次只能走到相连的一个区，我方单位每走一次花 ${rbCost(moveBaseCost({}))}；远的区要分几次走。`,
          "离开有会借机攻击的敌人的区，会被追打一下（哪些敌人会，看敌人图鉴）。",
          "离开酸液地面：改花 1 行动点（飞行单位照常）。",
          `越过空隙：地面单位自己走要花 1 行动点，还要过${rbCheckText(VOID_CROSS)}检定，失败就留在原区（行动点照扣）；技能里自己走的那一步过不去。` +
            "飞行单位直接飞过去；写着跳过去的技能（例如年糕的猛扑、专长「跃迁」）也能越过。",
          "被推 / 拉过空隙的地面单位会坠落：失去最大生命的 10%，留在原区。",
          "不稳桥梁：地面单位每过一次（自己走、被推 / 拉都算），桥的耐久 −1d6；桥塌了就变成空隙，正在过的人坠落（失去最大生命的 10%，留在原区）。飞行单位不受影响。",
          "离开冻土：要过简单难度的「运动」检定，失败就留在原区并受冰属性击破；走进冻土也会受冰属性击破。飞行单位不受影响。",
          "深渊：地面单位不能自己走进去。",
          "晕眩、被禁足、霜结、被缠住，或者在流沙里陷到 2 层以上时，自己走不了。",
          "倒地起身时可以免费翻滚到相邻的区：不花点、不触发反应、不受场地影响（见「倒地、起身与死亡」）。"
        ] },
        { title: "挡在中间的东西", lines: [
          "危墙、关着的机关门：摧毁 / 打开之前过不去（自己走、被推 / 拉都一样，飞行单位也一样），也打不到对面、不能隔着它们协助攻击（见配置物图鉴）。",
          "高地：从高地打低地的远程攻击伤害 +25%，反过来 −25%（见效果图鉴「高地」）。"
        ] }
      ];
    } },
  { id: "check", group: "basic", name: "检定", blurb: "掷 d100，点数不超过成功率就成功；成功率看熟练等级和难度。",
    keywords: ["熟练", "优势", "劣势", "d100"],
    build() {
      const K = ROGUE_CHECKS, diffs = Object.keys(K.diffs), name = (d) => K.diffs[d].name;
      const rows = K.chance.map((row, i) => [RULEBOOK_PROF_LEVEL[i] || `${i} 级熟练`].concat(diffs.map((d, j) => (row[j] > 0 ? rbPct(row[j]) : "不能尝试"))));
      const R = ROGUE_LEVEL_REWARDS;
      const profLv = Object.keys(R).map(Number).sort((a, b) => a - b).filter(L => R[L].some(r => r.type === "prof"));
      const profMore = profLv.filter(L => R[L].filter(r => r.type === "prof").length > 1).map(L => `${L} 级给 ${R[L].filter(r => r.type === "prof").length} 次`);
      const dmg = K.injure.dmgByAct.slice(0, ROGUE_CONFIG.acts).map((d, i) => `第 ${i + 1} 幕 ${d[0]}–${d[1]} 点`).join("、");
      const B = typeof ROGUE_BOUNTY !== "undefined" ? ROGUE_BOUNTY : null;
      return [
        { title: "成功率", table: { head: ["熟练"].concat(diffs.map(name)), rows },
          note: `难度分 ${diffs.map(name).join(" / ")} ${diffs.length} 档，由任务或主持人定。` },
        { title: "怎么掷", lines: [
          "掷一颗 d100，点数 ≤ 成功率 × 100 就成功。成功率 100% 的不用掷，直接成功；写着「不能尝试」的要先有这项熟练。",
          "优势：掷两颗，有一颗成功就算成功。劣势：两颗都要成功。同时有优势和劣势就互相抵消。"
        ] },
        { title: "种族", lines: Object.keys(RACE_CHECK_PERKS).map(r => rbRacePerk(r, RACE_CHECK_PERKS[r])) },
        { title: "熟练项", lines: Object.keys(PROFICIENCIES).map(g => `${g}：${PROFICIENCIES[g].join("、")}`).concat([
          `熟练等级最高 ${PROF_MAX} 级。升到 ${profLv.join(" / ")} 级时可以新学一项熟练，或者把已有的一项升一级${profMore.length ? `（${profMore.join("，")}）` : ""}。` +
            "跑团里熟练项由主持人记在角色卡上，检定按角色卡算。"
        ]) },
        { title: "在哪里检定", lines: [
          `单局：任务路线上的「检定」节点。成功拿奎支（${diffs.map(d => `${name(d)} ${K.diffs[d].reward}`).join("、")}）；有的检定带受伤风险，成功多拿 ${K.injure.bonus} 奎支，失败时检定者受一次随机属性的伤害（${dmg}，按克制表算，不会致死），下一场战斗开始时再受 ${K.injure.brk} 点击破。也可以不检定，直接绕过去（没有奖励，也不会受伤）。`,
          B ? `悬赏任务：路线上的线索检定一次给三种熟练项，挑一种做；成功 ${B.need} 次就找到目标，失败 ${B.failMax} 次也会直接找到。` : null,
          `战斗里：越过空隙要过${rbCheckText(VOID_CROSS)}检定，离开冻土要过简单「运动」检定；改写防卫炮台要过${rbCheckText(TURRET_HACK)}检定` +
            (typeof VEHICLE_RULES !== "undefined" ? `；上车要过${rbCheckText(VEHICLE_RULES.boardCheck)}检定，把人拉下车要过${rbCheckText(VEHICLE_RULES.pullCheck)}检定` : "") + "。",
          "制作道具也按这张表算成功率（看配方写的熟练项和难度；有同一项熟练的队友打下手给优势）。",
          "跑团：主持人定难度后掷骰。联机玩家可以点顶栏的「申请检定」，主持人同意后由房主掷，结果大家都看得到。"
        ] }
      ];
    } },
  { id: "solo", group: "basic", name: "单人模式", blurb: "一名主角 + 几名伙伴支援：主角行动点更多，能自己协助。",
    keywords: ["支援", "伙伴", "第二副职责"],
    build() {
      const S = ROGUE_SOLO;
      return [
        { title: "和普通单局不同的地方", lines: [
          `开局选一名主角和 ${S.partners} 名伙伴；伙伴平时不上场，用来支援。`,
          `主角每回合 ${S.apPerRound} 行动点；可以给自己协助格挡，也能接自己打出的失衡做协助攻击。`,
          `支援：花 ${rbCost(rbBaseCost("solo_support"))}叫一名伙伴登场，对一名敌人打一次他的协助攻击，再追加 ${S.supportBreak} 点同属性击破，然后退场；每名伙伴一场只能叫一次，等级和武器等级跟主角一样。`,
          `支援次数靠这场战斗的评分攒：门槛 ${S.supportScore} 分，手里每存着 1 次门槛 +${S.supportStep} 分，最多存 ${S.supportMax} 次，没用完的带到之后的战斗。`,
          "主角倒地不算输：还能靠坚毅生命起身就接着打，起不来才算死亡。"
        ] },
        { title: "成长", lines: [
          `每场战斗胜利额外 +${S.battleXp} 经验。`,
          `每 ${S.attrEvery} 级额外选一次六维属性（和普通的属性点叠加）。`,
          `开局另选一个角色卡上没有的职责当第二副职责，每 ${S.role2Every} 级从里面学一个技能（最多到 ${S.role2MaxSkill} 号技能）。`
        ] }
      ];
    } },

  /* ===== 战斗 ===== */
  { id: "damage", group: "combat", name: "伤害怎么算", blurb: "atk × 倍率 + 骰子，百分比加在一起再乘，翻倍 / 减半另乘，最后向下取整。",
    keywords: ["倍率", "加算", "溢出", "伤害骰"],
    build() {
      const weathers = Object.keys(WEATHER_CN).filter(w => w !== "none").map(w => {
        const parts = Object.keys(ELE).map(el => [el, weatherDamagePct(w, el)]).filter(x => x[1]).map(x => `${ELE[x[0]]} ${rbSigned(x[1])}`);
        return parts.length ? `${WEATHER_CN[w]}：${parts.join("、")}` : null;
      });
      return [
        { title: "一下攻击打多少", lines: [
          "基础 = atk × 倍率 + 固定值 + 伤害骰。技能说明里的「0.5atk」「1d6」就是倍率和伤害骰。",
          "攻击者虚弱时 atk −25%，振奋时 atk +25%（乘在 atk 上）。",
          "百分比一律加算：克制表（看这一下打到哪一层）、天气、高地、弱点特效，以及各种写成 ±% 的增伤和减伤，全部加在一起再乘到基础上，不连乘。",
          "写成「翻倍」「减半」「×N」的另外相乘：例如飞行单位受到攻击行动的伤害减半，空手格挡成功只受一半。",
          "最后向下取整，从目标最外面还有血的那一层开始扣；这一层打穿了，剩下的伤害接着扣里面一层（溢出的部分不再重新算克制）。「穿刺」从次外层开始打。",
          "多段攻击（例如「两次 0.5atk」）每一段分开算克制、分开取整；伤害骰整次攻击只掷一次，每一段加同一个点数。"
        ] },
        { title: "天气对属性伤害", lines: weathers,
          note: "这些和其他百分比加在一起。微光还会反转克制表（能量除外）。相位四个回合一循环（波谷 → 平衡 → 波峰 → 平衡）：" +
            "波谷全场伤害 −50%、击破 −1，波峰全场伤害 +50%、击破 +1，也是和其他百分比加在一起，不另外相乘。其他天气效果见效果图鉴的天气条目。" },
        { title: "击破", lines: [
          "攻击带的「N 击破」扣目标的架势（见「架势、击破与失衡」）。",
          "物理属性打在装甲上，击破 +1。"
        ] }
      ];
    } },
  { id: "layers", group: "combat", name: "血量层与克制", blurb: "从外往里一层层打；七种属性对五种血量层有克制和劣势。",
    keywords: ["克制表"].concat(typeof LAYER !== "undefined" ? Object.values(LAYER) : []),   // 层名读 engine.js · LAYER（#510：全项目只留一份）
    build() {
      const layers = Object.keys(LAYER);
      return [
        { title: "血量层", lines: [
          "一个单位可以有几层血量，从外往里排；最里面那一层打到 0 就倒下（见「倒地、起身与死亡」）。",
          "攻击先打最外面还有血的那一层，克制按这一层算。"
        ].concat(layers.map(l => `${LAYER[l]}：${CODEX_LAYER_TRAIT[l] || ""}`), [
          "装甲写的「25% 减伤」就是克制表装甲那一列的 −25%，不另外再减一次。",
          "技能、道具给的临时护盾用掉就没了，不会回满。"
        ]) },
        { title: "克制表（常态天气）", table: { head: ["属性"].concat(layers.map(l => LAYER[l])),
            rows: Object.keys(ELE).map(el => [ELE[el]].concat(layers.map(l => rbSigned((CHART[el] || {})[l])))) },
          note: "正数是克制（伤害提高），负数是劣势（伤害降低）。天气会改这张表：微光反转克制（能量除外），酸雨让装甲的减伤失效，冻土让冰对站在里面的单位易伤 25%。战斗中可以点「克制表」看当前的。" },
        { title: "起身的角色", lines: ["靠坚毅生命起身的角色挨打时不吃克制表（对所有属性都是 ±0%）。"] }
      ];
    } },
  { id: "posture", group: "combat", name: "架势、击破与失衡", blurb: "击破扣架势，扣到 0 就失衡：晕眩一回合，对面可以协助攻击。",
    keywords: ["晕眩", "冰冻", "晕眩标记"],
    build() {
      return [
        { title: "架势与击破", lines: [
          "架势代表还扛得住多少冲击。攻击带的「N 击破」扣目标 N 点架势。",
          "角色的架势上限 = ⌈4 + (耐力 − 5) ÷ 2⌉ + ⌊等级 ÷ 10⌋。",
          "物理属性打在装甲上击破 +1；有的效果会让击破增减（见效果图鉴）。"
        ] },
        { title: "失衡", lines: [
          "架势扣到 0 就失衡（晕眩）：到自己那一方的回合开始时解除晕眩、架势回满，但这一回合没有行动点和附赠动作。",
          "失衡的那一刻，对面可以挑一个单位立刻发动协助攻击（见「协助攻击」）。",
          "用冰属性击破打出的失衡会让目标冰冻：它下一次受到攻击时第一击伤害 +50%。",
          "飞行单位被打进失衡会被击落，并扣掉最大生命的 20%（见效果图鉴「飞行」）。",
          `首领、${ELITE_RULE_MIN_LEVEL} 级起的精英，以及和载具合并的驾驶员（敌我都算）：每次失衡记 1 个晕眩标记，攒满 ${BOSS_STUN_MARKS} 个才真正晕眩（到它的回合开始时跳过这一回合，标记清零）。`,
          "没攒满时：失衡马上结束、架势回满；协助攻击照样可以发动，但打到时它已经不在失衡——这一下的击破算进下一个标记，只对失衡目标才有的效果也不生效。"
        ] }
      ];
    } },
  { id: "block", group: "combat", name: "协助格挡", blurb: "同区队友花 1 附赠动作替人挡；拿武器挡住免伤，击破改由格挡者承担。",
    keywords: ["格挡率", "空手格挡", "格挡加成"],
    build() {
      const b = (dex) => bareBlockFromDex(dex);
      const rows = [];
      rbHeroes().forEach(h => h.weapons.forEach(k => {
        if (WEAPON_BLOCK_BONUS[k] != null) rows.push([h.name, weaponName(k), `+${WEAPON_BLOCK_BONUS[k]}%`]);
      }));
      return [
        { title: "谁能挡", lines: [
          "敌人攻击我方单位时，和被打的人在同一个区、还有附赠动作、没有晕眩的其他我方单位可以协助格挡，花 1 附赠动作。单人模式的主角可以给自己挡。",
          "濒死的人可以「起身并协助格挡」：先起身再挡；起不来的（力竭、坚毅生命耗尽）不能挡。",
          "第一个人没挡住，还没试过的人可以接着挡；都没挡住伤害才落下。",
          "协助攻击不能被格挡；范围攻击（打一整区的）也不能，防卫炮台的炮击、首领机制这类写明不能格挡的同样不能。",
          "夕夏的「狂怒碾压」是投技，也不能被协助格挡：第一下和每回合开始的自动碾压都直接结算（敌人的自动协助格挡也挡不了）。"
        ] },
        { title: "成功率", lines: [
          `掷 d100，点数 ≤ 成功率就挡住。成功率 = 空手格挡率 + 手里武器的格挡加成（含格挡件）+ 其他加成，最低 5%，最高 ${BLOCK_CHANCE_CAP}%。`,
          `空手格挡率 = ${b(5)}% + (敏捷 − 5) × ${b(6) - b(5)}%，最低 ${b(-100)}%，最高 ${b(100)}%。`,
          "武器分出去（武器人上场）时，角色只剩空手格挡率（绯秋分出一把刀时手里换成另一把，格挡加成按那一把算）；武器人自己格挡用自己的敏捷 + 自己的格挡加成。",
          "手里的武器本场受损过（倒下过、战斗中耐久归零、战斗中修过）：格挡加成减半。",
          "高地：站在高地上替人挡低地打来的远程攻击 +10%，反过来（高地打低地）−10%。",
          "拿着武器格挡，不管挡没挡住，这把武器耐久 −1（一发动就扣，在掷骰之前；武器人自己格挡也算）。空手格挡不扣耐久。"
        ], table: { head: ["角色", "武器", "格挡加成"], rows } },
        { title: "挡住以后", lines: [
          "拿着武器挡住：被打的人不受伤、不扣架势，这一击的击破改由格挡者承担（格挡者架势最少留 1）。",
          "空手挡住：被打的人仍受一半伤害，架势照常扣（可能被打进失衡）；格挡者下回合附赠动作 −1（最少 0，沙暴顺风等加成抵得掉）。",
          "没挡住：照常受伤。"
        ] }
      ];
    } },
  { id: "assist", group: "combat", name: "协助攻击", blurb: "有人被打进失衡，对面可以立刻打一次协助攻击，不花行动点。",
    keywords: ["失衡"],
    build() {
      return [
        { title: "协助攻击", lines: [
          "一个单位被打进失衡时，和它敌对的一方可以挑一个单位立刻发动协助攻击（每名角色的协助攻击写在角色图鉴里），不花行动点。我方被打进失衡时，敌人也会这样做。",
          "打出这次失衡的人不能接自己这一下（单人模式的主角可以）。",
          "发动的人架势回满（千钧状态下不恢复）。",
          "要拿着武器：空手的角色会把场上的武器人立刻收回来再打；收不回来（武器人倒下了、武器开战前就坏了）就不能发动。",
          "武器人自己不能发动协助攻击（由它的主人发动）。",
          "濒死没起身、晕眩中的单位不能发动；被危墙或关着的机关门隔开的也不能。",
          "协助攻击不能被协助格挡。"
        ] }
      ];
    } },
  { id: "down", group: "combat", name: "倒地、起身与死亡", blurb: "最内层归零就濒死；可以靠坚毅生命起身，坚毅生命耗尽就死亡。",
    keywords: ["濒死", "起身", "坚毅生命", "取回武器"],
    build() {
      return [
        { title: "我方角色", lines: [
          "最内层的生命打到 0：陷入濒死。濒死的人在自己起身之前不会再受到任何伤害，也不能行动、不能用道具；一般的治疗不能让人站起来（「续命」这类写明能救回濒死的除外）。",
          "起身：靠坚毅生命继续战斗，不花行动点。起身以后受到的伤害改由坚毅生命承受，不吃克制表，一般的治疗也无效；坚毅生命耗尽就死亡。",
          "起身时可以顺便免费翻滚到一个相邻的区（也可以不翻）：不花行动点和附赠，不触发借机攻击、警戒、紧追这类反应，离开 / 进入酸液地面、冻土、流沙等场地也不受影响；危墙、关着的门、空隙、深渊照样翻不过去。落地以后照常在那一区。",
          "全员倒地：队伍里所有人都倒地，但还有人能起身时不算输——这一回合结束前会依次问每个能起身的人要不要起身（也可以选翻滚），至少一个人起身就接着打，都不起身才算输。武器人、护送对象不算在里面；PvP 里按每个阵营分别看。",
          `距上次长休 ${rbExhaustHours(1)} 小时起（力竭）不能再起身；${rbExhaustHours(3)} 小时起（力竭 3）被击倒就立刻死亡。`,
          "战斗结束后，濒死或靠坚毅生命撑着的角色恢复到 1 点生命。",
          "坚毅生命的数值不会显示给玩家，休息时只会用一句话说说状态。"
        ] },
        { title: "武器人", lines: [
          "最内层打到 0 就倒下，那把武器耐久 −2。主人走到它倒下的区，花 1 行动点取回：这一场不能再唤出，武器提供的 atk 和格挡加成减半。",
          "武器人每场开战都是满血。"
        ] },
        { title: "敌人", lines: ["最内层打到 0 就被打倒。"] },
        { title: "单人模式", lines: ["主角倒地不算输：还能起身就接着打（和全员倒地一样，回合结束前会问），起不来（坚毅生命耗尽、力竭）才算死亡。"] }
      ];
    } },

  /* ===== 成长 ===== */
  { id: "attrs", group: "growth", name: "角色属性", blurb: "六维属性决定生命、atk、架势、格挡率和义体改造率上限。",
    keywords: ["力量", "体质", "敏捷", "意志", "智力", "耐力", "属性点"],
    build() {
      const b = (dex) => bareBlockFromDex(dex), cy = (int) => derivedFromAttrs({ int }, 1).cyber;
      const what = {
        str: "角色 atk = ⌈4 + (力量 − 5) ÷ 2⌉ + ⌈力量 × (等级 − 1) ÷ 7⌉",
        con: "生命上限 = 体质 × 2 + 2 + 体质 × (等级 − 1)；短休恢复也加体质",
        dex: `空手格挡率 = ${b(5)}% + (敏捷 − 5) × ${b(6) - b(5)}%（${b(-100)}%–${b(100)}%）`,
        wil: "坚毅生命（数值不公开）",
        int: `义体改造率上限 = ${cy(5)}% + (智力 − 5) × ${cy(6) - cy(5)}%（${cy(-100)}%–${cy(100)}%）`,
        sta: "架势上限 = ⌈4 + (耐力 − 5) ÷ 2⌉ + ⌊等级 ÷ 10⌋"
      };
      const R = ROGUE_LEVEL_REWARDS;
      const lv = Object.keys(R).map(Number).sort((a, b2) => a - b2).filter(L => R[L].some(r => r.type === "attr"));
      const once = lv.filter(L => R[L].some(r => r.type === "attr" && r.noRepeat));
      return [
        { title: "六维属性", table: { head: ["属性", "影响"], rows: Object.keys(what).map(k => [ATTR_NAMES[k] || k, what[k]]) },
          note: "等级是角色等级。武器 atk 还按武器的补正吃属性（见「武器 ATK」）。" },
        { title: "属性点", lines: [
          `升到 ${lv.join(" / ")} 级各得 1 点属性${once.length ? `；${once.join(" / ")} 级那一点不能加在之前加过的那一项上` : ""}。${ATTR_HARD_MAX === Infinity ? "属性没有上限。" : `属性最高 ${ATTR_HARD_MAX}。`}`
        ] }
      ];
    } },
  { id: "atk", group: "growth", name: "武器 ATK", blurb: "atk = 角色 atk + 手里武器的 atk；武器 atk 按武器等级和属性补正算。",
    keywords: ["atk", "攻击力", "补正", "等级系数"],
    build() {
      const heroes = rbHeroes();
      const rows = [];
      heroes.forEach(h => h.weapons.forEach(k => {
        if (WEAPON_FORMULA[k]) rows.push([h.name, weaponName(k), String(WEAPON_FORMULA[k].base), weaponPartCoefText(weaponCoefs(k, []))]);
      }));
      // 例子：第一名角色的第一把武器，照角色卡的属性
      const hero = heroes.find(h => h.weapons.some(k => WEAPON_FORMULA[k]));
      const ex = [];
      if (hero) {
        const kit = hero.weapons.find(k => WEAPON_FORMULA[k]);
        const attrs = Object.keys(hero.attrs).map(a => `${WEAPON_PART_ATTR_CN[a] || a} ${hero.attrs[a]}`).join("、");
        ex.push(`${hero.name}（角色卡：${attrs}）拿着「${weaponName(kit)}」：`);
        [1, 5].forEach(lv => {
          const bd = weaponAtkBreakdown(kit, hero.attrs, lv, []);
          const sum = bd.rows.map(r => `${r.name} ${r.value} × ${r.coef}`).join(" + ");
          ex.push(`武器 ${lv} 级：${bd.base} + ${bd.lvBase} + (${sum}) × ${bd.tier} = ${bd.raw} → 四舍五入 ${bd.atk}。`);
        });
        const own = derivedFromAttrs(hero.attrs, 1).personalAtk, w1 = weaponAtkBreakdown(kit, hero.attrs, 1, []).atk;
        ex.push(`${hero.name} 1 级、武器 1 级时：角色 atk ${own} + 武器 atk ${w1} = ${own + w1}。`);
      }
      return [
        { title: "角色的 atk", lines: [
          "角色的 atk = 角色 atk + 手里那把武器的 atk。",
          "角色 atk = ⌈4 + (力量 − 5) ÷ 2⌉ + ⌈力量 × (等级 − 1) ÷ 7⌉（等级是角色等级）。",
          "武器分出去变成武器人、或者空手时，角色只剩角色 atk；武器人自己的 atk 就是这把武器的 atk。",
          "绯秋有两把刀：分出一把时手里换成另一把，atk 按手里那把算，两把都分出去才只剩角色 atk。"
        ] },
        { title: "武器 atk", lines: [
          "武器 atk = 四舍五入（基础 + (武器等级 − 1) + Σ（属性 × 补正）× 等级系数）+ 改装件的固定 atk（不会低于 0）。",
          `等级系数 = ${weaponTier(1)} × 武器等级（1 级 ${weaponTier(1)}，5 级 ${weaponTier(5)}，10 级 ${weaponTier(10)}）。`,
          "补正：这把武器吃哪几项属性、每项乘多少。负补正是这项属性越高 atk 越低（改装件会带负补正）。",
          "羁绊不加 atk，只让武器的奖励提前解锁（见「改装件、羁绊与图纸」）。"
        ] },
        { title: "各武器的基础和补正", table: { head: ["角色", "武器", "基础", "补正"], rows },
          note: "武器工坊页的「ATK 工单」会按现在的属性、等级和改装件逐项列出来。" },
        { title: "算一个例子", lines: ex },
        { title: "会让 atk 变的情况", lines: [
          "武器本场倒下过（取回以后）、战斗中耐久归零，或者战斗中用维修工具包修过：武器提供的 atk 和格挡加成减半，这一场不能再唤出武器人。",
          `距上次长休 ${rbExhaustHours(2)} 小时起：${exhaustText(2)}。`,
          "虚弱：atk −25%；振奋：atk +25%（见效果图鉴）。",
          "客制化图纸可能改 atk，看图纸说明。"
        ] }
      ];
    } },
  { id: "parts", group: "growth", name: "改装件、羁绊与图纸", blurb: "武器等级 + 羁绊解锁改装槽、被动升级和客制化图纸。",
    keywords: ["改装槽", "改装件", "羁绊", "被动升级", "客制化", "工匠"],
    build() {
      const G = WEAPON_PART_GEN, U = HANDBOOK_WEAPON_UPGRADE, SR = ROGUE_SMITH_RULES;
      const mains = Object.keys(G.mains).map(a => `${G.mains[a]}（${WEAPON_PART_ATTR_CN[a]}）`).join("、");
      const grades = G.coefGrades.map(g => `${g} 级 ±${G.grades[g].step}`).join("，");
      const kinds = Object.keys(G.kinds).map(k => {
        const K = G.kinds[k], unit = k === "block" ? "%" : "";
        return `${K.name}（${k === "block" ? "格挡加成" : "武器人每级装甲"} ${Object.keys(K.grades).map(g => `${g} +${K.grades[g]}${unit}`).join(" / ")}）`;
      }).join("、");
      const flat = Object.keys(WEAPON_PART_FLAT_ATK).map(g => `${g} 级 +${WEAPON_PART_FLAT_ATK[g]}`).join("、");
      const plus = Object.keys(PASSIVE_PLUS_LEVEL).map(n => `${PASSIVE_PLUS_LEVEL[n]} 级：被动${"一二三四"[n - 1] || n}升级`).join("；");
      return [
        { title: "武器升级", lines: [
          `武器最高 ${U.maxLevel} 级。跑团里自己在工作站最多升到 ${U.selfMaxLevel} 级，再往上要找武器工匠；单局里找路线上的工匠。`,
          "武器 atk、武器人的血量和架势、耐久上限都跟着武器等级涨。"
        ] },
        { title: "改装槽和改装件", lines: [
          `武器等级 + 羁绊到 ${WEAPON_PART_SLOT_LEVELS.join(" / ")} 级各多 1 个改装槽。改装件平时放在背包里，装上从背包拿走，拆下放回背包。`,
          `补正件：${mains}，加一项主补正，同时带一个别的属性的负补正（${grades}）。`,
          `功能件：${kinds}；不加正补正，同样带一个负补正。`,
          `每个改装件另外固定加 atk（${flat}），在四舍五入之后加。`
        ] },
        { title: "羁绊", lines: [
          `羁绊是角色和自己武器的关系，0–${BOND_MAX} 级，直接加在武器等级上，只用来更早解锁武器的奖励（改装槽、被动升级、客制化），不提高 atk 和其他数值。`
        ] },
        { title: "被动升级", lines: [`武器等级 + 羁绊到 ${plus}（升级后的被动名字后面带 +，内容见角色图鉴）。`] },
        { title: "客制化图纸", lines: [
          `武器等级 + 羁绊到 ${BLUEPRINT_MIN_LEVEL} 级起才能装客制化图纸，一把武器装一张；不到 ${BLUEPRINT_MIN_LEVEL} 级的武器上装着的图纸不生效。图纸可能改 atk、架势、耐久，看各自的说明。`,
          `单局里在同一位工匠那里升级满 ${SR.blueprintAfter} 次，可以从他还没给过的图纸里挑一张；领完计数归零，再升级满 ${SR.blueprintAfter} 次可以领下一张。不会领到已经有的图纸，他的图纸都有了就不再计数。请工匠装上要 ${SR.installCost} 奎支。`
        ] }
      ];
    } },
  { id: "durability", group: "growth", name: "武器耐久与武器人", blurb: "打一场 −1、武器人倒下 −2、格挡 −1；长休回满，归零就只能空手。",
    keywords: ["耐久", "维修工具包", "唤出", "武器人"],
    build() {
      const max = HANDBOOK_WEAPON_UPGRADE.maxLevel;
      const rows = [];
      rbHeroes().forEach(h => h.weapons.forEach(k => {
        if (WEAPON_GROWTH[k]) rows.push([h.name, weaponName(k), String(weaponBaseDur(k, 1)), String(weaponBaseDur(k, max))]);
      }));
      const heroes = rbHeroes();
      const summon = rbSameCost(heroes.map(h => h.kit + "_summon"));
      const back = rbSameCost([].concat(...heroes.map(h => h.weapons)).map(k => k + "_return"));
      return [
        { title: "耐久", lines: [
          "耐久上限 = 基础耐久 + ⌊武器等级 ÷ 2⌋（客制化图纸可能改）。",
          "每场战斗结束 −1（角色已经死了的武器不扣）；武器人在战斗中被打倒 −2；拿这把武器协助格挡 −1（一发动就扣，没挡住也扣；武器人自己格挡也算，空手格挡不扣）。",
          `长休回满。维修工具包一包 ${SUPPLY_ITEMS.repair_kit.repair} 点维修量，修几点用几点，还能修好倒地的武器人。` +
            "战斗中也能修，但修好的武器这一场仍按受损算：atk 和格挡加成减半、不能再唤出武器人。",
          "耐久归零：战斗中才归零的，这一场还能用，但武器提供的 atk 和格挡加成减半、不能再唤出武器人；修好之前，下一场只能空手（绯秋换另一把刀）。"
        ], table: { head: ["角色", "武器", "1 级耐久", `${max} 级耐久`], rows } },
        { title: "武器人", lines: [
          `角色可以把武器唤出来变成武器人一起打：${summon}；武器人变回武器：${back}。武器人在场时，角色手里没有这把武器（atk 和格挡只剩角色自己的）。`,
          "绯秋的两把刀可以分别唤出：分出一把时，手里换成另一把；两把刀的武器人共用一份行动点和附赠动作。",
          "武器人有自己的行动点、附赠动作、血量层和架势（跟着武器等级成长），每场开战都是满血。",
          "武器人倒下：耐久 −2；主人走到它倒下的区花 1 行动点取回，这一场不能再唤出，武器 atk 和格挡加成减半。",
          "发动协助攻击时，在场的武器人会被立刻收回到主人手里。"
        ] }
      ];
    } },
  { id: "cyber", group: "growth", name: "义体与改造率", blurb: "改造率上限看智力；血量层改造和义体共用这个上限。",
    keywords: ["改装率", "改造率", "义体", "攻击义体", "诊所", "过度安装", "血量层改造"],
    build() {
      const cy = (int) => derivedFromAttrs({ int }, 1).cyber;
      const R = CYBER_RATIO;
      const ratio = ["flesh", "armor", "shield", "sand"].map(t => `${LAYER[t]} ${R[t]}`).join(" : ");
      const order = CYBER_OUTER.map(t => LAYER[t]).join(" → ");
      const shpTier = CYBERWARE_TIERS.filter(t => CYBERWARE_TIER[t].shpCut > 0)[0];
      const feat = typeof FEATS !== "undefined" ? FEATS[CYBERWARE_OVERINSTALL_FEAT] : null;
      // 正式目录（cyberware.js · CYBERWARE，由 CYBERWARE_LINES × 等级生成）：发动的消耗、次数、击破照目录里每一件写的
      const kind = CYBERWARE_KINDS.attack;
      const fire = cyberwareCatalog().filter(d => !d.example && d.kind === "attack");
      const same = (f) => { const v = Array.from(new Set(fire.map(f))); return v.length === 1 ? v[0] : null; };
      const uses = same(d => d.usesPerShortRest), brk = same(d => d.break);
      const reach = (range) => rbReach(kind.range({ range })).replace(/(\d)$/, "$1 ");   // 「距离 1 的」：数字后面空一格
      const lineText = (l) => {
        const k = CYBERWARE_KINDS[l.kind] || {};
        const bits = [k.name, CYBERWARE_RANGE_NAME[l.range], ELE[l.element] ? `${ELE[l.element]}属性` : ""].filter(Boolean);
        return `「${l.name}」（${bits.join("，")}）`;
      };
      return [
        { title: "改造率", lines: [
          `改造率上限 = ${cy(5)}% + (智力 − 5) × ${cy(6) - cy(5)}%，最低 ${cy(-100)}%，最高 ${cy(100)}%。`,
          "改造率 = 血量层改造的占用 + 义体的占用，两样共用这个上限。",
          "占用都按「原生命上限」算：没装义体、没改造时的肉体生命上限（看体质和等级）。诊所里看得到现在的改造率和上限。"
        ] },
        { title: "血量层改造", lines: [
          `把一部分肉体换成别的血量层，比例 ${ratio}（例：${R.flesh} 点肉体换 ${R.armor} 点装甲）。`,
          "能换的肉体最多 = 改造率上限 × 肉体生命上限，向下取整；装了义体时改成 (改造率上限 − 义体的占用) × 原生命上限，向下取整（不够就是 0）。",
          "占用 = 换掉的肉体 ÷ 原生命上限。",
          `也可以把剩下的肉体按 ${R.flesh} : ${R.spirit} 全部换成星灵，不受改造率限制。`,
          `一个角色最多 ${CYBER_MAX_TYPES} 种血量；最里面一层必须是肉体或星灵；从外往里是 ${order} → 肉体 / 星灵。`,
          `在诊所做，按改动的肉体点数收费（每点 ${ROGUE_CLINIC.cyberPerHp} 奎支，加、减都算）。`
        ] },
        { title: "义体", lines: [
          `目前有 ${CYBERWARE_LINES.length} 个系列：${CYBERWARE_LINES.map(lineText).join("、")}；每个系列分 ${CYBERWARE_TIERS.join(" / ")} 级，名字后缀 ${CYBERWARE_TIERS.map(t => `.vol${CYBERWARE_VOL[t]}`).join(" / ")}。`,
          "装上会压低生命上限，并固定占用一部分改造率：占用 = 压低的生命上限 ÷ 原生命上限 + 固定占用（下表）。",
          shpTier ? `${shpTier} 级起的义体还会压低坚毅生命上限。` : null,
          "义体不能升级：同一系列同时只能装一件，换等级要在诊所以新换旧（付旧的拆除费 + 新的价格）。",
          "没有部位 / 槽位限制，装几件只看改造率；写着冲突标签的，同标签的不能同时装。",
          "在诊所花钱安装；拆除也要花钱，但完全可逆，压低的上限会还回来。每一件的效果、价格和坚毅生命的具体消耗见图鉴「义体」。",
          // #315：等级门槛读 cyberware.js · CYBERWARE_UNLOCK_LEVEL；每档要几级读 cyberwareInstallLevel（下表最后一列）
          `角色 ${CYBERWARE_UNLOCK_LEVEL} 级起才能在诊所安装 / 拆除义体；装哪一件还要角色等级到它的档位（下表「角色几级能装」，以新换旧看新的那件），拆除不看档位。还不到 ${CYBERWARE_UNLOCK_LEVEL} 级时已经装着的义体照常生效，只是不能拆。血量层改造没有这个限制，1 级就能做。`
        ], table: { head: ["等级", "名字后缀", "生命上限", "固定占用", "角色几级能装"],
          rows: CYBERWARE_TIERS.map(t => [`${t} 级`, `.vol${CYBERWARE_VOL[t]}`, `−${CYBERWARE_TIER[t].hpCut}`, rbPct(CYBERWARE_TIER[t].occupancy), `${cyberwareInstallLevel(t)} 级`]) } },
        { title: `发动义体（${kind.name}）`, lines: fire.length ? [
          `装着的义体会出现在战斗的技能列表里；义体长在身上，空手也能用。发动花 ${rbSameCost(fire.map(d => CYBERWARE_SKILL_PREFIX + d.id))}，` +
            (uses != null ? `每次短休 ${uses} 次（短休、长休后恢复）。` : "每次短休能用几次见图鉴「义体」。"),
          `对一名敌人发动：近战打${reach("melee")}的一名、远程打${reach("ranged")}的一名，不能打友方。伤害固定（下表），不吃 atk（虚弱、振奋这类改 atk 的效果不影响），` +
            (brk != null ? `${brk} 击破。` : "击破见图鉴「义体」。"),
          "算一次攻击行动：属性克制、天气、格挡、飞行，以及挂在下一击上的效果照常结算。",
          "发动、长期装着都会消耗坚毅生命（不会致死）。"
        ] : ["目前没有能在战斗里发动的义体。"],
          table: { head: ["等级", "近战", "远程"], rows: CYBERWARE_TIERS.map(t => [`${t} 级`, cyberwareDamageSpec(t, "melee").text, cyberwareDamageSpec(t, "ranged").text]) } },
        { title: "过度安装", lines: [
          `超出改造率上限还要装，叫过度安装，要有专长${feat ? `「${feat.name}」` : "（这个专长还没加入游戏）"}才能做。`,
          `不封顶，但每超出 ${rbPct(CYBERWARE_OVER_STEP)} 每天多消耗一些坚毅生命，身体负担极大；拆掉就解除。`
        ] }
      ];
    } },
  { id: "level", group: "growth", name: "升级", blurb: "经验够了就升级：属性点、职责技能、熟练项和专长按等级给。",
    keywords: ["经验", "职责技能", "专长", "熟练项"],
    build() {
      const xp = rbXpRows();
      const R = ROGUE_LEVEL_REWARDS;
      const rewards = Object.keys(R).map(Number).sort((a, b) => a - b).map(L => {
        const texts = R[L].map(rbRewardText), seen = [];
        texts.forEach(t => { if (seen.indexOf(t) < 0) seen.push(t); });
        return [`${L} 级`, seen.map(t => { const n = texts.filter(x => x === t).length; return n > 1 ? `${t} × ${n}` : t; }).join("；")];
      });
      const pathText = (spec) => rbRolePath(spec).map(p => `${p.m} 级${p.main ? "主" : "副"}职责 ${p.n} 号`).join(" → ");
      const top = (spec) => Math.max(1, ...rbRolePath(spec).map(p => p.n));
      return [
        { title: "升级所需经验", table: { head: ["升级", "跑团 / 长线养成", "单局 / 单人"], rows: xp },
          note: `最高 ${xp.length + 1} 级。单局里升级所需经验是原来的 ${rbFrac(ROGUE_CONFIG.xpReqScale)}（向上取整）。` },
        { title: "经验", lines: [
          "打倒敌人给经验，看敌人的等级和杂兵 / 精英 / 首领。单局里每人拿全额；跑团和长线养成全队平分（向上取整）。",
          `打赢时看战斗评价：这一场的击杀经验再乘评价的倍率（${rbGradeXp()}），多出来的向下取整，没死的角色每人都拿。`,
          "跑团和长线养成：每打赢一场，没死的角色每人另加「队伍最高等级 × 20 ÷ 上场人数」（向下取整）。",
          `单局：休息点被偷袭的遭遇战打赢，每人另加 ${ROGUE_CONFIG.ambush.xpPerLevel} × 敌人等级；单人模式每场胜利另加 ${ROGUE_SOLO.battleXp}。`,
          "完成任务也给经验（写在任务上）。"
        ] },
        { title: "每一级得到什么", table: { head: ["等级", "得到"], rows: rewards },
          note: `熟练项：新学一项，或者把已有的一项升一级（最高 ${PROF_MAX} 级）。角色卡上写着解锁等级的技能，到那一级自动学会。` +
            "这张表是单局和长线养成的；跑团里属性点、专长、职责技能照这张表，熟练项由主持人记在角色卡上。" },
        { title: "职责技能", lines: [
          "开局有主职责的 1 号技能，之后按职责路线学：",
          `主副职责不同：${pathText(false)}。`,
          `主副职责相同（专精）：${pathText(true)}${top(true) > top(false) ? `；${top(true)} 号技能只有专精能学到` : ""}。`
        ] },
        { title: "专长", lines: [
          `${FEAT_LEVELS.join(" / ")} 级各选一项专长（可以选本级或更低级的），内容见专长图鉴。单局升级时直接选；跑团由主持人在队伍页分配。`
        ] }
      ];
    } },

  /* ===== 休息与时间 ===== */
  { id: "rest", group: "rest", name: "短休与长休", blurb: "短休 1 小时回一点血；长休睡一整觉回满，要吃喝。",
    keywords: ["短休", "长休", "守夜", "食物", "水", "偷袭"],
    build() {
      const H = ROGUE_CONFIG.hours, A = ROGUE_CONFIG.ambush;
      const rows = Object.keys(LONG_REST_COST).map(k => [RULEBOOK_RACE_NAME[k] || k, `${LONG_REST_COST[k].water} ml`, `${LONG_REST_COST[k].food} 份`]);
      return [
        { title: "短休", lines: [
          `花 ${H.shortRest} 小时，恢复「等级 × 2 + 体质」点生命（犬类人-犬 +${rbPct(shortRestBonus({ note: "犬类人-犬" }))}）。`,
          `每人每天 ${shortRestCap({})} 次（熊兽人 ${shortRestCap({ note: "熊" })} 次），过了 0 点刷新。`,
          "主动义体、写着「每次短休 N 次」的专长随短休刷新。"
        ] },
        { title: "长休", lines: [
          `跑团里睡 8–12 小时（主持人定），单局固定 ${H.longRest} 小时。要吃喝：每人按种族消耗水和食物（下表），吃哪种食物自己选。`,
          "长休以后：生命回满，濒死、起身的状态解除；坚毅生命慢慢恢复（好一点的食物、睡袋恢复得更多）；全部武器耐久回满；短休次数和「长休一次」的技能刷新；力竭清零。",
          "补给不够就没法长休，只能消磨时间：时间照样过，什么都不恢复。",
          "守夜：选一个人（或武器人）整夜放哨，他这次不恢复，短休次数和「长休一次」的技能也不刷新。"
        ], table: { head: ["种族", "水", "食物"], rows } },
        { title: "单局里的休息点", lines: [
          `在任务路线的休息点长休可能被偷袭：第一次 ${rbPct(A.base)}，每次没被偷袭 +${rbPct(A.step)}，被偷袭后回到 ${rbPct(A.base)}；有人守夜一定不会被偷袭。被偷袭就先打一场遭遇战（我方跳过第一回合），赢了再长休。`,
          `不想休息可以直接走，顺手打零工拿 ${ROGUE_CONFIG.restSkipKuizhi} 奎支，不花时间。按小时补出来的休息点（悬赏里强制的也是）没有零活：离开无报酬，但在那里长休不消耗水和食物。`,
          `照着任务路线走（不算短休、撤退和首领战之后），连续不长休不超过 ${ROGUE_CONFIG.hours.restGapMax} 小时：路线会在需要的地方补休息点。`,
          "任务之间回到城里休整：可以买补给、去诊所、用维修工具包。"
        ] }
      ];
    } },
  { id: "time", group: "rest", name: "时间与力竭", blurb: "距上次长休越久越危险：先是起不了身，最后力竭致死。",
    keywords: ["力竭", "小时", "期限", "主线"],
    build() {
      const tiers = [];
      for (let t = 1; exhaustText(t) && rbExhaustHours(t) != null; t++) tiers.push([`${rbExhaustHours(t)} 小时`, exhaustText(t)]);
      const N = ROGUE_NODE_TYPES, H = ROGUE_CONFIG.hours;
      const rows = [["走到下一站", `${H.travel} 小时`]]
        .concat(Object.keys(N).filter(k => N[k].hours > 0).map(k => [N[k].label, `${N[k].hours} 小时`]))
        .concat([["短休", `${H.shortRest} 小时`], ["长休", `${H.longRest} 小时`]]);
      return [
        { title: "力竭", table: { head: ["距上次长休", "状态"], rows: tiers }, lines: [
          "按距离上次长休过了多少小时算，长休一次清零；只影响角色本人，武器人不受影响。",
          `满 ${rbExhaustHours(tiers.length)} 小时全队力竭致死（单局直接结束；长线养成不会致死，全队倒头昏睡过去，时间清零）。`
        ] },
        { title: "单局里的时间", lines: [
          `每一幕 ${ROGUE_CONFIG.daysPerAct} 天；本幕的天数用完时迎战首领（主线做完以后，剩下的天数接不了任务也会直接去）。`,
          ROGUE_CONFIG.mainDeadlineEndsRun ? "主线任务要在本幕结束前完成：剩下的天数不够做主线时，本局直接结束，不用等到最后一天。" : "主线任务要在本幕结束前完成。",
          `任务要花的天数写在任务板上；任务之间的休整算 ${ROGUE_CONFIG.restDays} 天。`
        ], table: { head: ["做什么", "花多少时间"], rows } }
      ];
    } },
  { id: "retreat", group: "rest", name: "撤退", blurb: "按队伍状况分几档：花几小时、要不要断后、丢多少东西。",
    keywords: ["断后", "全员完好", "有损伤", "半数倒地"],
    build() {
      const RR = RETREAT_RULES, keys = Object.keys(RR);
      const row = (label, fn) => [label].concat(keys.map(k => fn(RR[k])));
      return [
        { title: "撤退的几档", lines: [
          "半数倒地：倒地（濒死没起身）的人数 ≥ 队伍的一半。",
          "有损伤：全员血量都 ≤ 50%，或者有人 ≤ 25%、倒地、靠坚毅生命起身。",
          "其余算全员完好。"
        ], table: { head: ["队伍状况"].concat(keys.map(k => RR[k].name)), rows: [
          row("耗时", r => `${r.hours} 小时`),
          row("断后", r => (r.rearguard ? "一人挨一次无法格挡的攻击" : "不用")),
          row("奎支", r => (r.kuizhiLoss ? `丢 ${rbPct(r.kuizhiLoss)}` : "不丢")),
          row("战斗道具", r => (r.combatItems ? "全部丢下" : "不丢")),
          row("坚毅生命", r => `会被消磨${r.shpDown !== r.shp ? "，倒地的人更多" : ""}${r.lethal ? "，耗尽会死" : "，不致死"}`)
        ] }, note: "断后的人从还站着的角色里挑（靠坚毅生命起身的也算站着），挨场上 atk 最高的敌人一下。维修工具包不算战斗道具。" },
        { title: "单局", lines: [
          ROGUE_CONFIG.retreatSkipsNode ? "中途撤退：这一站算绕过去，任务继续；打赢才有的奖励拿不到。" : null,
          "任务最后一站撤退：任务目标没完成，任务失败；悬赏目标那一战撤退，目标逃走，任务失败。",
          ROGUE_CONFIG.bossRetreat ? null : "首领战不能撤退。"
        ] }
      ];
    } }
];

/** 规则说明的全部条目（按分类排好），给图鉴用：
 *  { id, chapter, group, groupName, name, blurb, sections, lines（搜索用：导语、关键词和全部正文） } */
function rulebookEntries() {
  const order = RULEBOOK_GROUPS.map(g => g.id);
  return RULEBOOK_CHAPTERS.map((ch, i) => {
    let sections;
    try {
      sections = (ch.build() || []).filter(Boolean).map(s => ({ title: s.title, lines: (s.lines || []).filter(l => typeof l === "string" && l),
        table: s.table || null, note: s.note || "" })).filter(s => s.lines.length || s.table);
    } catch (err) {
      if (typeof console !== "undefined") console.warn("规则说明「" + ch.name + "」生成失败：", err);
      sections = [{ title: "说明", lines: [RULEBOOK_BROKEN], table: null, note: "" }];
    }
    const lines = [ch.blurb].concat(ch.keywords || []);
    sections.forEach(s => {
      lines.push(s.title, ...s.lines);
      if (s.table) lines.push(s.table.head.join(" "), ...s.table.rows.map(r => r.join(" ")));
      if (s.note) lines.push(s.note);
    });
    const g = RULEBOOK_GROUPS.find(x => x.id === ch.group);
    return { id: "rule:" + ch.id, chapter: ch.id, group: ch.group, groupName: g ? g.name : "", name: ch.name, blurb: ch.blurb, sections, lines, _i: i };
  }).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a._i - b._i);
}
