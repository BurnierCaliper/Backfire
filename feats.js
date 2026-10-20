/* =========================================================
 * 专长（手册 · 角色升级：7 / 11 / 13 / 16 级各得一项，可以选本级或更低级的）
 * ---------------------------------------------------------
 * 和 DnD 的专长一样：不限职责和属性，谁都能选。专长分四层（tier 1–4 = 7 / 11 / 13 / 16 级），
 * 三种：
 *   战斗专长   被动规则（荒原行者、冲阵……，钩子散在 app.js / engine.js，用 featHas 判断）或战斗动作
 *   职责涉猎   别的职责的技能，次数变少（docs：perk-design-v5「次数规则」）：
 *              原技能不限次 / 每场 2 次以上 → 每场 1 次；原技能每场 1 次 → 每长休 2 次（同一场最多 1 次）。
 *              例外写在卡上（打气每场 2 次：单次收益很低的附赠增益）。已经会这个技能的人不能选。
 *              涉猎版大多直接调用原技能（dabble.base），少数削了效果的在这里另写（skill.run）
 *   探索专长   只在跑团规则下提供（跑团模式、长线养成：trpgXpRules），改熟练项检定、商店、长休、行军……
 *
 * 一条专长：
 *   { id, name, kind: "passive" | "action" | "explore", tier: 1–4, text,
 *     repeatable,                // 可以重复选（多面手）
 *     explore,                   // 探索专长：只在跑团规则下列出
 *     trpgOnly,                  // 只在跑团模式（有主持人）列出（博闻）
 *     dabble: { role, n, base, battle | rest },   // 职责涉猎：原技能（职责 + 序号 → id）和次数
 *     requires(h) → "原因" | null,
 *     onTake(h) → [待选]         // 选了以后再追加的升级选择（多面手的三项熟练、兼修选哪张、万事通的三级熟练）
 *     hooks: { apply(u), battleStart(u, _, notes), roundStart(u, _, notes), check(h, perks, ctx) },
 *     skill: { name, hint, cost, uses（每场）, rest（每长休）, side, range, steps, why, targetWhy, run } }
 * 钩子（featHook）：fn(u, value, ctx)，按 u.feats 的顺序调用，返回值不是 undefined 就接着往下传。
 *   apply        growth.js · applyLevelStats：属性、等级算完之后（每次都从头重算，所以直接改 u 的数值不会叠加）
 *   battleStart  app.js · startCombat：开战时（我方每名角色一次）
 *   roundStart   app.js · beginRound：每回合开始
 *   check        rogue.js · checkOdds：熟练项检定的优势 / 劣势 / 重掷（perks 见 party.js · checkPerksFor）
 * 战斗动作（skill）：技能 id 是 "feat_<专长 id>"；cost 默认 1 行动点；uses 每场次数；rest 每长休次数（记在
 *   LEDGER.restOnce[kit]["feat:<id>"]，长休刷新，守夜的人不刷新），而且同一场最多用 1 次。
 *   side / range：选目标（同 engine.js · SKILL_TARGET_SIDE / SKILL_RANGE），载入时登记进那两张表。
 * 兼修：把一张 1–3 层的涉猎专长换成原技能的完整版（u.featFull 里记专长 id）：次数、数值全照原技能。
 * ========================================================= */

const FEAT_TIER_LEVEL = { 1: 7, 2: 11, 3: 13, 4: 16 };
const FEAT_KIND_NAME = { passive: "被动", action: "战斗动作", explore: "探索" };
const FEAT_SKILL_PREFIX = "feat_";

/* 数值（策划改这里） */
const FEAT_CFG = {
  whet:       { base: 2, perLevels: 5 },        // 磨刀：下回合伤害骰 +(2 + 等级÷5)d6
  pointblank: { mult: 0.6 },                    // 抵近射击：远距离攻击打同区时，倍率只有原本的 60%
  bandage:    { die: 4, flat: 2 },              // 战地包扎：1d4 + 2 + 等级
  alert:      { mult: 0.5, brk: 1 },            // 警戒：敌人进区时 0.5×atk + 1 击破
  unstoppable: { brk: 2 },                      // 无可阻挡：击破 +2
  haggle:     0.8,                              // 巧手匠人：八折
  cook:       2,                                // 伙夫：长休额外 +2 坚毅生命
  rangerTravel: 2 / 3                           // 荒野向导：旅行时间 −1/3
};

const FEATS = {
  /* ===== 专长①（7 级） ===== */
  wanderer: { name: "荒原行者", kind: "passive", tier: 1,
    text: "酸液地面、冻土、空隙只要附赠动作就能离开或通过，不用检定，进入冻土也不受击破；近程攻击飞行单位不额外消耗附赠动作，把飞行单位打进失衡时把它击落到你所在区域。" },
  pointblank: { name: "抵近射击", kind: "passive", tier: 1,
    text: "远距离攻击也可以打距离 0 的目标（这样打的倍率只有原本的 60%）；从低地打高地不受 −25% 伤害。" },
  tough: { name: "硬骨头", kind: "passive", tier: 1,
    text: "生命上限 + 等级；空手攻击 +1 击破，你的武器人在场时空手攻击改为 1.5×atk。",
    hooks: {
      apply(u) {
        const inner = (u.layers || []).filter(l => l.type !== "shield").slice(-1)[0];
        if (!inner) return;
        const add = Number(u.level) || 1;
        // 上限加多少，当前值就同时加多少（不管满不满血）：第一次拿到专长、升级加成变大都一样。
        // 上次重算加过的部分（growth.js · applyLevelStats 先拆掉再重算）照原样加回，受的伤不变
        const carry = u._featHpCarry && u._featHpCarry.type === inner.type ? u._featHpCarry : null;
        inner.max = (Number(inner.max) || 0) + add;
        inner.current = Math.min(inner.max, (Number(inner.current) || 0) + Math.max(0, add - (carry ? carry.deficit : 0)));
        inner.featHp = add;
      }
    } },
  whet: { name: "磨刀", kind: "action", tier: 1, dabble: { role: "直伤", n: 1, base: "xia_prep", battle: 1 },
    text: "（直伤·准备）每场 1 次，附赠：下回合伤害骰 +(2 + 等级÷5)d6，对复数攻击只生效一次。",
    skill: { name: "磨刀", hint: "附赠 · 下回合伤害骰 +(2+等级÷5)d6", cost: { bonus: 1 }, uses: 1,
      run(a, ctx) {
        const n = FEAT_CFG.whet.base + Math.floor((Number(a.level) || 1) / FEAT_CFG.whet.perLevels);
        a.resources.preparedPending = true;
        a.resources.preparedActive = false;
        a.resources.prepared = true;
        a.resources.whetDice = n;
        ctx.lines.push(`磨刀：下个玩家回合第一次攻击的第一击 +${n}d6（复数攻击只生效一次）。`);
      } } },
  brute: { name: "蛮劲", kind: "action", tier: 1, dabble: { role: "击破", n: 1, base: "hiaki_allin", battle: 1 },
    text: "（击破·全力以赴）每场 1 次，附赠：下一击击破带猛击，可以空手使用。",
    skill: { name: "蛮劲", hint: "附赠 · 下一击猛击", cost: { bonus: 1 }, uses: 1,
      run(a, ctx) {
        a.resources.smashNext = true;
        ctx.lines.push("蛮劲：下一击带猛击。");
      } } },
  provoke: { name: "挑衅", kind: "action", tier: 1, dabble: { role: "坦克", n: 1, base: "tou_taunt", battle: 1 },
    text: "（坦克·嘲讽）每场 1 次，附赠：距离 1 以内一个敌人下次攻击必须打你，可以空手使用。",
    skill: { name: "挑衅", hint: "附赠 · 敌人下次攻击必须打自己", cost: { bonus: 1 }, uses: 1, side: "enemy", range: { min: 0, max: 1 },
      run(a, ctx) {
        const t = ctx.t;
        if (!t || t.isPlayer) { ctx.lines.push("先选挑衅的敌人。"); return false; }
        t.tauntTo = a.id;
        ctx.lines.push(`挑衅：${t.name} 下次攻击必须打${a.name}。`);
      } } },
  bandage: { name: "战地包扎", kind: "action", tier: 1, dabble: { role: "生存", n: 1, base: "role_firstaid", battle: 1 },
    text: "（生存·应急处理）每场 1 次，行动点：距离 1 以内一名友方恢复 1d4+2+等级 生命（不能救濒死）。",
    skill: { name: "战地包扎", hint: "行动点 · 一名友方恢复 1d4+2+等级", cost: { ap: 1 }, uses: 1, side: "allySelf", range: { min: 0, max: 1 },
      targetWhy(a, t) { return t && (t.dying || t.dead) ? "不能救濒死的人" : null; },
      run(a, ctx) {
        const t = ctx.t;
        if (!t || !t.isPlayer) { ctx.lines.push("先选包扎的友方。"); return false; }
        const r = takeDice(1, FEAT_CFG.bandage.die, FEAT_CFG.bandage.flat + (Number(a.level) || 1));
        const got = healUnit(t, r.total);
        ctx.lines.push(`战地包扎：${t.name} 恢复 ${got}（${r.text}）。`);
      } } },
  skywatch: { name: "看天", kind: "action", tier: 1, dabble: { role: "环境手", n: 2, base: "role_shelter", battle: 1 },
    text: "（环境手·保释）每场 1 次，附赠：你或一名友方本回合豁免天气与场地。",
    skill: { name: "看天", hint: "附赠 · 你或一名友方本回合豁免天气与场地", cost: { bonus: 1 }, uses: 1, side: "allySelf", range: { min: 0, max: 99 },
      run(a, ctx) {
        const t = ctx.t;
        if (!t || !t.isPlayer) { ctx.lines.push("先选要豁免的友方。"); return false; }
        t.isolate = true;
        t.shelterTurn = true;
        ctx.lines.push(`看天：${t.name} 本回合豁免天气与场地。`);
      } } },
  cheer: { name: "打气", kind: "action", tier: 1, dabble: { role: "辅助", n: 1, base: "yuito_inspire", battle: 2 },
    text: "（辅助·助威）每场 2 次（例外：单次收益低），附赠：一名其他友方本回合振奋。",
    skill: { name: "打气", hint: "附赠 · 一名其他友方本回合振奋", cost: { bonus: 1 }, uses: 2, side: "ally", range: { min: 0, max: 99 },
      run(a, ctx) {
        const t = ctx.t;
        if (!t || !t.isPlayer || t.id === a.id) { ctx.lines.push("先选打气的友方。"); return false; }
        t.statuses = t.statuses || {};
        t.statuses.inspire = true;
        t.statuses.inspireStay = false;
        if (typeof popStatus === "function") popStatus(t, "inspire");
        ctx.lines.push(`打气：${t.name} 本回合振奋。`);
      } } },
  versatile: { name: "多面手", kind: "explore", tier: 1, explore: true, repeatable: true,
    text: "（探索）三项熟练项各升一级（新学或升级），可以重复选。",
    onTake: () => [{ type: "prof" }, { type: "prof" }, { type: "prof" }] },
  sharpeye: { name: "眼尖", kind: "explore", tier: 1, explore: true,
    text: "（探索）调查类检定有优势；会受伤的检定失败时你不受伤。",
    hooks: { check(h, perks, ctx) {
      const out = Object.assign({}, perks, { noHurt: true });
      if (typeof PROFICIENCIES !== "undefined" && PROFICIENCIES["调查类"].indexOf(ctx && ctx.prof) >= 0) { out.adv = true; out.dis = false; out.text = [perks.text, "眼尖：调查类优势"].filter(Boolean).join("；"); }
      return out;
    } } },
  learned: { name: "博闻", kind: "explore", tier: 1, explore: true, trpgOnly: true,
    text: "（探索，跑团模式）每长休 1 次，问主持人一个关于眼前目标的问题，得到真实答案。" },

  /* ===== 专长②（11 级） ===== */
  charge: { name: "冲阵", kind: "passive", tier: 2,
    text: "本回合用附赠动作移动过后，第一次近距离攻击 +1 击破；你把敌人打进失衡时，它额外获得 1 层不稳。" },
  shove: { name: "推搡", kind: "action", tier: 2,
    text: "每场 1 次，附赠：把距离 1 以内一个单位移动 1 格；你的协助格挡成功后，把攻击者推到相邻区域。",
    skill: { name: "推搡", hint: "附赠 · 把一个单位推 1 格", cost: { bonus: 1 }, uses: 1,
      steps(a, picks) {
        const units = fieldUnits().filter(u => u.id !== a.id && !u.dead && !u.hidden && zoneDist(a.zone, u.zone, state.zoneMode) <= 1 && canDisplace(u));
        const steps = [{ key: "target", type: "unit", optional: false, label: "推谁（距离 1 以内）", units }];
        const t = picks && picks.target ? unitById(picks.target) : null;
        if (t) steps.push({ key: "dest", type: "zone", optional: false, label: "推到哪一区（相连的区）", zones: zoneNeighbors(t.zone) });
        return steps;
      },
      targetWhy(a, t, picks) {
        const u = picks && picks.target ? unitById(picks.target) : null;
        if (u && typeof enemyRankOf === "function" && !u.isPlayer && enemyRankOf(u) === "boss") return "推不动首领";
        return null;
      },
      run(a, ctx) {
        const u = ctx.picks.target ? unitById(ctx.picks.target) : null;
        const dest = ctx.picks.dest != null ? Number(ctx.picks.dest) : null;
        if (!u || dest == null) { ctx.lines.push("先选推谁、推到哪一区。"); return false; }
        if (displaceTo(u, dest, ctx.lines, "被推搡")) ctx.lines.push(`推搡：${u.name} 被推到 ${dest} 区。`);
      } } },
  alert: { name: "警戒", kind: "passive", tier: 2,
    text: "每场第一回合 +1 附赠动作；敌方回合，敌人走进你所在区域时，你可以消耗留着的附赠动作，对它造成 0.5×atk + 1 击破。",
    // 第一回合 +1 附赠：app.js · refreshEconomy（回合开始补附赠时，每场第一次多给一个，见 featAlertBonus）
  },
  catalyze: { name: "催化", kind: "action", tier: 2, dabble: { role: "异常", n: 1, base: "role_activate", battle: 1 },
    text: "（异常·激活）每场 1 次，附赠：立刻触发目标身上的一种状态。" },
  standin: { name: "挺身", kind: "action", tier: 2, dabble: { role: "护卫", n: 1, base: "role_cover", short: 1 },
    text: "（护卫·掩护涉猎）每次短休 1 次，附赠：选择一名队友，本回合内他每次被单体攻击时，你都可以免费为他协助格挡（照常掷成功率）。",
    skill: { name: "挺身", hint: "附赠 · 本回合内一名队友每次被单体攻击，你都免费为他协助格挡", cost: { bonus: 1 }, side: "ally", range: { min: 0, max: 99 },
      run(a, ctx) {
        const t = ctx.t;
        if (!t || !t.isPlayer || t.id === a.id) { ctx.lines.push("先选要保护的队友。"); return false; }
        t.coverBy = a.id;
        ctx.lines.push(`挺身：本回合 ${t.name} 每次被单体攻击时，${a.name} 都可以免费协助格挡。`);
      } } },
  unbowed: { name: "决不后退", kind: "action", tier: 2,
    text: "每场 1 次（晕眩后重置），附赠：为自己恢复 2 架势（不超过上限）。受到击破即将失衡时，若还有附赠动作且次数未用，自动发动。",
    // 自动发动：engine.js · applyResultToUnit（攻击）和 app.js · dealBreak（其他击破）扣架势之前调 featUnbowedAuto
    // 晕眩后重置：app.js · recoverFromStun / clearStunOnDown 调 featUnbowedReset
    skill: { name: "决不后退", hint: "附赠 · 为自己恢复 2 架势（不超过上限）", cost: { bonus: 1 }, uses: 1,
      why(a) { return (Number(a.def) || 0) >= (Number(a.defMax) || 0) ? "架势已经是满的" : null; },
      run(a, ctx) {
        const got = featUnbowedGain(a);
        if (got <= 0) { ctx.lines.push("架势已经是满的。"); return false; }
        a.def = (Number(a.def) || 0) + got;
        ctx.lines.push(`决不后退：${a.name} 恢复 ${got} 架势（${a.def}/${a.defMax}）。`);
      } } },
  grapple: { name: "勾索", kind: "action", tier: 2, dabble: { role: "控场", n: 1, base: "role_pull", battle: 1 },
    text: "（控场·拉拽）每场 1 次，附赠：把一个目标从任意距离拉到你所在区域，对首领无效。",
    skill: { name: "勾索", hint: "附赠 · 把目标拉到自己区域", cost: { bonus: 1 }, uses: 1, side: "any", range: { min: 0, max: 99 },
      targetWhy(a, t) { return t && !t.isPlayer && typeof enemyRankOf === "function" && enemyRankOf(t) === "boss" ? "勾索拉不动首领" : null; },
      run(a, ctx) {
        const t = ctx.t;
        if (!t) { ctx.lines.push("先选勾索的目标。"); return false; }
        displaceTo(t, a.zone, ctx.lines, "被勾索拉过来");
      } } },
  prolong: { name: "续时", kind: "action", tier: 2, dabble: { role: "辅助", n: 3, base: "role_gold", battle: 1 },
    text: "（辅助·黄金时间）每场 1 次，附赠：一个单位身上的一种即时效果延长一回合。" },
  haggler: { name: "巧手匠人", kind: "explore", tier: 2, explore: true,
    text: "（探索）在商店买东西、找工匠升级都打 8 折，不和其他折扣叠加（取更便宜的）。" },
  cook: { name: "伙夫", kind: "explore", tier: 2, explore: true,
    text: "（探索）每次长休，坚毅生命最少的一名角色额外恢复 2 点坚毅生命。" },
  silver: { name: "舌灿莲花", kind: "explore", tier: 2, explore: true,
    text: "（探索）交涉类检定有优势；每个任务 1 次，用一次普通交涉检定谈掉一场普通战斗（没有掉落和经验）。",
    hooks: { check(h, perks, ctx) {
      if (typeof PROFICIENCIES === "undefined" || PROFICIENCIES["交涉类"].indexOf(ctx && ctx.prof) < 0) return perks;
      return Object.assign({}, perks, { adv: true, dis: false, text: [perks.text, "舌灿莲花：交涉类优势"].filter(Boolean).join("；") });
    } } },

  /* ===== 专长③（13 级） ===== */
  ironwall: { name: "以身作盾", kind: "passive", tier: 3,
    text: "每次短休 1 次：你或同区友方被敌人的单体攻击打中、结算前，可以宣布「以身作盾」。这一击视为协助格挡成功，必定挡住，目标完全免伤且不掉架势，这一击的击破改由你承担（架势至少留 1，不会因此失衡）。不消耗附赠动作。",
    short: 1 },
  pickup: { name: "拉一把", kind: "action", tier: 3,
    text: "每场 1 次，行动点：对同区一名濒死友方使用一件医疗道具，他以该道具的治疗量起身，不扣坚毅生命。",
    skill: { name: "拉一把", hint: "行动点 · 用医疗道具把同区濒死的友方拉起来", cost: { ap: 1 }, uses: 1,
      steps(a) {
        const units = fieldUnits().filter(u => u.isPlayer && u.dying && !u.dead && Number(u.zone) === Number(a.zone) && u.id !== a.id);
        const items = featHealItems();
        return [
          { key: "target", type: "unit", optional: false, label: "拉谁起来（同区濒死的友方）", units },
          { key: "item", type: "choice", optional: false, label: "用哪件医疗道具", options: items.map(x => ({ value: x.id, label: `${x.name}（治疗 ${x.text} · 有 ${x.qty}）` })) }
        ];
      },
      why() { return featHealItems().length ? null : "背包里没有医疗道具"; },
      run(a, ctx) {
        const t = ctx.picks.target ? unitById(ctx.picks.target) : null;
        const it = featHealItems().find(x => x.id === ctx.picks.item);
        if (!t || !t.dying || !it) { ctx.lines.push("先选同区濒死的友方和医疗道具。"); return false; }
        bagAdd(it.id, -1);
        t.dying = false; t.upOnShp = false; t.dead = false;
        const inner = (t.layers || []).filter(l => l.type !== "shield").slice(-1)[0];
        if (inner && (Number(inner.current) || 0) <= 0) inner.current = 0;
        const got = healUnit(t, rollItemHeal(it.id).total);   // 和平时用这件道具一样掷骰（items.js · rollItemHeal）
        ctx.lines.push(`拉一把：${a.name} 用 ${it.name} 把 ${t.name} 拉了起来，恢复 ${got}，不扣坚毅生命。`);
      } } },
  onemind: { name: "人器一心", kind: "passive", tier: 3,
    text: "每长休 1 次，武器生物化只消耗附赠动作；那一场战斗里，武器人变回武器不消耗行动点。",
    rest: 1 },
  rally: { name: "号召", kind: "passive", tier: 3,
    text: "每场开战时，你所在区域的我方（含自己）获得 等级÷2（向上取整）点护盾。",
    hooks: { battleStart(u, _, notes) {
      const amt = Math.ceil((Number(u.level) || 1) / 2);
      const who = fieldUnits().filter(x => x.isPlayer && !x.dead && !x.hidden && Number(x.zone) === Number(u.zone));
      who.forEach(x => addShieldLayer(x, amt, false));
      if (notes && who.length) notes.push(`${u.name} 号召：${who.map(x => x.name).join("、")} 获得 ${amt} 点护盾。`);
    } } },
  insight: { name: "看破", kind: "action", tier: 3, dabble: { role: "直伤", n: 2, base: "role_refine", rest: 2 },
    text: "（直伤·精益求精）每长休 2 次，附赠：下一击带弱点特效。" },
  diffuse: { name: "扩散", kind: "action", tier: 3, dabble: { role: "异常", n: 2, base: "role_spread", battle: 1 },
    text: "（异常·传播）每场 1 次，行动点：把一个单位身上的属性状态复制给另一个单位。" },
  momentum: { name: "乘势", kind: "passive", tier: 3,
    text: "你把一个敌人打进失衡时，同区其他架势 = 1 的敌人各受 1 点无属性击破（不会连锁）。" },
  bellow: { name: "怒吼", kind: "action", tier: 3, dabble: { role: "坦克", n: 2, base: "role_lockdown", battle: 1 },
    text: "（坦克·禁足怒吼）每场 1 次，行动点：同区敌人本回合不能移动，而且只能攻击你。适合耐打的角色。" },
  daunt: { name: "震慑", kind: "action", tier: 3, dabble: { role: "护卫", n: 2, base: "role_fear", battle: 1 },
    text: "（护卫·恐惧怒吼）每场 1 次，行动点：距离 1 以内所有敌人本回合虚弱。" },
  brace: { name: "加固", kind: "action", tier: 3, dabble: { role: "生存", n: 2, base: "role_buffer", rest: 2 },
    text: "（生存·缓冲）每长休 2 次，附赠：距离 1 以内一名友方获得 2d4+4 护盾。" },
  waypass: { name: "借道", kind: "action", tier: 3, dabble: { role: "控场", n: 2, base: "role_boost", battle: 1 },
    text: "（控场·借力）每场 1 次，附赠：把任意位置的一名其他友方移到任意区域。" },
  rouse: { name: "鼓劲", kind: "action", tier: 3, dabble: { role: "辅助", n: 2, base: "role_sturdy", battle: 1 },
    text: "（辅助·不倒战意）每场 1 次，附赠：一名同区友方本回合坚挺。" },
  ranger: { name: "荒野向导", kind: "explore", tier: 3, explore: true,
    text: "（探索）队伍旅行时间 −1/3；你守夜时长休照常恢复。" },
  scavenger: { name: "拾荒者", kind: "explore", tier: 3, explore: true,
    text: "（探索）每场战斗胜利后多掷一次战利品。" },
  gambler: { name: "赌徒的运气", kind: "explore", tier: 3, explore: true,
    text: "（探索）每长休 1 次，检定失败时自动改成成功。" },

  /* ===== 专长④（16 级） ===== */
  revive: { name: "还魂", kind: "passive", tier: 4,
    text: "每场 1 次，生命被打到 0 时保留 1 点，直到你下回合开始前不受任何伤害和击破，也不会高能自爆。" },
  blink: { name: "跃迁", kind: "action", tier: 4,
    text: "每回合 1 次，你用行动点攻击后，可以免费移动 1 格（可以越过空隙，不用检定）。",
    skill: { name: "跃迁", hint: "免费 · 攻击后移动 1 格（可越过空隙）", cost: {},
      why(a) {
        const r = a.resources || {};
        if (r.blinkUsed === state.turnNo) return "这回合已经跃迁过";
        if (r.blinkReady !== state.turnNo) return "要先用行动点攻击";
        return null;
      },
      steps(a) { return [{ key: "dest", type: "zone", optional: false, label: "跃迁到哪一区（相连的区）", zones: zoneNeighbors(a.zone) }]; },
      run(a, ctx) {
        const dest = ctx.picks.dest != null ? Number(ctx.picks.dest) : null;
        if (dest == null) { ctx.lines.push("先选跃迁到哪一区。"); return false; }
        if (a.entangled || (typeof sinkStuck === "function" && sinkStuck(a))) { ctx.lines.push(`${a.name} 被困住了，跃迁不出去。`); return false; }
        if (!displaceTo(a, dest, ctx.lines, "跃迁", { flyOver: true })) return false;   // 空隙直接越过
        a.resources.blinkUsed = state.turnNo;
      } } },
  unstoppable: { name: "无可阻挡", kind: "action", tier: 4,
    text: "每场 1 次，附赠：下一击无视目标的百分比减伤（沙尘、装甲这些血量层照常要打）、不能被格挡，击破 +2。",
    skill: { name: "无可阻挡", hint: "附赠 · 下一击无视减伤、不能被格挡、击破 +2", cost: { bonus: 1 }, uses: 1,
      run(a, ctx) {
        a.resources.unstoppableNext = true;
        ctx.lines.push("无可阻挡：下一击无视减伤、不能被格挡，击破 +2。");
      } } },
  deadly: { name: "致命一击", kind: "action", tier: 4, dabble: { role: "直伤", n: 3, base: "role_pierce", rest: 2 },
    text: "（直伤·一击制敌）每长休 2 次，附赠：下一击带穿刺。" },
  redouble: { name: "倍化", kind: "action", tier: 4, dabble: { role: "异常", n: 3, base: "role_double_dot", rest: 2 },
    text: "（异常·加倍计量）每长休 2 次，附赠：一个敌人身上所有状态本回合效果翻倍。" },
  sunder: { name: "断戟", kind: "action", tier: 4, dabble: { role: "击破", n: 3, base: "role_halve", rest: 2 },
    text: "（击破·折戟）每长休 2 次，行动点：对一个敌人造成它当前架势一半的击破（向下取整）。" },
  holdfast: { name: "硬撑", kind: "action", tier: 4, dabble: { role: "坦克", n: 3, base: "role_grit", battle: 1 },
    text: "（坦克·咬牙坚持）每场 1 次，附赠：本回合减伤率 +50%。" },
  riposte: { name: "反手", kind: "action", tier: 4, dabble: { role: "护卫", n: 3, base: "role_guard_strike", battle: 1 },
    text: "（护卫·防守反击）每场 1 次，行动点：本回合第一次协助格挡成功后，追加一次协助攻击。" },
  bubble: { name: "护罩", kind: "action", tier: 4, dabble: { role: "生存", n: 3, base: "role_dome", rest: 2 },
    text: "（生存·防护罩）每长休 2 次，行动点：在你所在区域放一个血量 atk+10 的护盾罩，范围攻击也被完全挡住。" },
  worsen: { name: "恶化", kind: "action", tier: 4, dabble: { role: "环境手", n: 3, base: "role_harsh", rest: 2 },
    text: "（环境手·恶劣环境）每长休 2 次，附赠：一名单位（敌我都行）本回合受到双倍场地或天气效果。" },
  quake: { name: "地震", kind: "action", tier: 4, dabble: { role: "控场", n: 3, base: "role_shake", rest: 2 },
    text: "（控场·撼动）每长休 2 次，行动点：同区所有敌人不稳。" },
  dualclass: { name: "兼修", kind: "passive", tier: 4,
    text: "选你的一张专长①–③里的职责涉猎专长：它的次数和数值改成原职责技能的完整版（按你的等级计算）。",
    requires(h) { return featFullOptions(h).length ? null : "没有可以升级的①–③职责涉猎专长"; },
    onTake: () => [{ type: "featFull" }] },
  polymath: { name: "万事通", kind: "explore", tier: 4, explore: true,
    text: "（探索）所有你没有的熟练项视为一级；再选一项升到三级。",
    onTake: () => [{ type: "prof3" }] }
};
Object.keys(FEATS).forEach(id => { FEATS[id].id = id; });

/* 涉猎专长：把原技能的提示、选目标、射程登记到专长技能上 */
(function registerDabbles() {
  Object.keys(FEATS).forEach(id => {
    const f = FEATS[id];
    const sid = FEAT_SKILL_PREFIX + id;
    const d = f.dabble;
    if (d && !f.skill) {
      f.skill = { name: f.name, cost: null, uses: d.battle || 0, rest: d.rest || 0, short: d.short || 0, delegate: true };
    } else if (d && f.skill) {
      f.skill.uses = d.battle || f.skill.uses || 0;
      f.skill.rest = d.rest || 0;
      f.skill.short = d.short || f.skill.short || 0;
    }
    if (!f.skill) return;
    if (typeof SKILL_TARGET_SIDE !== "undefined") {
      const side = f.skill.side || (d && SKILL_TARGET_SIDE[d.base]);
      if (side) SKILL_TARGET_SIDE[sid] = side;
    }
    if (typeof SKILL_RANGE !== "undefined") {
      const rg = f.skill.range || (d && SKILL_RANGE[d.base]);
      if (rg) SKILL_RANGE[sid] = rg;
    }
  });
})();

function featDef(id) {
  return Object.prototype.hasOwnProperty.call(FEATS, id) ? FEATS[id] : null;
}
/** 有没有任何专长可选（没有就继续只记欠账） */
function featsReady() {
  return Object.keys(FEATS).length > 0;
}
/** 身上的专长（u 可以是战斗单位，也可以是单局里的角色档案 h：都读 .feats） */
function featIds(u) {
  return ((u && u.feats) || []).filter(id => featDef(id));
}
function featCount(u, id) {
  return featIds(u).filter(x => x === id).length;
}
function featHas(u, id) {
  return featCount(u, id) > 0;
}
/** 跑团规则下（跑团模式、长线养成）才提供探索专长 */
function featExploreOk() {
  return typeof trpgXpRules === "function" && !!trpgXpRules();
}
function featTrpgOk() {
  return typeof TRPG !== "undefined" && !!TRPG.active;
}
/** 角色档案对应的单位（判断已经会哪些职责技能）。战斗单位直接用，单局角色档案按角色卡临时生成一个 */
function featUnitOf(h) {
  if (!h) return null;
  if (h.roles) return h;
  if (typeof livePartyCards !== "function" || typeof spawnLiveCard !== "function") return null;
  const card = livePartyCards().find(c => c.kit === h.kit);
  if (!card) return null;
  const u = spawnLiveCard(card, 1);
  u.level = Number(h.level) || 1;
  u.rolePicks = Object.assign({}, h.rolePicks || {});
  u.role2 = h.role2 || null;
  u.role2Picks = (h.role2Picks || []).slice();
  return u;
}
/** 这名角色会不会某个职责技能（职责 + 序号） */
function featKnowsRoleSkill(h, role, n) {
  const u = featUnitOf(h);
  if (!u || typeof roleSkillsUnlocked !== "function") return false;
  return roleSkillsUnlocked(u).some(r => r.role === role && Number(r.n) === Number(n));
}
/** 这名角色现在能选的专长（不能重复的已经有了就不列；层级、前置条件、已会的技能、模式不满足也不列）。
 *  level：这次升级的等级（可以选本级或更低级的），不给按角色当前等级 */
function featChoicesFor(h, level) {
  const lv = Number(level) || Number(h && h.level) || 1;
  return Object.keys(FEATS).filter(id => {
    const f = FEATS[id];
    if ((FEAT_TIER_LEVEL[f.tier] || 0) > lv) return false;
    if (f.trpgOnly && !featTrpgOk()) return false;
    if (f.explore && !featExploreOk()) return false;
    if (!f.repeatable && featCount(h, id) > 0) return false;
    if (f.dabble && featKnowsRoleSkill(h, f.dabble.role, f.dabble.n)) return false;
    if (typeof f.requires === "function" && f.requires(h)) return false;
    return true;
  });
}
/** 兼修能升级的：身上 1–3 层的涉猎专长，还没升过的 */
function featFullOptions(h) {
  const full = (h && h.featFull) || [];
  return featIds(h).filter(id => FEATS[id].dabble && FEATS[id].tier <= 3 && full.indexOf(id) < 0)
    .filter((id, i, arr) => arr.indexOf(id) === i);
}
/** 这张涉猎专长有没有被兼修升成完整版 */
function featFull(u, id) {
  return !!(u && (u.featFull || []).indexOf(id) >= 0);
}
/** 按身上的专长依次调用某个钩子；返回值不是 undefined 就作为新的 value 往下传 */
function featHook(u, name, value, ctx) {
  featIds(u).forEach(id => {
    const fn = (FEATS[id].hooks || {})[name];
    if (typeof fn !== "function") return;
    const out = fn(u, value, ctx);
    if (out !== undefined) value = out;
  });
  return value;
}

/* ---------- 战斗动作 ---------- */
function featOfSkill(skillId) {
  const s = String(skillId || "");
  if (s.indexOf(FEAT_SKILL_PREFIX) !== 0) return null;
  const f = featDef(s.slice(FEAT_SKILL_PREFIX.length));
  return f && f.skill ? f : null;
}
/** 涉猎专长这次直接调用原技能吗（兼修的完整版、或者没有另写削弱版的）。返回原技能 id 或 null */
function featDelegateBase(u, f) {
  if (!f || !f.dabble) return null;
  if (featFull(u, f.id)) return f.dabble.base;
  return f.skill && f.skill.delegate ? f.dabble.base : null;
}
/** 专长技能 id（feat_xxx）背后的原职责技能 id；不是涉猎专长返回 null（party.js · skillCost 认分步里的 id 用） */
function featDelegateBaseOf(skillId) {
  const f = featOfSkill(skillId);
  return f && f.dabble ? f.dabble.base : null;
}
function featActor() {
  return typeof state !== "undefined" && typeof unitById === "function" ? unitById(state.attackerId) : null;
}
function featSkillCost(skillId) {
  const f = featOfSkill(skillId);
  if (!f) return null;
  const a = featActor();
  const base = featDelegateBase(a, f);
  if (base && typeof skillCost === "function") return Object.assign({}, skillCost(base));
  return Object.assign({}, f.skill.cost || { ap: 1 });
}
function featRestKey(f) { return "feat:" + f.id; }
/** 「每次短休 N 次」用了几次（ledger.js · LEDGER.shortOnce，这个人短休 / 长休时刷新） */
function featShortUsed(u, f) {
  if (typeof shortOnceUsed !== "function" || !u) return 0;
  return shortOnceUsed(u.kit, featRestKey(f));
}
function featRestUsed(u, f) {
  if (typeof LEDGER === "undefined" || !u) return 0;
  return Number(((LEDGER.restOnce || {})[u.kit] || {})[featRestKey(f)]) || 0;
}
/** 还能用几次（Infinity = 不限）。兼修完整版交给原技能自己的次数 */
function featUsesLeft(u, f) {
  if (featFull(u, f.id)) return Infinity;
  const k = Math.max(1, featCount(u, f.id));
  const used = Number((((u && u.resources) || {}).featUsed || {})[f.id]) || 0;
  if (f.skill.short) return Math.max(0, f.skill.short * k - featShortUsed(u, f));
  if (f.skill.rest) {
    // 每长休 N 次，同一场最多 1 次
    return Math.max(0, Math.min(f.skill.rest * k - featRestUsed(u, f), 1 - used));
  }
  if (!f.skill.uses) return Infinity;
  return Math.max(0, f.skill.uses * k - used);
}
/** 技能列表里的条目（party.js · skillList）。已经学会原技能的涉猎专长不再列（升级后学到了原技能） */
function featSkills(u) {
  const seen = {};
  return featIds(u).filter(id => FEATS[id].skill && !seen[id] && (seen[id] = true)).filter(id => {
    const d = FEATS[id].dabble;
    return !(d && u.roles && featKnowsRoleSkill(u, d.role, d.n));
  }).map(id => {
    const f = FEATS[id];
    const left = featUsesLeft(u, f);
    const full = featFull(u, id);
    const usesText = left === Infinity ? "" : f.skill.short ? ` · 这次短休前剩 ${left} 次` : f.skill.rest ? ` · 本次长休剩 ${Math.max(0, f.skill.rest * Math.max(1, featCount(u, id)) - featRestUsed(u, f))} 次（每场最多 1 次）` : ` · 本场剩 ${left} 次`;
    let hint = f.skill.hint;
    let name = f.skill.name || f.name;
    if (f.dabble && (full || !hint)) {
      const def = typeof roleSkillDef === "function" ? roleSkillDef(f.dabble.role, f.dabble.n, u) : null;
      hint = def ? def.hint : f.text;
      if (full && def) name = `${f.name}（${def.name}·完整）`;
    }
    return { id: FEAT_SKILL_PREFIX + id, name, hint: `专长 · ${hint || f.text || ""}${usesText}`, bare: true, feat: true };
  });
}
function featSkillWhy(a, skillId) {
  const f = featOfSkill(skillId);
  if (!f) return null;
  if (featCount(a, f.id) <= 0) return "没有这项专长";
  if (featUsesLeft(a, f) <= 0) return f.skill.short ? "短休前的次数已用完" : f.skill.rest ? (featRestUsed(a, f) >= f.skill.rest * Math.max(1, featCount(a, f.id)) ? "这次长休的次数已用完" : "这一场已经用过") : "本场次数已用完";
  const base = featDelegateBase(a, f);
  if (base && typeof SKILL_REQUIREMENT !== "undefined" && typeof SKILL_REQUIREMENT[base] === "function") {
    let why = null;
    try { why = SKILL_REQUIREMENT[base](a) || null; } catch (e) { why = null; }
    if (why) return why;
  }
  return typeof f.skill.why === "function" ? (f.skill.why(a) || null) : null;
}
function featSkillTargetWhy(a, skillId, t, picks) {
  const f = featOfSkill(skillId);
  if (!f) return null;
  const base = featDelegateBase(a, f);
  if (base && typeof skillTargetError === "function") {
    const why = featNerfed(a, f, () => skillTargetError(a, base, t));
    if (why) return why;
  }
  // 另写的削弱版：目标选错边（友方技能点了敌人……）在扣点之前拦下；没选目标交给技能里的「先选……」
  const side = !base && f.skill.side;
  if (side && t && t.id) {
    if ((side === "ally" || side === "allySelf") && !t.isPlayer) return "只能对友方使用";
    if (side === "ally" && t.id === a.id) return "要选其他友方";
    if (side === "enemy" && t.isPlayer) return "只能对敌人使用";
  }
  return typeof f.skill.targetWhy === "function" ? (f.skill.targetWhy(a, t, picks || {}) || null) : null;
}
/** 涉猎（没兼修）调用原技能时，原技能里按等级解锁的加强（15 级缓冲选血量种类、全体坚挺……）不算 */
function featNerfed(a, f, fn) {
  const nerf = !!(a && f && f.dabble && !featFull(a, f.id));
  const had = a ? a._dabbleNerf : undefined;
  if (a && nerf) a._dabbleNerf = true;
  try { return fn(); } finally { if (a && nerf) { if (had === undefined) delete a._dabbleNerf; else a._dabbleNerf = had; } }
}
function featSkillSteps(a, skillId, picks) {
  const f = featOfSkill(skillId);
  if (!f) return [];
  const base = featDelegateBase(a, f);
  if (base && typeof skillFlowSteps === "function") return featNerfed(a, f, () => skillFlowSteps(base, a, picks || {}) || []);
  return typeof f.skill.steps === "function" ? (f.skill.steps(a, picks || {}) || []) : [];
}
/** 记一次使用（每场 + 每长休） */
function featSpend(a, f) {
  if (featFull(a, f.id)) return;
  a.resources = a.resources || {};
  if (f.skill.uses || f.skill.rest) {
    a.resources.featUsed = Object.assign({}, a.resources.featUsed || {});
    a.resources.featUsed[f.id] = (Number(a.resources.featUsed[f.id]) || 0) + 1;
  }
  if (f.skill.short && typeof useShortOnce === "function") useShortOnce(a.kit, featRestKey(f), f.skill.short * Math.max(1, featCount(a, f.id)));
  if (f.skill.rest && typeof useRestOnce === "function") useRestOnce(a.kit, featRestKey(f), f.skill.rest * Math.max(1, featCount(a, f.id)));
}
/** app.js · runSkillInner：这次是调用原技能的涉猎专长吗？是就记次数、打上削弱标记，返回原技能 id */
function featBeginDelegate(a, skillId) {
  const f = featOfSkill(skillId);
  const base = featDelegateBase(a, f);
  if (!base) return null;
  featSpend(a, f);
  if (!featFull(a, f.id)) a._dabbleNerf = true;
  return base;
}
/** 结算一次专长动作（行动点已经由 runSkillInner 扣过）。run 返回 false = 没选好对象，不记次数 */
function runFeatSkill(a, skillId, ctx) {
  const f = featOfSkill(skillId);
  if (!f) return;
  a.resources = a.resources || {};
  const ok = typeof f.skill.run === "function" ? f.skill.run(a, ctx) : undefined;
  if (ok !== false) featSpend(a, f);
}

/** 资料面板 / 选择界面用的一行说明 */
function featLabel(id) {
  const f = featDef(id);
  if (!f) return id;
  const lv = FEAT_TIER_LEVEL[f.tier];
  return `${f.name}（${lv ? lv + " 级 · " : ""}${FEAT_KIND_NAME[f.kind] || "专长"}）`;
}

/* ---------- 散在规则里的钩子（app.js / engine.js / rogue.js / ledger.js 调用） ---------- */
/** 背包里能拿来「拉一把」的医疗道具：[{ id, name, text, qty }]（治疗骰读 items.js · itemHealSpec，text 如 1d4+6；强心注射剂只能自己用，不算） */
function featHealItems() {
  if (typeof ITEM_CATALOG === "undefined" || typeof bagCount !== "function") return [];
  return Object.keys(ITEM_CATALOG).filter(id => {
    const it = ITEM_CATALOG[id];
    return it && it.combat && it.target === "ally" && itemHealSpec(id) && bagCount(id) > 0;
  }).map(id => {
    const h = itemHealSpec(id);
    return { id, name: ITEM_CATALOG[id].name, text: `${h.n}d${h.s}${h.flat ? "+" + h.flat : ""}`, qty: bagCount(id) };
  });
}

/** 被动的次数（还魂每场、以身作盾每次短休、人器一心每长休）：还剩没有。次数周期看专长上的 short / rest */
function featOnceLeft(u, id) {
  if (!featHas(u, id)) return false;
  const f = FEATS[id];
  const k = featCount(u, id);
  if (f.short) return featShortUsed(u, f) < f.short * k;
  if (f.rest) return !(typeof LEDGER !== "undefined" && (Number(((LEDGER.restOnce || {})[u.kit] || {})[featRestKey(f)]) || 0) >= f.rest * k);
  return !(((u.resources || {}).featUsed || {})[id] >= k);
}
function featUseOnce(u, id) {
  const f = FEATS[id];
  const k = Math.max(1, featCount(u, id));
  if (f && f.short && typeof useShortOnce === "function") { useShortOnce(u.kit, featRestKey(f), f.short * k); return; }
  if (f && f.rest && typeof useRestOnce === "function") { useRestOnce(u.kit, featRestKey(f), f.rest * k); return; }
  u.resources = u.resources || {};
  u.resources.featUsed = Object.assign({}, u.resources.featUsed || {});
  u.resources.featUsed[id] = (Number(u.resources.featUsed[id]) || 0) + 1;
}

/** 还魂：玩家角色最内层被打到 0 时（app.js · applyKnockdown）。救下来返回 true */
function featReviveCheck(u, notes) {
  if (!u || !u.isPlayer || u.dead || u.dying || u.upOnShp || !featOnceLeft(u, "revive")) return false;
  const inner = (u.layers || []).filter(l => l.type !== "shield").slice(-1)[0];
  if (!inner) return false;
  featUseOnce(u, "revive");
  inner.current = 1;
  u.resources.standTurn = true;
  u.resources.reviveGuard = true;
  if (notes) notes.push(`${u.name} 还魂：保留 1 点生命，直到自己下回合开始前不受任何伤害和击破。`);
  return true;
}

/** 决不后退：能恢复多少架势（+2，不超过上限） */
function featUnbowedGain(u) {
  const def = Number(u && u.def) || 0, max = Number(u && u.defMax) || 0;
  return Math.max(0, Math.min(FEAT_UNBOWED_DEF, max - def));
}
const FEAT_UNBOWED_DEF = 2;
/** 决不后退·自动：spent 点击破马上要把 u 打进失衡时，还有附赠动作和次数就先 +2 架势。
 *  只在真的能挡住这次失衡时发动（+2 之后还是会被打空就不浪费）。发动了返回 true（u.def 已经加好） */
function featUnbowedAuto(u, spent, notes) {
  if (!u || !u.isPlayer || u.dead || u.stunned || (u.dying && !u.upOnShp) || !featHas(u, "unbowed")) return false;
  const def = Number(u.def) || 0;
  spent = Number(spent) || 0;
  if (def <= 0 || spent < def || (Number(u.bonus) || 0) < 1 || !featOnceLeft(u, "unbowed")) return false;
  const got = featUnbowedGain(u);
  if (def + got - spent <= 0) return false;
  u.bonus -= 1;
  if (typeof syncBladeTwin === "function") syncBladeTwin(u);
  featUseOnce(u, "unbowed");
  u.def = def + got;
  if (notes) notes.push(`${u.name} 决不后退：消耗附赠动作，架势 +${got}（${def} → ${u.def}），没有失衡。`);
  return true;
}
/** 晕眩结束（恢复 / 倒地清掉晕眩）后，决不后退的次数回来 */
function featUnbowedReset(u) {
  const used = u && u.resources && u.resources.featUsed;
  if (used && used.unbowed) { u.resources.featUsed = Object.assign({}, used); delete u.resources.featUsed.unbowed; }
}

/** 以身作盾（id 仍是 ironwall，旧存档照读）：这一击（敌人打 target）可以宣布的人 */
function featIronwallDeclarers(target) {
  if (!target || !target.isPlayer || typeof state === "undefined") return [];
  return (state.units || []).filter(u => u.isPlayer && !u.dead && !u.hidden && !u.stunned && !(u.dying && !u.upOnShp) &&   // 失衡中不能宣布
    Number(u.zone) === Number(target.zone) && featOnceLeft(u, "ironwall"));
}

/** 冲阵 / 硬骨头 / 无可阻挡：一击的击破加成（app.js · dealTo）。isMelee：这一击是近距离（同区）攻击 */
function featBreakBonus(attacker, target, opt, flags, br, dist, isReaction) {
  if (!attacker || !attacker.isPlayer || !flags || flags.environment || flags.action === false) return br;
  const r = attacker.resources = attacker.resources || {};
  if (!isReaction) r.attackSeq = state.actionSeq;   // 跃迁：这次行动真的打出了攻击
  if (featHas(attacker, "charge") && !isReaction && dist === 0 && r.chargeTurn === state.turnNo && r.chargeUsed !== state.turnNo) {
    r.chargeUsed = state.turnNo;
    br += 1;
    if (typeof appendLog === "function") appendLog(`冲阵：${attacker.name} 移动后第一次近距离攻击 +1 击破。`);
  }
  if (featHas(attacker, "tough") && opt && opt._bare) br += 1;
  if (flags.unstoppable) br += FEAT_CFG.unstoppable.brk;
  return br;
}
/** 无可阻挡：挂在下一击上（出手前，app.js · dealTo）。不能被格挡、无视减伤 */
function featArmAttack(attacker, target, opt) {
  if (!attacker || !attacker.isPlayer || !attacker.resources || !attacker.resources.unstoppableNext) return;
  const fl = opt.flags = opt.flags || {};
  if (fl.environment || fl.action === false || fl.aoe) return;
  attacker.resources.unstoppableNext = false;
  fl.unstoppable = true;
  fl.blockResolved = true;
  fl.block = "none";
}

/** 一击打完（app.js · dealTo）：冲阵的不稳、乘势、荒原行者击落飞行 */
function featAfterHit(attacker, target, res, flags, extra, stunnedNow, wasFlying) {
  if (!attacker || !attacker.isPlayer || !target || target.isPlayer || !stunnedNow || target.dead) return;
  if (featHas(attacker, "charge") && typeof applyUnstable === "function") {
    if (applyUnstable(target, extra)) extra.push(`冲阵：${target.name} 额外获得 1 层不稳。`);
  }
  // 击破飞行单位时引擎已经把它击落（target.flying 已是 false），所以要看结算前的飞行状态 wasFlying
  if (featHas(attacker, "wanderer") && (wasFlying || target.flying) && typeof canDisplace === "function") {
    target.flying = false;
    extra.push(`荒原行者：${target.name} 被击落。`);
    if (Number(target.zone) !== Number(attacker.zone) && canDisplace(target)) displaceTo(target, attacker.zone, extra, "被击落");
  }
  if (featHas(attacker, "momentum") && !(flags && flags.momentum)) {
    const others = visibleEnemies(target.zone).filter(u => u.id !== target.id && !u.dead && !u.fused && !u.stunned && Number(u.def) === 1);
    others.forEach(u => dealBreak(u, 1, "none", extra, "乘势", { by: attacker }));
    if (others.length) extra.push(`乘势：${others.map(u => u.name).join("、")} 各受 1 点无属性击破。`);
  }
}

/** 协助格挡成功之后（app.js · dealTo）：推搡把攻击者推开 */
function featAfterBlock(helper, attacker, target, extra) {
  if (!helper || !attacker || attacker.dead || attacker.isPlayer || !featHas(helper, "shove")) return;
  if (typeof enemyRankOf === "function" && enemyRankOf(attacker) === "boss") return;
  if (!canDisplace(attacker)) return;
  const dest = otherZone(attacker.zone, helper.zone);
  if (dest == null || Number(dest) === Number(attacker.zone)) return;
  if (displaceTo(attacker, dest, extra, "被推开")) extra.push(`推搡：${helper.name} 挡下后把 ${attacker.name} 推到 ${dest} 区。`);
}

/** 警戒：敌人走进有警戒的人所在的区（app.js · doMoveInner）。留着附赠动作就打它一下 */
function featAlertOnEnter(unit, notes) {
  if (!unit || unit.isPlayer || unit.dead || state.combatPhase !== "enemy") return;
  (state.units || []).filter(u => u.isPlayer && !u.dead && !u.dying && !u.stunned && !u.hidden &&
    Number(u.zone) === Number(unit.zone) && featHas(u, "alert") && (Number(u.bonus) || 0) >= 1).slice(0, 1).forEach(u => {
    if (unit.dead) return;
    u.bonus -= 1;
    notes.push(`${u.name} 警戒：消耗 1 附赠动作，对走进来的 ${unit.name} 出手。`);
    const out = dealTo(u, unit, { mult: FEAT_CFG.alert.mult, baseBreak: FEAT_CFG.alert.brk, element: "physical", atkRange: "melee",
      flags: { action: false, opportunity: true, blockResolved: true, block: "none" } });
    if (out && out.res) notes.push(`警戒：${unit.name} 受到 ${Math.floor(out.res.total || 0)} 伤害、${out.res.breakDealt || 0} 击破。`);
  });
}

/** 跃迁：用行动点攻击之后（app.js · runSkill）记下这回合可以跃迁 */
function featAfterAction(a, apSpent) {
  if (!a || !a.isPlayer || !featHas(a, "blink") || !apSpent) return;
  a.resources = a.resources || {};
  if (a.resources.attackSeq !== state.actionSeq) return;
  if (a.resources.blinkUsed !== state.turnNo) a.resources.blinkReady = state.turnNo;
}

/** 人器一心：唤出武器人只花附赠（每长休 1 次）；用了的那一场，武器人变回武器不花行动点（party.js · skillCost）。
 *  「这一场用过」记在 resources.featUsed.onemind 上，开战清空（app.js · resetBattleFlags） */
function featCostAdjust(id) {
  const a = featActor();
  if (!a) return null;
  const sid = String(id || "");
  if (/_summon$/.test(sid) && featOnceLeft(a, "onemind")) return { bonus: 1 };
  if (/_return$/.test(sid) && a.weaponOf) {
    const owner = (state.units || []).find(u => u.kit === a.weaponOf);
    if (owner && featHas(owner, "onemind") && ((owner.resources || {}).featUsed || {}).onemind) return {};
  }
  return null;
}
function featCostSpent(a, id) {
  if (a && /_summon$/.test(String(id || "")) && featOnceLeft(a, "onemind")) {
    featUseOnce(a, "onemind");
    a.resources = a.resources || {};
    a.resources.featUsed = Object.assign({}, a.resources.featUsed || {}, { onemind: 1 });   // 这一场收回免费
  }
}

/** 跑团规则下队伍里有没有人带某个专长（档案 h 或场上单位） */
function featPartyHas(list, id) {
  return (list || []).some(h => h && !h.dead && featHas(h, id));
}
function featPartyCount(list, id) {
  return (list || []).filter(h => h && !h.dead && featHas(h, id)).length;
}
/** 巧手匠人：mul 是原来的价格倍率（工匠折扣 / 加价），八折不和别的折扣叠加：取更便宜的 */
function featHaggleMul(list, mul) {
  mul = mul == null ? 1 : Number(mul);
  if (!featExploreOk() || !featPartyHas(list, "haggler")) return mul;
  return mul < 1 ? Math.min(mul, FEAT_CFG.haggle) : mul * FEAT_CFG.haggle;
}
/** 荒野向导：旅行时间倍率 */
function featTravelMul(list) {
  return featExploreOk() && featPartyHas(list, "ranger") ? FEAT_CFG.rangerTravel : 1;
}
/** 赌徒的运气：检定失败改成功（每长休 1 次）。用掉了返回 true */
function featGambleSave(h) {
  if (!featExploreOk() || !featHas(h, "gambler") || typeof useRestOnce !== "function") return false;
  return useRestOnce(h.kit, "feat:gambler", 1);
}

/** 警戒：每场第一次补附赠动作时 +1（app.js · refreshEconomy） */
function featAlertBonus(u) {
  if (!u || !featHas(u, "alert")) return 0;
  u.resources = u.resources || {};
  if (u.resources.alertGiven) return 0;
  u.resources.alertGiven = true;
  return 1;
}
