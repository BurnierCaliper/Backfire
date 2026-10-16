/* 角鳞 · 跑团模式：探索环节的规则（界面在 trpg-ui.js）
 *
 * 跑团模式一切按原手册：正常经验曲线、敌人按手册逐个掉落、物价与武器升级按手册，
 * 坚毅生命对主持人可见。战斗环节就是战斗画面；探索环节里主持人手动操作：
 * 买东西、推进时间、短休 / 长休、升级武器、用道具、发经验、分配属性点。
 *
 * 所有操作都作用在场上的队伍（state.units）和队伍档案（LEDGER、背包、奎支）上，
 * 做完调用 trpgSave（由界面传进来，存到战斗原型的「队伍记忆」里），下一场战斗照这个状态开打。
 * 每个函数返回写给日志的几行文字。 */

const TRPG = {
  active: false,
  lastRest: null,    // 最近一次长休的结算（ledger.js · restReport）
  camp: null,        // 营地（长休前）：{ plan, force, status: ledger.js · campStatus }；联机玩家也看到
  taskBattle: null   // 正在打的任务战斗 { id, index }（trpg-tasks.js）
};

function trpgHeroes() {
  return typeof partyHeroes === "function" ? partyHeroes() : [];
}

/* ---------- 商店 ---------- */
function trpgShopRow(key) {
  return HANDBOOK_SHOP.find(r => r.key === key) || null;
}
function trpgShopName(row) {
  if (!row) return "";
  if (row.name) return row.name;
  const it = row.give && row.give.item && ITEM_CATALOG[row.give.item];
  return it ? it.name : row.key;
}
/** 买 qty 份。free：主持人直接给，不扣钱 */
function trpgBuy(key, qty, free) {
  const row = trpgShopRow(key);
  qty = Math.max(1, Math.floor(Number(qty) || 1));
  if (!row) return ["没有这件商品。"];
  const cost = Math.round(row.price * qty * (typeof featHaggleMul === "function" ? featHaggleMul(trpgHeroes(), 1) : 1));   // 巧手匠人：八折
  if (!free && (Number(state.kuizhi) || 0) < cost) return [`奎支不够：${trpgShopName(row)} ×${qty} 要 ${cost}，手里只有 ${Number(state.kuizhi) || 0}。`];
  if (!free) state.kuizhi = (Number(state.kuizhi) || 0) - cost;
  if (row.give.water) setLedgerWater(ledgerWater() + row.give.water * qty);
  if (row.give.item) bagAdd(row.give.item, qty);
  const out = [`${free ? "主持人给予" : "买下"} ${trpgShopName(row)} ×${qty}${free ? "" : `，花掉 ${cost} 奎支（剩 ${state.kuizhi}）`}。`];
  if (!free) trpgEarnPoints(cost, out);
  return out;
}

/* ---------- 工坊（docs/workshop-design.md 第 5–7 节）----------
 * 配方、商店积分记在队伍账上（LEDGER.workshop），跟着存档空位走。
 * 制作检定照常由玩家掷：主持人可以让程序掷，也可以直接记下玩家掷出的结果；难度可以改。地点不强制，主持人按剧情判断。 */
function trpgWorkshop() {
  if (!LEDGER.workshop) LEDGER.workshop = { recipes: [], points: 0, carry: 0 };
  return LEDGER.workshop;
}
function trpgEarnPoints(spent, out) {
  const per = typeof ROGUE_SHOP_POINTS !== "undefined" ? Number(ROGUE_SHOP_POINTS.per) || 0 : 0;
  if (!per || !(spent > 0)) return;
  const w = trpgWorkshop();
  const total = w.carry + spent, got = Math.floor(total / per);
  w.carry = total - got * per;
  w.points += got;
  if (got && out) out.push(`商店积分 +${got} → ${w.points}。`);
}
function trpgPointsInfo() {
  const w = trpgWorkshop(), per = typeof ROGUE_SHOP_POINTS !== "undefined" ? Number(ROGUE_SHOP_POINTS.per) || 0 : 0;
  return { points: w.points, carry: w.carry, per, next: per ? per - w.carry : 0 };
}
function trpgAdjustPoints(n, why) {
  n = Math.floor(Number(n) || 0);
  if (!n) return [];
  const w = trpgWorkshop();
  w.points = Math.max(0, w.points + n);
  return [`商店积分 ${n > 0 ? "+" : ""}${n}${why ? "（" + why + "）" : ""}，现有 ${w.points}。`];
}
function trpgRedeem(itemId) {
  const it = EFFECT_ITEMS.find(x => x.id === itemId && x.points > 0);
  if (!it) return ["这件东西不能用积分兑换。"];
  const w = trpgWorkshop();
  if (w.points < it.points) return [`积分不够：${it.name} 要 ${it.points}，现有 ${w.points}。`];
  w.points -= it.points;
  bagAdd(it.id, 1);
  return [`用 ${it.points} 积分兑换 ${it.name}（剩 ${w.points} 积分）。`];
}
function trpgKnowsRecipe(id) {
  const it = craftItem(id);
  return !!it && (CRAFT_RULES.knownDiffs.includes(it.diff) || trpgWorkshop().recipes.includes(id));
}
/** 主持人教会 / 收回一张配方 */
function trpgTeachRecipe(id, on) {
  const it = craftItem(id);
  if (!it) return ["没有这个配方。"];
  const w = trpgWorkshop();
  w.recipes = w.recipes.filter(x => x !== id);
  if (on !== false) w.recipes.push(id);
  return [on !== false ? `学会了${it.name}的配方（${ROGUE_CHECKS.diffs[it.diff].name} · ${it.prof}）。` : `收回${it.name}的配方。`];
}
function trpgProfLevel(u, prof) {
  const p = heroProfile(u.kit), profs = (p && p.profs) || {};
  let level = Math.min(PROF_MAX, Number(profs[profName(prof)] || profs[prof]) || 0);
  if (!level && typeof featHas === "function" && featHas(u, "polymath")) level = 1;
  return level;
}
/** 成功率：diff 不给时按配方的难度（主持人可以改）；helper 有对应熟练项就给优势 */
function trpgCraftOdds(kit, itemId, diff, helper) {
  const it = craftItem(itemId), u = trpgHeroes().find(h => h.kit === kit);
  if (!it || !u) return null;
  diff = ROGUE_CHECKS.diffs[diff] ? diff : it.diff;
  const level = trpgProfLevel(u, it.prof);
  const hp = (u.layers || []).reduce((a, l) => a + (Number(l.current) || 0), 0), max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
  const perks = checkPerksFor(u.kit, it.prof, hp * 2 < max);
  const hu = helper && helper !== kit ? trpgHeroes().find(h => h.kit === helper) : null;
  const helped = !!(hu && trpgProfLevel(hu, it.prof) > 0);
  const adv = !!perks.adv || helped, dis = !!perks.dis && !adv;
  const base = ROGUE_CHECKS.chance[level][["easy", "normal", "hard", "extreme"].indexOf(diff)] || 0;
  let chance = adv ? 1 - (1 - base) * (1 - base) : dis ? base * base : base;
  if (perks.reroll) chance = 1 - (1 - chance) * (1 - chance);
  return { kit, item: it.id, name: u.name, prof: it.prof, diff, diffName: ROGUE_CHECKS.diffs[diff].name, level, base, chance: base ? chance : 0,
    adv, dis, reroll: !!perks.reroll, helped, hours: CRAFT_RULES.hours[diff] };
}
/** 制作一样：c = { kit, item, diff?, helper?, result: "roll"（程序掷）/ "ok" / "fail"（记下玩家掷的结果）}。材料要背包里有实物（金属也是） */
function trpgCraft(c) {
  c = c || {};
  const it = craftItem(c.item);
  if (!it) return ["没有这个配方。"];
  if (!trpgKnowsRecipe(it.id)) return [`还不会做${it.name}（在工坊页教会配方）。`];
  const o = trpgCraftOdds(c.kit, it.id, c.diff, c.helper);
  if (!o) return ["没有这名角色。"];
  const rc = CRAFT_RECIPES[it.id];
  const lack = Object.keys(rc).filter(id => bagCount(id) < rc[id]);
  if (lack.length) return ["材料不够：" + lack.map(id => `${ITEM_CATALOG[id].name} 差 ${rc[id] - bagCount(id)}`).join("，") + "。"];
  let ok, rollText = "";
  if (c.result === "ok" || c.result === "fail") ok = c.result === "ok";
  else {
    if (!o.base) return [`${o.name} 没有「${it.prof}」熟练，做不了${o.diffName}的东西。`];
    const r = typeof Hotseat !== "undefined" ? Hotseat.rollCheck({ base: o.base, adv: o.adv, dis: o.dis, reroll: o.reroll }) : { ok: Math.random() < o.chance, rolls: [] };
    ok = r.ok;
    rollText = r.rolls.length ? `d100 ${r.rolls.map(x => x.roll == null ? x.label : (x.label ? x.label + " " : "") + x.roll).join("，")} → ` : "";
  }
  const spend = ok ? rc : craftFailLoss(rc);
  Object.keys(spend).forEach(id => bagAdd(id, -spend[id]));
  const used = Object.keys(spend).map(id => `${ITEM_CATALOG[id].name}×${spend[id]}`).join("、") || "无";
  const helperName = o.helped ? `（${(trpgHeroes().find(h => h.kit === c.helper) || {}).name} 打下手）` : "";
  const out = [`${o.name}${helperName} 制作${it.name}（${o.diffName} · 成功率 ${Math.round(o.chance * 1000) / 10}%）：${rollText}${ok ? "成功" : "失败"}。` +
    (ok ? `用掉 ${used}。` : `损失 ${used}，壳体留着。`)];
  if (ok) bagAdd(it.id, 1);
  return out.concat(trpgPassHours(o.hours));
}
function trpgSalvage(itemId) {
  const y = salvageYield(itemId);
  if (!y) return ["这件东西拆不了。"];
  if (bagCount(itemId) < 1) return ["背包里没有这件东西。"];
  bagAdd(itemId, -1);
  Object.keys(y).forEach(id => bagAdd(id, y[id]));
  return [`拆掉 ${ITEM_CATALOG[itemId].name}：拿回 ${Object.keys(y).map(id => `${ITEM_CATALOG[id].name}×${y[id]}`).join("、")}。`];
}
/** 背包里的东西 ±n（丢弃、剧情里拿走 / 得到） */
function trpgAdjustItem(id, n) {
  const spec = ITEM_CATALOG[id];
  if (!spec) return ["没有这个物品。"];
  const have = bagCount(id);
  const d = Math.max(-have, Math.floor(Number(n) || 0));
  if (!d) return [];
  bagAdd(id, d);
  return [`${spec.name} ${d > 0 ? "+" : ""}${d}（现有 ${bagCount(id)}）。`];
}
function trpgAdjustKuizhi(n, why) {
  n = Math.floor(Number(n) || 0);
  if (!n) return [];
  state.kuizhi = Math.max(0, (Number(state.kuizhi) || 0) + n);
  return [`奎支 ${n > 0 ? "+" : ""}${n}${why ? "（" + why + "）" : ""}，现有 ${state.kuizhi}。`];
}
function trpgAdjustWater(ml) {
  ml = Math.floor(Number(ml) || 0);
  if (!ml) return [];
  setLedgerWater(Math.max(0, ledgerWater() + ml));
  return [`水 ${ml > 0 ? "+" : ""}${ml} ml，现有 ${ledgerWater()} ml。`];
}

/* ---------- 时间与休息（规则都在 ledger.js，照手册第五章） ----------
 * 满 80 小时力竭致死在 ledger.js · ledgerAdvance 里判（短休、消磨时间的长休推进时间也一样） */
function trpgPassHours(h) {
  const notes = [];
  h = Math.max(0, Math.floor(Number(h) || 0));
  if (!h) return notes;
  notes.push(`经过 ${h} 小时。`);
  ledgerAdvance(h, notes);
  ledgerCapture();
  return notes;
}
/** 按分钟推进（24 小时时钟） */
function trpgPassMinutes(m) {
  const notes = [];
  m = Math.max(0, Math.floor(Number(m) || 0));
  if (!m) return notes;
  notes.push(`经过 ${durationText(m / 60)}。`);
  ledgerAdvance(m / 60, notes);
  ledgerCapture();
  return notes;
}
/** 一直等到某个时刻（"21:00"）：已经过了就等到明天的这个时刻 */
function trpgPassUntil(text) {
  const target = parseClock(text);
  if (target == null) return [`看不懂时刻「${text}」，请写成 21:00 这样。`];
  let m = target - (LEDGER.clock == null ? CLOCK_START : LEDGER.clock);
  if (m <= 0) m += 1440;
  const notes = trpgPassMinutes(m);
  if (notes.length) notes[0] = `等到 ${clockText(target)}（经过 ${durationText(m / 60)}）。`;
  return notes;
}
function trpgShortRest(kits) {
  return ledgerShortRest(kits && kits.length ? kits : null, []);
}
/** plan：{ hours, food: { kit: foodId }, force } */
function trpgLongRest(plan) {
  TRPG.camp = null;
  const r = ledgerLongRest(plan || {}, []);
  if (typeof trpgTaskRestEscort === "function") trpgTaskRestEscort(r.notes);
  if (r.report) TRPG.lastRest = r.report;   // 长休结算画面：主持人本机弹，联机玩家收到 rest 包（online-view.js · projectRest）
  return r.notes;
}

/** 营地（issue #52）：长休前大家围着篝火坐下，看全队状态和补给；主持人点「开始长休」才真的休息 */
function trpgCampOpen(plan) {
  plan = plan || {};
  TRPG.camp = { plan: JSON.parse(JSON.stringify(plan)), force: !!plan.force, status: campStatus(plan) };
  return ["队伍在营地坐下，准备长休。"];
}
function trpgCampClose() {
  if (!TRPG.camp) return [];
  TRPG.camp = null;
  return ["先不休息，收起营地。"];
}

/* ---------- 道具 ---------- */
function trpgUseHeal(itemId, kit) { return ledgerHealItem(itemId, kit, []); }
function trpgRepair(kit) { const n = ledgerRepair(kit, []); ledgerCapture(); return n; }

/* ---------- 经验与属性点（手册第三章） ---------- */
function trpgGiveXp(kits, amount) {
  amount = Math.floor(Number(amount) || 0);
  const notes = [];
  if (!amount) return notes;
  trpgHeroes().filter(u => !u.dead && (!kits || !kits.length || kits.indexOf(u.kit) >= 0)).forEach(u => {
    const lv = u.level || 1;
    u.xp = (Number(u.xp) || 0) + amount;
    notes.push(`${u.name} 获得 ${amount} 经验。`);
    if (typeof tryLevelUp === "function" && tryLevelUp(u) && u.level > lv) {
      notes.push(`${u.name} 升到 ${u.level} 级${u.attrPoints ? `（有 ${u.attrPoints} 点属性点可分配）` : ""}。`);
    }
  });
  ledgerCapture();
  return notes;
}
function trpgSpendAttr(kit, attr) {
  const u = trpgHeroes().find(h => h.kit === kit);
  if (!u) return ["没有这个角色。"];
  if (!(Number(u.attrPoints) > 0)) return [`${u.name} 没有可分配的属性点。`];
  if (typeof ATTR_NAMES !== "undefined" && !ATTR_NAMES[attr]) return ["没有这项属性。"];
  u.attrs = Object.assign({}, u.attrs || {});
  // 手册：8 级的那一点不能加在曾经加过的同一项上
  u.attrPicks = u.attrPicks || [];
  if (u.attrPicks.length === 1 && u.attrPicks.indexOf(attr) >= 0) {   // 19 级那点（第三点）可以重复
    return ["8 级的属性点不能加在曾经加过的同一项上。"];
  }
  u.attrs[attr] = (Number(u.attrs[attr]) || 0) + 1;
  u.attrPicks.push(attr);
  u.attrPoints -= 1;
  if (typeof applyLevelStats === "function") applyLevelStats(u);
  ledgerCapture();
  const nm = typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES[attr] : attr;
  return [`${u.name} ${nm} +1（现在 ${u.attrs[attr]}）。`];
}

/* ---------- 专长（feats.js）：7 / 11 / 13 / 16 级各一项，主持人在队伍页分配 ----------
 * fullId：选「兼修」时一起选要升成完整版的涉猎专长。多面手 / 万事通的熟练项照旧由主持人记在角色卡上 */
function trpgPickFeat(kit, id, fullId) {
  const u = trpgHeroes().find(h => h.kit === kit);
  if (!u) return ["没有这个角色。"];
  if (!(Number(u.featPoints) > 0)) return [`${u.name} 没有可以分配的专长。`];
  if (typeof featChoicesFor !== "function" || featChoicesFor(u, u.level).indexOf(id) < 0) return ["这项专长现在不能选。"];
  const f = FEATS[id];
  if (id === "dualclass" && featFullOptions(u).indexOf(fullId) < 0) return ["兼修要选一张专长①–③的职责涉猎专长。"];
  u.feats = (u.feats || []).concat(id);
  if (id === "dualclass") u.featFull = (u.featFull || []).concat(fullId);
  u.featPoints -= 1;
  if (typeof applyLevelStats === "function") applyLevelStats(u);
  ledgerCapture();
  const out = [`${u.name} 获得专长：${featLabel(id)}。`];
  if (id === "dualclass") out.push(`兼修：「${FEATS[fullId].name}」改成原职责技能的完整版。`);
  if (id === "versatile") out.push("多面手：三项熟练项各升一级（主持人记在角色卡上）。");
  if (id === "polymath") out.push("万事通：选一项熟练项升到三级（主持人记在角色卡上）。");
  if (f.explore) out.push("探索专长：检定、商店、休息时由主持人照卡面结算。");
  return out;
}

/* ---------- 武器升级（手册：材料 + 4 级以上找工匠付费） ---------- */
function trpgWeaponLevel(owner, kit) {
  return Number((owner.weaponLevels || {})[kit]) || 1;
}
/** 解锁客制化看的等级 = 武器等级 + 羁绊（和改装槽、被动升级一样，growth.js · weaponRewardLevel） */
function trpgBpLevel(owner, kit) {
  return typeof weaponRewardLevel === "function" ? weaponRewardLevel(owner, kit) : trpgWeaponLevel(owner, kit);
}
/** 升下一级要什么：{ next, mats: [{ key, id, name, need, have }], labor, canSelf, max } */
function trpgUpgradeInfo(owner, kit) {
  const lv = trpgWeaponLevel(owner, kit);
  const next = lv + 1;
  const U = HANDBOOK_WEAPON_UPGRADE;
  const rc = U.recipe[next];
  if (!rc) return { lv, next, max: true, mats: [], labor: 0, canSelf: false };
  const mats = Object.keys(rc.mats).map(k => ({
    key: k, id: "mat_" + k, name: HANDBOOK_MATERIALS[k].name, need: rc.mats[k], have: bagCount("mat_" + k)
  }));
  return { lv, next, max: false, mats, labor: rc.labor || 0, canSelf: next <= U.selfMaxLevel, enough: mats.every(m => m.have >= m.need) };
}
/** mode：self 自己在工作站（≤4 级，只耗材料）/ smith 找工匠（材料 + 费用）/ gm 主持人直接升（不耗） */
function trpgUpgradeWeapon(ownerKit, kit, mode, fee) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  const info = trpgUpgradeInfo(owner, kit);
  const wname = typeof weaponName === "function" ? weaponName(kit) : kit;
  if (info.max) return [`${wname} 已经满级。`];
  const notes = [];
  if (mode !== "gm") {
    if (mode === "self" && !info.canSelf) return [`${wname} 升 ${info.next} 级要找武器工匠，自己在工作站只能升到 ${HANDBOOK_WEAPON_UPGRADE.selfMaxLevel} 级。`];
    if (!info.enough) return [`材料不够：${info.mats.map(m => `${m.name} ${m.have}/${m.need}`).join("、")}。`];
    const pay = mode === "smith" ? Math.max(0, Math.floor(Number(fee != null ? fee : info.labor) || 0)) : 0;
    if (pay > (Number(state.kuizhi) || 0)) return [`奎支不够付加工费：要 ${pay}，手里只有 ${Number(state.kuizhi) || 0}。`];
    info.mats.forEach(m => bagAdd(m.id, -m.need));
    if (pay) state.kuizhi -= pay;
    notes.push(`${mode === "smith" ? "工匠" : "在工作站"}把 ${wname} 升到 ${info.next} 级：消耗 ${info.mats.map(m => `${m.name}×${m.need}`).join("、")}${pay ? `，加工费 ${pay} 奎支` : ""}。`);
  } else {
    notes.push(`主持人把 ${wname} 升到 ${info.next} 级（不耗材料和奎支）。`);
  }
  const before = typeof LevelUp !== "undefined" ? LevelUp.snapshot(owner) : null;
  if (typeof setOwnedWeaponLevel === "function") setOwnedWeaponLevel(owner, kit, info.next);
  else { owner.weaponLevels = owner.weaponLevels || {}; owner.weaponLevels[kit] = info.next; }
  if (before) LevelUp.note("weapon", owner, before, { weapon: wname });
  trpgSyncWeaponMods();   // 升到 4 级：装着的客制化图纸开始生效
  ledgerCapture();
  return notes;
}

/* ---------- 武器改装槽（growth.js：3 级 +1 槽，7 级 +1 槽） ----------
 * free：主持人直接装，不从背包拿 */
function trpgInstallPart(ownerKit, kit, slot, part, free) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  const notes = installWeaponPart(owner, kit, slot, part, free);
  ledgerCapture();
  return notes;
}
/** 主持人随机生成一个改装件放进背包（grade：C / B） */
function trpgRandomPart(grade) {
  const id = rollWeaponPart({ [grade === "B" ? "B" : "C"]: 1 });
  bagAdd(weaponPartItemId(id), 1);
  ledgerCapture();
  return [`背包里多了一个改装件：${weaponPartLabel(id)}（${weaponPartText(id)}）。`];
}
function trpgRemovePart(ownerKit, kit, slot) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  const notes = removeWeaponPart(owner, kit, slot);
  ledgerCapture();
  return notes;
}

/* ---------- 客制化图纸（rogue-data.js · ROGUE_SMITHS 的图纸，背包物品 id 就是图纸 id） ----------
 * 装在哪把武器上记在角色身上：hero.weaponBlueprints[武器kit] = 图纸 id，一把武器一张。
 * 战斗规则读 state.weaponMods（mods.js）：每次摆队伍、装 / 拆、升降武器等级之后按队伍重算一遍。
 * 武器 4 级才解锁客制化（mods.js · BLUEPRINT_MIN_LEVEL）：不到 4 级的（旧存档、后台降级）图纸留在武器上，但不生效。 */
function trpgSyncWeaponMods() {
  const mods = {}, ids = {};
  trpgHeroes().forEach(h => Object.keys(h.weaponBlueprints || {}).forEach(k => {
    const b = typeof blueprintSpec === "function" ? blueprintSpec(h.weaponBlueprints[k]) : null;
    if (b && b.mod && trpgBpLevel(h, k) >= BLUEPRINT_MIN_LEVEL) { mods[k] = JSON.parse(JSON.stringify(b.mod)); ids[k] = b.id; }
  }));
  state.weaponMods = Object.keys(mods).length ? mods : null;
  state.weaponBlueprints = Object.keys(ids).length ? ids : null;
  if (typeof syncBpAll === "function") syncBpAll();
  // 耐久上限变小（大杀器、耐久 −N）：当前耐久跟着压下来
  if (typeof LEDGER !== "undefined" && LEDGER.dur && typeof weaponDurMax === "function") {
    Object.keys(LEDGER.dur).forEach(k => { const m = weaponDurMax(k); if (Number(LEDGER.dur[k]) > m) LEDGER.dur[k] = m; });
  }
}
/** 装图纸。fee：付给工匠的奎支（主持人按剧情定）；free：主持人直接装（不从背包拿，不收钱） */
function trpgInstallBlueprint(ownerKit, kit, bpId, fee, free) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  if (!(owner.linkedKits || []).includes(kit)) return ["这把武器不属于这个角色。"];
  const b = typeof blueprintSpec === "function" ? blueprintSpec(bpId) : null;
  if (!b) return ["没有这张图纸。"];
  const wname = typeof weaponName === "function" ? weaponName(kit) : kit;
  // 武器 4 级才解锁客制化（主持人手册「本版规则修订」）：主持人直接装也一样，先把武器升上去
  const lv = trpgBpLevel(owner, kit);
  if (lv < BLUEPRINT_MIN_LEVEL) return [`${wname} 的「武器等级 + 羁绊」要到 ${BLUEPRINT_MIN_LEVEL} 级才能装客制化图纸（现在 ${lv} 级）。`];
  const pay = free ? 0 : Math.max(0, Math.floor(Number(fee) || 0));
  if (!free && bagCount(bpId) < 1) return [`背包里没有图纸「${b.name}」。`];
  if (pay > (Number(state.kuizhi) || 0)) return [`奎支不够付工钱：要 ${pay}，手里只有 ${Number(state.kuizhi) || 0}。`];
  const notes = [];
  if (!free) { bagAdd(bpId, -1); if (pay) state.kuizhi -= pay; }
  owner.weaponBlueprints = owner.weaponBlueprints || {};
  const old = owner.weaponBlueprints[kit];
  if (old) { bagAdd(old, 1); notes.push(`拆下原来的图纸「${(blueprintSpec(old) || {}).name || old}」放回背包。`); }
  owner.weaponBlueprints[kit] = bpId;
  trpgSyncWeaponMods();
  notes.push(`${free ? "主持人" : "工匠"}把客制化图纸「${b.name}」装到 ${wname} 上（${b.text}）${pay ? `，工钱 ${pay} 奎支` : ""}。`);
  ledgerCapture();
  return notes;
}
function trpgRemoveBlueprint(ownerKit, kit) {
  const owner = trpgHeroes().find(h => h.kit === ownerKit);
  if (!owner) return ["没有这个角色。"];
  const id = (owner.weaponBlueprints || {})[kit];
  if (!id) return ["这把武器没有装图纸。"];
  delete owner.weaponBlueprints[kit];
  bagAdd(id, 1);
  trpgSyncWeaponMods();
  ledgerCapture();
  return [`拆下 ${typeof weaponName === "function" ? weaponName(kit) : kit} 上的图纸「${(blueprintSpec(id) || {}).name || id}」，放回背包。`];
}

/* ---------- 后台：主持人按叙事直接改数值（不走规则） ----------
 * edit = {
 *   day, hours, kuizhi, water,
 *   heroes: { kit: { status: "ok"|"up"|"dying"|"dead", layers: [当前值…], shp, level, xp, attrPoints,
 *                    attrs: { str… }, shortUsed, weapons: { 武器kit: { level, dur, heal } } } }
 * }
 * 没写的项不动。返回改了什么（写进探索记录）。 */
const TRPG_STATUS = { ok: "正常", up: "起身中", dying: "濒死", dead: "死亡" };
function trpgHeroStatus(u) {
  return u.dead ? "dead" : u.dying ? "dying" : u.upOnShp ? "up" : "ok";
}
function trpgBackstageApply(edit, why) {
  edit = edit || {};
  const notes = [];
  const num = (v, lo, hi) => {
    let n = Math.floor(Number(v));
    if (!isFinite(n)) return null;
    if (lo != null) n = Math.max(lo, n);
    if (hi != null) n = Math.min(hi, n);
    return n;
  };
  const change = (label, a, b) => { if (a !== b) notes.push(`${label} ${a} → ${b}`); };

  if (edit.day != null) { const v = num(edit.day, 1); if (v != null) { change("天数", LEDGER.day, v); LEDGER.day = v; } }
  if (edit.clock != null && String(edit.clock).trim() !== "") {
    const v = parseClock(edit.clock);
    if (v == null) notes.push(`时刻「${edit.clock}」看不懂，没有改（写成 21:00 这样）。`);
    else { change("时刻", clockText(LEDGER.clock), clockText(v)); LEDGER.clock = v; }
  }
  if (edit.hours != null && Math.abs(Number(edit.hours) - (Number(LEDGER.hours) || 0)) >= 0.01) { const v = num(edit.hours, 0); if (v != null) { change("距上次长休（小时）", LEDGER.hours, v); LEDGER.hours = v; } }
  if (edit.kuizhi != null) { const v = num(edit.kuizhi, 0); if (v != null) { change("奎支", Number(state.kuizhi) || 0, v); state.kuizhi = v; } }
  if (edit.water != null) { const v = num(edit.water, 0); if (v != null) { change("水（ml）", ledgerWater(), v); setLedgerWater(v); } }

  Object.keys(edit.heroes || {}).forEach(kit => {
    const u = trpgHeroes().find(h => h.kit === kit);
    const e = edit.heroes[kit];
    if (!u || !e) return;
    const n = (label, a, b) => change(`${u.name} ${label}`, a, b);
    // 等级、属性先改：会重算血量与坚毅上限。角色满级 20（以前夹到 25）；单项属性硬性上限 10
    let restat = false;
    if (e.level != null) { const v = num(e.level, 1, 20); if (v != null && v !== (u.level || 1)) { n("等级", u.level || 1, v); u.level = v; restat = true; } }
    if (e.attrs) {
      u.attrs = Object.assign({}, u.attrs || {});
      Object.keys(e.attrs).forEach(k => {
        const v = num(e.attrs[k], 1);
        const was = Number(u.attrs[k]) || 0;
        if (v != null && v !== was) { n(typeof ATTR_NAMES !== "undefined" ? ATTR_NAMES[k] || k : k, was, v); u.attrs[k] = v; restat = true; }
      });
    }
    if (restat && typeof applyLevelStats === "function") applyLevelStats(u);
    if (e.xp != null) { const v = num(e.xp, 0); if (v != null) { n("经验", Number(u.xp) || 0, v); u.xp = v; } }
    if (e.attrPoints != null) { const v = num(e.attrPoints, 0); if (v != null) { n("未分配属性点", Number(u.attrPoints) || 0, v); u.attrPoints = v; } }
    if (Array.isArray(e.layers)) {
      (u.layers || []).forEach((l, i) => {
        if (e.layers[i] == null) return;
        const v = num(e.layers[i], 0, Number(l.max) || 0);
        const was = Number(l.current) || 0;
        if (v != null && v !== was) { n(`${(typeof LAYER !== "undefined" && LAYER[l.type]) || l.type}血量`, was, v); l.current = v; }
      });
    }
    if (e.shp != null) { const v = num(e.shp, 0, Number(u.shpMax) || 0); if (v != null) { n("坚毅", Number(u.shp) || 0, v); u.shp = v; } }
    if (e.status && TRPG_STATUS[e.status]) {
      const was = trpgHeroStatus(u);
      if (was !== e.status) {
        n("状态", TRPG_STATUS[was], TRPG_STATUS[e.status]);
        u.dead = e.status === "dead";
        u.dying = e.status === "dying";
        u.upOnShp = e.status === "up";
        if (!u.dead && !u.dying && totalHpOf(u) <= 0) {
          const l = (u.layers || [])[u.layers.length - 1];
          if (l) { l.current = 1; notes.push(`${u.name} 血量 0 → 1（活着至少要有 1 点血）`); }
        }
      }
    }
    if (e.shortUsed != null) {
      const v = num(e.shortUsed, 0);
      const was = Number(LEDGER.shortUsed[kit]) || 0;
      if (v != null && v !== was) { n("今天已短休", was, v); LEDGER.shortUsed[kit] = v; }
    }
    Object.keys(e.weapons || {}).forEach(wk => {
      if ((u.linkedKits || []).indexOf(wk) < 0) return;
      const w = e.weapons[wk];
      const wn = typeof weaponName === "function" ? weaponName(wk) : wk;
      if (w.level != null) {
        const v = num(w.level, 1, HANDBOOK_WEAPON_UPGRADE.maxLevel);
        const was = trpgWeaponLevel(u, wk);
        if (v != null && v !== was) {
          change(`${wn} 等级`, was, v);
          if (typeof setOwnedWeaponLevel === "function") setOwnedWeaponLevel(u, wk, v);
          else { u.weaponLevels = u.weaponLevels || {}; u.weaponLevels[wk] = v; }
          trpgSyncWeaponMods();   // 降到 4 级以下：装着的客制化图纸不再生效；升回去又生效
        }
      }
      if (w.bond != null) {
        const v = num(w.bond, 0, typeof BOND_MAX !== "undefined" ? BOND_MAX : 5);
        const was = typeof weaponBond === "function" ? weaponBond(u, wk) : 0;
        if (v != null && v !== was) {
          change(`${wn} 羁绊`, was, v);
          const ej = [];
          if (typeof setWeaponBond === "function") setWeaponBond(u, wk, v, ej);
          ej.forEach(t => notes.push(t));
        }
      }
      if (w.dur != null) {
        const v = num(w.dur, 0, weaponDurMax(wk));
        const was = weaponDur(wk);
        if (v != null && v !== was) {
          change(`${wn} 耐久`, was, v);
          LEDGER.dur[wk] = v;
          if (v > 0 && u.weaponHeld === false && !u.dead) u.weaponHeld = true;
        }
      }
      if (w.heal && LEDGER.weapons && LEDGER.weapons[wk]) {
        delete LEDGER.weapons[wk];
        notes.push(`${wn}（武器人）伤势治好`);
      }
    });
  });
  if (!notes.length) return ["后台：没有改动。"];
  ledgerCapture();
  return [`后台调整${why ? "（" + why + "）" : ""}：`].concat(notes.map(x => "· " + x + "。"));
}

/* ---------- 放弃这场战斗（没结算就回到探索环节） ----------
 * 队伍档案回到开战前存下的那一份（campaign.ledger）：耐久、「长休一次」技能的使用记录、武器人伤势……
 * 都回到开战前；奎支、物品、等级由重新摆队伍时按队伍记忆回滚（game.js · applyCampaignToField）。
 * 以前只回奎支和物品，提示却说回到开战前。返回是否回滚了 */
function trpgAbandonBattle(campaign) {
  if (!campaign || !campaign.ledger) return false;
  LEDGER.load(JSON.parse(JSON.stringify(campaign.ledger)));
  return true;
}

/* ---------- 存档：每个团一个空位 ----------
 * 空位里放：{ name, at, campaign（队伍记忆）, log（探索记录）, level（敌人等级）, enc（上次的遭遇） }
 * 玩的时候每个操作、每场战斗结算都自动写回当前空位。 */
const TRPG_SLOT_COUNT = 3;
const TRPG_SLOTS_KEY = "anterscale-trpg-slots";
let trpgSlotsTrouble = null;   // 上次读空位时发现的问题：{ backedUp }（空位文件坏了）；没问题是 null
function trpgReadSlots() {
  let raw = null;
  try { raw = localStorage.getItem(TRPG_SLOTS_KEY); } catch (e) { raw = null; }
  let arr = [];
  trpgSlotsTrouble = null;
  if (raw != null) {
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    const ok = Array.isArray(arr) && arr.every(s => s == null || trpgValidSlot(s));
    if (!ok) {
      // 空位文件坏了（写到一半断电之类）：先原样另存一份 .broken，读得出来的团照旧留着。
      // 以前直接当成三个空位，再往随便哪个空位写一个团，另外两个就永久没了
      let backedUp = false;
      try {
        if (localStorage.getItem(TRPG_SLOTS_KEY + ".broken") !== raw) localStorage.setItem(TRPG_SLOTS_KEY + ".broken", raw);
        backedUp = true;
      } catch (e) {}
      trpgSlotsTrouble = { backedUp };
      arr = Array.isArray(arr) ? arr.map(s => (s != null && trpgValidSlot(s) ? s : null)) : [];
    }
  } else {
    // 旧版只有一份队伍记忆（anterscale-campaign）：只在空位文件从来没写过的时候搬进空位 1，搬一次就算数。
    // 以前只要三个空位都空着就再搬一次，而战斗画面一直在重写这个旧键：删掉的团会带着最近进过的团的内容回来
    try {
      const old = localStorage.getItem("anterscale-campaign");
      if (old) {
        let log = [];
        try { log = JSON.parse(localStorage.getItem("anterscale-trpg-log") || "[]"); } catch (e) {}
        arr[0] = { name: "团 1", at: Date.now(), campaign: JSON.parse(old), log, level: 1, enc: null };
      }
      while (arr.length < TRPG_SLOT_COUNT) arr.push(null);
      localStorage.setItem(TRPG_SLOTS_KEY, JSON.stringify(arr));
    } catch (e) {}
  }
  while (arr.length < TRPG_SLOT_COUNT) arr.push(null);
  return arr.slice(0, TRPG_SLOT_COUNT);
}
/** 空位文件有没有问题（界面上提醒）：null 没问题，否则是一句说明 */
function trpgSlotsProblem() {
  trpgReadSlots();
  if (!trpgSlotsTrouble) return null;
  return trpgSlotsTrouble.backedUp
    ? `存档空位的文件坏了：原来的内容已另存为 ${TRPG_SLOTS_KEY}.broken，读得出来的团照旧留着。`
    : "存档空位的文件坏了，而且没能另存备份：先不要往空位里写，以免把读不出来的团覆盖掉。";
}
function trpgWriteSlot(i, data) {
  const arr = trpgReadSlots();
  // 空位文件坏了又没能备份：不写，免得把读不出来的团当成空位覆盖掉
  if (trpgSlotsTrouble && !trpgSlotsTrouble.backedUp) return false;
  arr[i] = data ? JSON.parse(JSON.stringify(Object.assign({}, data, { at: Date.now() }))) : null;
  try { localStorage.setItem(TRPG_SLOTS_KEY, JSON.stringify(arr)); return true; } catch (e) { return false; }
}
function trpgClearSlot(i) { return trpgWriteSlot(i, null); }
/** 读进来的存档文件是否像样 */
function trpgValidSlot(s) {
  return !!(s && typeof s === "object" && (s.campaign == null || typeof s.campaign === "object") && (s.log == null || Array.isArray(s.log)));
}
/** 空位卡片上显示的摘要 */
function trpgSlotSummary(s) {
  if (!s) return null;
  const c = s.campaign || {};
  const kits = (c.partyKits && c.partyKits.length) ? c.partyKits : (c.party || []).map(p => p.kit);
  const cards = typeof livePartyCards === "function" ? livePartyCards() : [];
  const party = kits.map(k => {
    const p = (c.party || []).find(x => x.kit === k) || {};
    const card = cards.find(x => x.kit === k);
    return `${card ? card.name : k} Lv${p.level || 1}`;
  });
  return { name: s.name || "未命名", party, day: (c.ledger && c.ledger.day) || 1, kuizhi: Number(c.kuizhi) || 0, at: s.at || 0 };
}
