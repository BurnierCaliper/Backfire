/* =========================================================
 * 争斗（联机新玩法，#543 第 1 步：规则和布置；第 2 步接联机见 online-brawl.js / brawl-ui.js，issue #560）
 * ---------------------------------------------------------
 * 单独开一局的 PvP：两队人数一样（1v1 ~ 4v4），固定等级段（Lv20 · 武器 10 级 / Lv10 · 武器 5 级），
 * 每个角色的专长、属性加点、血量层改造开局自己选，翻硬币定先手，然后照决斗的规则打（enemies.js · PVP_DUEL_CFG、docs/pvp.md 第 1.2、2–6 节）：
 * 不致死（再起不能）、后手开局补偿、3 区制两头站、每队单独计分；允许起身、回合上限开局一起设。
 *
 *   brawlSetup(spec) / 指令 battle.brawl：
 *     { tier: 0 | 1,                 等级段（BRAWL_CFG.tiers 的下标）
 *       size: 1–4,                   每队几人（两队一样）
 *       stand: true / false,         允许起身（不给 = 决斗的默认，允许）
 *       rounds: null / 1–99,         回合上限（null / 不给 = 不限；打开时界面默认 BRAWL_CFG.roundsDefault）
 *       teams: { "1队": [角色…], "2队": [角色…] },
 *       ai: { "1队": false, "2队": true },   哪一队是 AI（AI 只能整队，一队要么全是真人、要么全是 AI）
 *       seed: 可选，装上种子随机数（测试、模拟用：整场可复现） }
 *     角色：{ kit, feats: [专长 id…], attrs: [属性…], featFull: [兼修升级的专长 id]（拿了兼修才给）, cyberPlan: { armor, shield, sand, spirit } 或 null }
 *
 * 养成（每个角色逐个选，照单局 / 跑团升级的规则，不合法就拒绝并写原因，不悄悄改）：
 *   专长   这个等级段应得的几项（rogue-data.js · ROGUE_LEVEL_REWARDS 里 key: "feat" 的那几级：Lv10 是 7 级，Lv20 是 7 / 11 / 13 / 16 级），
 *          按顺序一级一项，合法性照 feats.js · featChoicesFor（层级、不能重复、已会的职责技能、前提）。探索专长（多面手、博闻……）只在跑团规则下提供，争斗不提供
 *   属性   应得的几点（type: "attr"：4 / 8 / 19 级），按顺序一级一点；8 级那一点不能加在之前加过的同一项上（noRepeat）
 *   改造   诊所的规则（growth.js · cyberPlanError / cyberLayersFor / CYBER_RATIO，跑团的做法见 trpg.js · trpgCyberPreview）：
 *          可换的肉体上限照改造率上限算（按选完属性以后的智力、等级），不收钱
 *   职责   不用选：职责绑定角色（growth.js · roleChoicesAt，ROLE_PATH_CHOICE = false 时每一级只有一个选项），照角色自己的给
 *   熟练项 不选、不给（type: "prof" 的那几级）；角色卡自带的熟练照旧
 *   不带   义体、改装件 / 图纸、道具（背包是空的）
 *
 * 和存档无关：开局把队伍档案（LEDGER）、背包、奎支整份收起来，换成一份空的；打完（ledger.js · ledgerAfterBattle → enemies.js · pvpDuelRestore）
 * 或者开新的一场（app.js · resetBattleRecords）时原样放回去（brawlRestore）。不读也不写玩家的跑团角色，打完不给经验、奎支、掉落，不记战场数据（照决斗）。
 * 两队可以用同一个角色：按 kit 找单位的地方改成按单位 id / 结算上下文找（party.js · findKit / withKitScope / weaponOwnerUnit），
 * 武器耐久、长休次数这些按 kit 记的两个人分开记（ledger.js · ledgerKitKey → brawlKitKey）。
 * AI 整队：标成 AI 的那一队用 BattleSim.SKILL_POLICY 自动行动（brawlPolicy）。行动顺序沿用联机现在那一套（hotseat.js）；
 * 联机时 AI 是会话里的一个操作者，轮到它由房主替它出手（online-brawl.js · tick / decide）。
 * ========================================================= */
const BRAWL_CFG = {
  // 等级段：等级、这个角色所有武器的等级
  tiers: [
    { id: 0, name: "Lv20 · 武器 10 级", level: 20, weapon: 10 },
    { id: 1, name: "Lv10 · 武器 5 级", level: 10, weapon: 5 }
  ],
  sizeMin: 1,            // 每队至少几人
  sizeMax: 4,            // 每队最多几人（两队一样）
  roundsDefault: 10,     // 打开「限定回合数」时界面的默认回合数（和决斗一样，enemies.js · PVP_DUEL_CFG.roundsDefault）
  // AI 队：BattleSim.skillPolicy 的设置（盖在 sim-search.js · SKILL_POLICY_CFG 上）。争斗不带道具
  ai: { cfg: { items: false } },
  // 平衡模拟（tools/pvp-balance.js --brawl）用的固定一套养成：每个角色都合法的被动专长、主属性加点、一半可换的肉体换成装甲
  sim: {
    feats: { 7: "tough", 11: "charge", 13: "momentum", 16: "revive" },      // 每一级拿哪项（硬骨头 / 冲阵 / 乘势 / 还魂：谁都能选）
    main: { tou: "con", yuito: "int", xia: "str", ruby: "int", hiaki: "str", chuan: "int", nora: "int", kolt: "str", helu: "int", ras: "int", longge: "int" },
    alt: "con", altIfMain: "sta",                                            // 8 级那一点不能重复：加体质（主属性就是体质的加耐力）
    cyber: { armor: 0.5 }                                                    // 可换的肉体里多少换成装甲（向下取整）
  }
};

/* ---------- 规则表 ---------- */
/** 能选的角色：角色卡里不是武器的那几张 */
function brawlHeroKits() {
  return (typeof livePartyCards === "function" ? livePartyCards() : []).filter(c => !c.weaponOf).map(c => c.kit);
}
/** 这个等级段应得的升级奖励：{ feats: [等级…], attrs: [{ level, noRepeat }…], roles: [等级…] }（rogue-data.js · ROGUE_LEVEL_REWARDS，按等级从低到高） */
function brawlRewards(level) {
  const out = { feats: [], attrs: [], roles: [] };
  const R = typeof ROGUE_LEVEL_REWARDS !== "undefined" ? ROGUE_LEVEL_REWARDS : {};
  Object.keys(R).map(Number).filter(L => L <= level).sort((a, b) => a - b).forEach(L => (R[L] || []).forEach(r => {
    if (r.type === "note" && r.key === "feat") out.feats.push(L);
    else if (r.type === "attr") out.attrs.push({ level: L, noRepeat: !!r.noRepeat });
    else if (r.type === "role") out.roles.push(L);
  }));
  return out;
}
/** 等级段（tier 是 BRAWL_CFG.tiers 的下标） */
function brawlTier(tier) {
  return Number.isInteger(tier) && tier >= 0 && tier < BRAWL_CFG.tiers.length ? BRAWL_CFG.tiers[tier] : null;
}
function brawlCard(kit) {
  return (typeof livePartyCards === "function" ? livePartyCards() : []).find(c => c.kit === kit && !c.weaponOf) || null;
}
/** 争斗能选的专长：feats.js · featChoicesFor 的结果里去掉探索专长、跑团专用的（争斗不按跑团规则；熟练项也不给） */
function brawlFeatOk(f) { return !!f && !f.explore && !f.trpgOnly; }

/* ---------- 校验 ---------- */
const BRAWL_FIELDS = ["type", "tier", "size", "stand", "rounds", "teams", "ai", "seed"];
const BRAWL_HERO_FIELDS = ["kit", "feats", "attrs", "featFull", "cyberPlan"];
const BRAWL_CYBER_FIELDS = ["armor", "shield", "sand", "spirit"];
/** 争斗用的两队（照决斗：PVP_DUEL_CFG.teams） */
function brawlTeams() { return (typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG.teams : [{ id: "1队", name: "1 队" }, { id: "2队", name: "2 队" }]); }
const brawlFail = (why) => { throw new Error("争斗：" + why); };
const plainObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** 养成的底子：角色卡的属性、这个等级段的职责（照角色自己的那一条路线：每一级只有一个选项；万一以后打开了路线选择，也只取第一个，不在这里选）。
 *  brawlBuild 和选养成的菜单（brawlChoices）用同一份 */
function brawlHeroBase(card, tier) {
  const R = brawlRewards(tier.level);
  const h = { kit: card.kit, level: tier.level, attrs: Object.assign({}, card.attrs || {}), attrPicks: [], feats: [], featFull: [], rolePicks: {}, role2: null, role2Picks: [] };
  R.roles.forEach(L => {
    const u = spawnLiveCard(card, 1);
    u.level = L;
    u.rolePicks = Object.assign({}, h.rolePicks);
    const opts = typeof roleChoicesAt === "function" ? roleChoicesAt(u, L) : [];
    if (opts[0]) h.rolePicks[L] = { role: opts[0].role, n: opts[0].n };
  });
  return h;
}
/** 这一项专长（id）在第 L 级为什么不能选（feats.js · featChoicesFor 不列它的原因；h 是选到这一步的养成） */
function brawlFeatWhy(h, id, L) {
  const f = featDef(id);
  if (!f) return "不认识这项专长";
  if (!brawlFeatOk(f)) return "探索专长只在跑团规则下提供，争斗不提供";
  return (FEAT_TIER_LEVEL[f.tier] || 0) > L ? `要 ${FEAT_TIER_LEVEL[f.tier]} 级才能选`
    : !f.repeatable && featCount(h, id) > 0 ? "已经有了，不能重复"
    : typeof f.requires === "function" && f.requires(h) ? f.requires(h)
    : f.dabble ? "已经会这个职责技能了" : "不能选";
}

/** 一个角色的养成：照规则一项一项做，不合法就拒绝。返回 { kit, name, level, weapon, attrs, attrPicks, feats, featFull, rolePicks, cyberPlan, fleshMax, rate, limit } */
function brawlBuild(entry, tier, label) {
  const at = label || "";
  if (!plainObj(entry)) brawlFail(`${at}每个角色要写成 { kit, feats, attrs, cyberPlan }`);
  Object.keys(entry).forEach(k => { if (!BRAWL_HERO_FIELDS.includes(k)) brawlFail(`${at}不认识的字段 ${k}`); });
  const card = typeof entry.kit === "string" && brawlHeroKits().includes(entry.kit) ? brawlCard(entry.kit) : null;
  if (!card) brawlFail(`${at}没有这名角色：${entry.kit}`);
  const name = card.name;
  const R = brawlRewards(tier.level);
  const h = brawlHeroBase(card, tier);
  // 属性加点：4 / 8 / 19 级各一点，8 级那点不能加在之前加过的同一项上
  const attrs = entry.attrs;
  if (!Array.isArray(attrs)) brawlFail(`${at}${name} 的属性加点要写成数组（${R.attrs.length} 点）`);
  if (attrs.length !== R.attrs.length) brawlFail(`${at}${name} 的属性加点要 ${R.attrs.length} 点（${R.attrs.map(a => a.level + " 级").join("、") || "这个等级段没有"}），给了 ${attrs.length} 点`);
  const names = typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES : { str: 1, con: 1, dex: 1, wil: 1, int: 1, sta: 1 };
  R.attrs.forEach((p, i) => {
    const v = attrs[i];
    if (typeof v !== "string" || !Object.prototype.hasOwnProperty.call(names, v)) brawlFail(`${at}${name} ${p.level} 级的属性加点不认识：${v}`);
    if (p.noRepeat && h.attrPicks.includes(v)) brawlFail(`${at}${name} ${p.level} 级的属性加点不能加在之前加过的同一项上（${names[v]}）`);
    h.attrs[v] = (Number(h.attrs[v]) || 0) + 1;
    h.attrPicks.push(v);
  });
  // 专长：7 / 11 / 13 / 16 级各一项，按顺序；可以选本级或更低级的（feats.js · featChoicesFor），探索专长不提供
  const feats = entry.feats;
  if (!Array.isArray(feats)) brawlFail(`${at}${name} 的专长要写成数组（${R.feats.length} 项）`);
  if (feats.length !== R.feats.length) brawlFail(`${at}${name} 的专长要 ${R.feats.length} 项（${R.feats.map(L => L + " 级").join("、") || "这个等级段没有"}），给了 ${feats.length} 项`);
  let fullOwed = 0;
  R.feats.forEach((L, i) => {
    const id = feats[i];
    const f = typeof featDef === "function" ? featDef(id) : null;
    if (typeof id !== "string" || !f) brawlFail(`${at}${name} ${L} 级的专长不认识：${id}`);
    if (!brawlFeatOk(f)) brawlFail(`${at}${name} ${L} 级不能选「${f.name}」：探索专长只在跑团规则下提供，争斗不提供`);
    const legal = featChoicesFor(h, L).filter(x => brawlFeatOk(featDef(x)));
    if (!legal.includes(id)) brawlFail(`${at}${name} ${L} 级不能选「${f.name}」：${brawlFeatWhy(h, id, L)}`);
    h.feats.push(id);
    const more = typeof f.onTake === "function" ? f.onTake(h) || [] : [];
    more.forEach(x => { if (x.type === "featFull") fullOwed++; });
  });
  // 兼修：选一张 ①–③ 的职责涉猎专长升成完整版（拿了兼修才有，一项兼修选一张）
  const full = entry.featFull == null ? [] : entry.featFull;
  if (!Array.isArray(full)) brawlFail(`${at}${name} 的兼修要写成数组`);
  if (full.length !== fullOwed) brawlFail(fullOwed ? `${at}${name} 拿了兼修，要选 ${fullOwed} 张升成完整版的涉猎专长（featFull），给了 ${full.length} 张` : `${at}${name} 没有兼修，不能选兼修升级（featFull）`);
  full.forEach(id => {
    if (!featFullOptions(h).includes(id)) brawlFail(`${at}${name} 兼修不能升级「${(featDef(id) || {}).name || id}」：要选身上 ①–③ 层、还没升过的职责涉猎专长`);
    h.featFull.push(id);
  });
  // 血量层改造：照诊所的规则（可换的肉体上限 = 改造率 × 肉体上限，按选完属性以后算），不收钱
  const fleshMax = card.attrs ? derivedFromAttrs(h.attrs, tier.level).hp : (card.layers || []).reduce((s, l) => s + (Number(l.hp) || 0), 0);
  const rate = cyberRateOf(h.attrs, tier.level);
  let plan = null;
  if (entry.cyberPlan != null) {
    const p = entry.cyberPlan;
    if (!plainObj(p)) brawlFail(`${at}${name} 的改造方案要写成 { armor, shield, sand, spirit }`);
    Object.keys(p).forEach(k => { if (!BRAWL_CYBER_FIELDS.includes(k)) brawlFail(`${at}${name} 的改造方案不认识 ${k}（只有 armor 装甲、shield 护盾、sand 沙尘、spirit 星灵）`); });
    ["armor", "shield", "sand"].forEach(k => { if (p[k] != null && !(Number.isInteger(p[k]) && p[k] >= 0)) brawlFail(`${at}${name} 的改造量必须是非负整数（${k}：${p[k]}）`); });
    if (p.spirit != null && typeof p.spirit !== "boolean") brawlFail(`${at}${name} 的改造方案 spirit（换成星灵）只收 true / false`);
    const norm = { armor: p.armor || 0, shield: p.shield || 0, sand: p.sand || 0, spirit: !!p.spirit };
    const err = cyberPlanError(norm, fleshMax, rate);
    if (err) brawlFail(`${at}${name} 的改造方案不合法：${err}`);
    plan = norm.armor || norm.shield || norm.sand || norm.spirit ? norm : null;
  }
  return { kit: card.kit, name, level: tier.level, weapon: tier.weapon, attrs: h.attrs, attrPicks: h.attrPicks, feats: h.feats, featFull: h.featFull,
    rolePicks: h.rolePicks, cyberPlan: plan, fleshMax, rate, limit: cyberConvertLimit(fleshMax, rate) };
}

/* ---------- 选养成的菜单（#543 第 2 步：联机房间里一项一项选，brawl-ui.js；房主照样用 brawlBuild 校验） ---------- */
/** kit 在等级段 tierIndex、照草稿 draft（{ attrs, feats, featFull, cyberPlan }，没选的写 null）每一步能选什么。和 brawlBuild 同一套规则、同一个顺序
 *  （先属性、再专长；前面几步选的算进去）。返回
 *    { kit, level, attrs: [{ level, noRepeat, pick, options: [属性…], bad }], feats: [{ level, pick, options: [专长 id…], bad }],
 *      full: { need, picks, options }, cyber: { fleshMax, rate, limit, plan, layers, bad }, error }
 *  bad：这一步选了、可是照前面的选择已经不能选（写原因，不悄悄换掉）；error：整份交给 brawlBuild 的结果（null = 合法、选完了）。
 *  只有养成本身的数字（属性、血量层），不含坚毅生命 */
function brawlChoices(kit, tierIndex, draft) {
  const tier = brawlTier(tierIndex), card = brawlHeroKits().includes(kit) ? brawlCard(kit) : null;
  if (!tier || !card) return null;
  const d = plainObj(draft) ? draft : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const R = brawlRewards(tier.level), h = brawlHeroBase(card, tier);
  const names = typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES : { str: 1, con: 1, dex: 1, wil: 1, int: 1, sta: 1 };
  const attrs = R.attrs.map((p, i) => {
    const v = list(d.attrs)[i];
    const pick = typeof v === "string" && Object.prototype.hasOwnProperty.call(names, v) ? v : null;
    const options = Object.keys(names).filter(k => !(p.noRepeat && h.attrPicks.includes(k)));
    const bad = pick && !options.includes(pick) ? `不能加在之前加过的同一项上（${names[pick]}）` : null;
    if (pick && !bad) { h.attrs[pick] = (Number(h.attrs[pick]) || 0) + 1; h.attrPicks.push(pick); }
    return { level: p.level, noRepeat: p.noRepeat, pick, options, bad };
  });
  let owed = 0;
  const feats = R.feats.map((L, i) => {
    const v = list(d.feats)[i];
    const pick = typeof v === "string" && featDef(v) ? v : null;
    const options = featChoicesFor(h, L).filter(x => brawlFeatOk(featDef(x)));
    const bad = pick && !options.includes(pick) ? brawlFeatWhy(h, pick, L) : null;
    if (pick && !bad) {
      h.feats.push(pick);
      const f = featDef(pick);
      (typeof f.onTake === "function" ? f.onTake(h) || [] : []).forEach(x => { if (x.type === "featFull") owed++; });
    }
    return { level: L, pick, options, bad };
  });
  const fullOptions = typeof featFullOptions === "function" ? featFullOptions(h) : [];
  const full = { need: owed, picks: list(d.featFull).filter(x => typeof x === "string").slice(0, owed), options: fullOptions };
  const fleshMax = card.attrs ? derivedFromAttrs(h.attrs, tier.level).hp : (card.layers || []).reduce((s, l) => s + (Number(l.hp) || 0), 0);
  const rate = cyberRateOf(h.attrs, tier.level), limit = cyberConvertLimit(fleshMax, rate);
  const p = plainObj(d.cyberPlan) ? d.cyberPlan : null;
  const plan = p ? { armor: Math.max(0, Math.floor(Number(p.armor) || 0)), shield: Math.max(0, Math.floor(Number(p.shield) || 0)), sand: Math.max(0, Math.floor(Number(p.sand) || 0)), spirit: !!p.spirit } : null;
  const cyber = { fleshMax, rate, limit, plan, layers: cyberLayersFor(fleshMax, plan || {}), bad: plan ? cyberPlanError(plan, fleshMax, rate) : null };
  let error = null;
  const missing = attrs.filter(a => !a.pick).length + feats.filter(f => !f.pick).length + Math.max(0, full.need - full.picks.length);
  if (missing) error = `还没选完：还差 ${missing} 项`;
  else {
    const entry = { kit, attrs: attrs.map(a => a.pick), feats: feats.map(f => f.pick), cyberPlan: plan };
    if (full.need) entry.featFull = full.picks.slice();
    try { brawlBuild(entry, tier, ""); } catch (e) { error = String(e.message || e).replace(/^争斗：/, ""); }
  }
  return { kit, level: tier.level, attrs, feats, full, cyber, error };
}

/** 校验整份 spec（字段、等级段、人数、队伍、队内不重复、每个角色的养成）。不合法抛出写着原因的错误；合法返回整理好的
 *  { tier, size, stand, rounds, ai, seed, builds: { "1队": [养成…], "2队": [...] } } */
function brawlCheck(spec) {
  if (!plainObj(spec)) brawlFail("spec 要是一个对象");
  Object.keys(spec).forEach(k => { if (!BRAWL_FIELDS.includes(k)) brawlFail("不认识的字段 " + k); });
  const tier = brawlTier(spec.tier);
  if (!tier) brawlFail(`等级段只有 ${BRAWL_CFG.tiers.map((t, i) => `${i}（${t.name}）`).join("、")}，给了 ${spec.tier}`);
  const size = spec.size;
  if (!(Number.isInteger(size) && size >= BRAWL_CFG.sizeMin && size <= BRAWL_CFG.sizeMax)) brawlFail(`每队人数要 ${BRAWL_CFG.sizeMin}–${BRAWL_CFG.sizeMax}，给了 ${size}`);
  if (spec.stand != null && typeof spec.stand !== "boolean") brawlFail("允许起身（stand）只收 true / false");
  const roundsMax = typeof PVP_DUEL_CFG !== "undefined" ? PVP_DUEL_CFG.roundsMax : 99;
  if (spec.rounds != null && !(Number.isInteger(spec.rounds) && spec.rounds >= 1 && spec.rounds <= roundsMax)) brawlFail(`回合上限（rounds）只收 null 或 1–${roundsMax}`);
  if (spec.seed != null && !(typeof spec.seed === "string" || Number.isFinite(spec.seed))) brawlFail("seed 要是字符串或数字");
  const teams = brawlTeams(), ids = teams.map(t => t.id);
  if (!plainObj(spec.teams)) brawlFail("teams 要写成 { \"1队\": [...], \"2队\": [...] }");
  Object.keys(spec.teams).forEach(k => { if (!ids.includes(k)) brawlFail("没有这一队：" + k); });
  const ai = {};
  if (spec.ai != null && !plainObj(spec.ai)) brawlFail("ai 要写成 { \"1队\": true / false, \"2队\": true / false }");
  Object.keys(spec.ai || {}).forEach(k => {
    if (!ids.includes(k)) brawlFail("ai 里没有这一队：" + k);
    if (typeof spec.ai[k] !== "boolean") brawlFail(`ai.${k} 只收 true / false（AI 只能整队：一队要么全是真人，要么全是 AI）`);
  });
  const builds = {};
  teams.forEach(t => {
    const list = spec.teams[t.id];
    if (!Array.isArray(list)) brawlFail(`${t.name}要写成角色数组`);
    if (list.length !== size) brawlFail(`两队人数要一样，每队 ${size} 人：${t.name}给了 ${list.length} 人`);
    const seen = new Set();
    builds[t.id] = list.map((entry, i) => {
      const b = brawlBuild(entry, tier, `${t.name}第 ${i + 1} 个角色：`);
      if (seen.has(b.kit)) brawlFail(`${t.name}里不能有两个${b.name}（同一队里角色不能重复，两队之间可以）`);
      seen.add(b.kit);
      return b;
    });
    ai[t.id] = !!(spec.ai && spec.ai[t.id]);
  });
  return { tier: spec.tier, tierInfo: tier, size, stand: spec.stand == null ? null : spec.stand, rounds: spec.rounds == null ? null : spec.rounds, ai, seed: spec.seed == null ? null : spec.seed, builds };
}

/* ---------- 造角色 ---------- */
/** 照养成造一个场上的角色：等级、所有武器的等级、职责、属性、专长、改造；没有义体、改装件、图纸，满血满坚毅 */
function brawlHeroUnit(b, zone) {
  const u = spawnLiveCard(brawlCard(b.kit), zone || 1);
  u.weaponHeld = true;
  u.level = b.level; u.xp = 0; u.attrPoints = 0; u.featPoints = 0; u.featPointLevels = [];
  u.attrs = Object.assign({}, b.attrs);
  u.attrPicks = b.attrPicks.slice();
  u.rolePicks = JSON.parse(JSON.stringify(b.rolePicks));
  u.role2 = null; u.role2Picks = [];
  u.feats = b.feats.slice();
  u.featFull = b.featFull.slice();
  u.cyberware = []; delete u.cyberOverinstall;
  u.weaponParts = {}; u.weaponBlueprints = {};
  delete u.profs;   // 熟练项不给：只有角色卡自带的（app.js · unitProfLevel 照角色卡）
  u.weaponLevels = {};
  (u.linkedKits || []).forEach(k => { u.weaponLevels[k] = b.weapon; });
  // 改造：先摆一层肉体给 applyLevelStats 照方案重建（和队伍记忆盖回来一样，app.js · applyCampaignHero）
  if (b.cyberPlan) { u.cyberPlan = Object.assign({}, b.cyberPlan); u.layers = [{ type: "flesh", current: 1, max: 1, inner: true }]; }
  else u.cyberPlan = null;
  applyLevelStats(u);
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
  u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
  resetBattleFlags(u);
  (u.layers || []).forEach(l => { l.current = l.max; });
  u.def = u.defMax;
  u.shp = u.shpMax;
  return u;
}

/* ---------- 布置 ---------- */
// 争斗开局收起来的队伍档案 / 背包 / 奎支（只在本机，不放进 state：不发给玩家，沙盒试跑也不拷它）
let BRAWL_STASH = null;
/** 现在是不是争斗 */
function brawlOn() { return !!(typeof state !== "undefined" && state && state.brawl && typeof pvpDuelOn === "function" && pvpDuelOn()); }
/** 收起玩家的队伍档案 / 背包 / 奎支，换成空的（争斗不读也不写存档） */
function brawlStash() {
  if (BRAWL_STASH) brawlRestore();   // 上一场争斗没打完就开了这一场：先把真正的档案放回去，不然会把临时的那份当成存档收起来
  BRAWL_STASH = { ledger: typeof LEDGER !== "undefined" && LEDGER ? LEDGER.save() : null, bag: JSON.parse(JSON.stringify(state.bag || null)), kuizhi: Number(state.kuizhi) || 0 };
  if (typeof LEDGER !== "undefined" && LEDGER) LEDGER.reset();
  state.bag = { items: [], water: 0 };
  state.kuizhi = 0;
}
/** 打完 / 开新的一场：把收起来的队伍档案 / 背包 / 奎支原样放回去（只做一次；没收过就什么都不做）。返回 true = 放回去了 */
function brawlRestore() {
  if (!BRAWL_STASH) return false;
  const s = BRAWL_STASH;
  BRAWL_STASH = null;
  state.bag = s.bag;
  state.kuizhi = s.kuizhi;
  if (s.ledger && typeof LEDGER !== "undefined" && LEDGER) LEDGER.load(JSON.parse(JSON.stringify(s.ledger)));
  return true;
}
/** 收起来的还没放回去（测试用） */
function brawlStashed() { return !!BRAWL_STASH; }
/** 争斗打完、收起来的那一份已经放回去了，场上却还是争斗的角色（联机房主的结算画面、回到房间之后）：
 *  这时画面读这些角色的耐久这类按 kit 记的东西，不往放回去的那份档案里写（ledger.js · weaponDur）——争斗不读也不写存档 */
function brawlLedgerFrozen() { const d = brawlOn() && typeof pvpDuelState === "function" ? pvpDuelState() : null; return !!(d && d.restored); }
/** 联机房主刷新页面（#543 第 2 步，online-brawl.js · checkpoint / restore）：收起来的那一份跟着房主本机的联机存档走，
 *  恢复以后打完照样放回去（不然打完会把争斗用的那份空档案当成队伍档案留下）。只在房主本机，不发给玩家 */
function brawlStashSave() { return BRAWL_STASH ? JSON.parse(JSON.stringify(BRAWL_STASH)) : null; }
function brawlStashLoad(s) { BRAWL_STASH = s && typeof s === "object" ? JSON.parse(JSON.stringify(s)) : null; }

/** 布置一场争斗（指令 battle.brawl）：校验 → 收起存档 → 照养成造两队的角色 → 布置成决斗（3 区制、1 队 1 区 / 2 队 3 区、两个互相敌对的玩家阵营）→ 翻硬币定先手。
 *  之后照常开战（startCombat：后手补偿在这时给）。返回 { brawl: 公开部分, duel: 决斗的公开部分 } */
function brawlSetup(spec) {
  const c = brawlCheck(spec);
  // 清场：照无界面战斗的布置（不带遭遇、不带敌人），再换上争斗的角色
  BattleSim.setup({ party: [c.builds[brawlTeams()[0].id][0].kit], enemies: [], seed: c.seed == null ? undefined : c.seed, zoneMode: 3,
    before: () => { state.units = []; } });
  brawlStash();
  state.weaponMods = null; state.weaponBlueprints = null; state.exhaustTier = 0; state.solo = null; state.lootByRank = null; state.lootByKit = null;
  const teams = {}, roster = {};
  brawlTeams().forEach(t => {
    teams[t.id] = c.builds[t.id].map(b => {
      const u = brawlHeroUnit(b, t.zone || 1);
      state.units.push(u);
      roster[u.id] = { team: t.id, kit: b.kit, feats: b.feats.slice(), featFull: b.featFull.slice(), attrPicks: b.attrPicks.slice(), cyberPlan: b.cyberPlan ? Object.assign({}, b.cyberPlan) : null };
      return u.id;
    });
  });
  if (typeof randomizeNoraMood === "function") randomizeNoraMood();
  if (typeof syncPartySizeFromField === "function") syncPartySizeFromField();
  const tier = c.tierInfo;
  state.brawl = { tier: c.tier, level: tier.level, weapon: tier.weapon, size: c.size, ai: Object.assign({}, c.ai), roster };
  const duelCmd = { type: "battle.duel", teams };
  if (c.stand != null) duelCmd.stand = c.stand;
  if (c.rounds != null) duelCmd.rounds = c.rounds;
  pvpDuelSetup(duelCmd);
  state.pvpDuel.brawl = true;
  // 翻硬币：全部选完就定先手（startCombat 里不再抛，enemies.js · pvpDuelToss）
  pvpDuelToss();
  appendLog(`争斗：${tier.name}，${c.size}v${c.size}${brawlTeams().filter(t => c.ai[t.id]).map(t => `，${t.name}是 AI`).join("")}。`);
  return { brawl: brawlPublic(), duel: pvpDuelPublic() };
}
/** 争斗的公开部分（给画面、联机玩家看）：等级段、人数、哪一队是 AI、两队的角色（单位 id、kit）、谁先手。不含养成的细节、坚毅这些 */
function brawlPublic() {
  const b = typeof state !== "undefined" && state ? state.brawl : null;
  if (!b || !brawlOn()) return null;
  const d = pvpDuelState();
  const teams = {};
  brawlTeams().forEach(t => { teams[t.id] = (d.teams[t.id] || []).map(id => ({ id, kit: (b.roster[id] || {}).kit || null })); });
  return JSON.parse(JSON.stringify({ tier: b.tier, level: b.level, weapon: b.weapon, size: b.size, ai: b.ai, teams, first: d.first || null }));
}

/* ---------- 两队同一个角色：按 kit 记的东西分开记 ---------- */
/** ledger.js · ledgerKitKey：争斗里按 kit 记的长休 / 短休次数、武器耐久、本场受损，接上这个人那一队（「xia@1队」）。
 *  who：角色或武器人（不给就按 kit 找：角色本人，或者这把武器的持有者——两队同一个角色时看结算上下文，party.js · findKit）。不是争斗返回 kit */
function brawlKitKey(kit, who) {
  if (!brawlOn() || !kit) return kit;
  let u = who || null;
  if (!u) u = findKit(kit, state.units) || (typeof weaponOwner === "function" ? weaponOwner(kit) : null);
  const team = u ? pvpDuelTeamOf(u) : null;
  return team ? kit + "@" + team : kit;
}

/* ---------- AI 整队 ---------- */
/** 这个单位归 AI 管吗：标成 AI 的那一队的角色和它的武器人 */
function brawlAiUnit(u) {
  if (!brawlOn() || !u) return false;
  const t = pvpDuelTeamOf(u);
  return !!(t && state.brawl.ai && state.brawl.ai[t]);
}
/** 这一队是不是 AI */
function brawlAiTeam(teamId) { return !!(brawlOn() && state.brawl.ai && state.brawl.ai[teamId]); }
/** AI 整队的打法（BattleSim.run 的 policy）：AI 那一队的人轮到时用 SKILL_POLICY（BRAWL_CFG.ai.cfg：不带道具）自动行动，
 *  格挡、协助攻击、全员倒地问起身也替他们答（照 BASIC_POLICY）；不是 AI 的那一队交给 opt.human（测试 / 模拟里给一个打法；
 *  不给 = 不行动、不格挡、不协助——真人在画面上自己操作，第 2 步接联机）。stats：AI 做了什么（BattleSim.skillPolicy 的统计） */
function brawlPolicy(opt) {
  opt = opt || {};
  const ai = BattleSim.skillPolicy({ cfg: Object.assign({}, BRAWL_CFG.ai.cfg, opt.cfg || {}) });
  const human = opt.human || null;
  const B = BattleSim.BASIC_POLICY;
  const teamAi = (list) => list.length && brawlAiUnit(list[0]);
  return Object.assign({}, B, {
    name: "brawl",
    ai, stats: ai.stats,
    act(u) {
      if (brawlAiUnit(u)) return ai.act(u);
      return human && typeof human.act === "function" ? human.act(u) : null;
    },
    pickBlocker(helpers, attacker, target) {
      const mine = helpers.filter(h => brawlAiUnit(h) === brawlAiUnit(target));
      if (!mine.length) return null;
      if (brawlAiUnit(target)) return ai.pickBlocker(mine, attacker, target);
      return human && typeof human.pickBlocker === "function" ? human.pickBlocker(mine, attacker, target) : null;
    },
    pickAssister(list, target) {
      if (teamAi(list)) return ai.pickAssister(list.filter(x => brawlAiUnit(x)), target);
      return human && typeof human.pickAssister === "function" ? human.pickAssister(list, target) : null;
    },
    standAsk(u, zones) {
      if (brawlAiUnit(u)) return (ai.standAsk || B.standAsk)(u, zones);
      return human && typeof human.standAsk === "function" ? human.standAsk(u, zones) : { stand: false };
    }
  });
}

/* ---------- 平衡模拟用的固定一套养成（tools/pvp-balance.js --brawl） ---------- */
/** 照 BRAWL_CFG.sim 给 kit 在这个等级段造一份合法的养成（spec 里的一个角色） */
function brawlSimEntry(kit, tierIndex) {
  const tier = brawlTier(tierIndex);
  if (!tier) brawlFail("没有这个等级段：" + tierIndex);
  const S = BRAWL_CFG.sim, R = brawlRewards(tier.level);
  const main = S.main[kit] || "con", alt = main === S.alt ? S.altIfMain : S.alt;
  const attrs = R.attrs.map(p => (p.noRepeat ? alt : main));
  const feats = R.feats.map(L => S.feats[L]);
  const card = brawlCard(kit);
  const a = Object.assign({}, (card && card.attrs) || {});
  attrs.forEach(v => { a[v] = (Number(a[v]) || 0) + 1; });
  const fleshMax = derivedFromAttrs(a, tier.level).hp, rate = cyberRateOf(a, tier.level);
  const armor = Math.floor(cyberConvertLimit(fleshMax, rate) * (Number(S.cyber.armor) || 0));
  return { kit, feats, attrs, cyberPlan: armor > 0 ? { armor } : null };
}
