/* 角鳞 · 队伍档案（ledger.js）
 *
 * 跑团用的战斗之外的持久状态。存进队伍档案（和等级、经验、背包一起），
 * 跟随存档位与本地保存。
 *
 *   · 角色当前血量、坚毅生命、濒死/死亡，跨战斗保留（不再每场回满）
 *   · 每把武器的耐久，按手册第六章结算
 *   · 背包里的水（毫升）、食物（按种类）、维修工具包、睡袋
 *   · 天数、距上次长休的小时数、短休剩余次数
 *   · 短休 / 长休
 *
 * 耐久（手册第六章）：
 *   一次战斗结束 −1 ／ 武器人在战斗中被击败 −2 ／ 发动格挡 −1（空手格挡不扣）
 *   长休恢复全部 ／ 耐久为 0 时无法使用
 */

/* ===== 补给物品：放进同一个背包，但不能在战斗中使用 ===== */
const SUPPLY_ITEMS = {
  food_liquid:  { name: "流食",     hint: "最低级管装食物 · 长休算 1 份食物", food: true, shp: 0 },
  food_can:     { name: "罐头食品", hint: "长休算 1 份食物 · 额外恢复 1 坚毅", food: true, shp: 1 },
  food_organic: { name: "有机食品", hint: "长休算 1 份食物 · 额外恢复 2 坚毅", food: true, shp: 2 },
  food_gourmet: { name: "美食",     hint: "长休算 1 份食物 · 额外恢复 5 坚毅", food: true, shp: 5 },
  repair_kit:   { name: "维修工具包", hint: "修复 10 点武器耐久", repair: 10 },
  sleepbag:     { name: "睡袋",     hint: "长休时每小时坚毅恢复 +1（不消耗，一人一个）", sleep: 1 }
};
const FOOD_ORDER = ["food_liquid", "food_can", "food_organic", "food_gourmet"];

(function registerSupplies() {
  if (typeof ITEM_CATALOG === "undefined") return;
  Object.keys(SUPPLY_ITEMS).forEach(id => {
    if (!ITEM_CATALOG[id]) ITEM_CATALOG[id] = Object.assign({ combat: false, supply: true }, SUPPLY_ITEMS[id]);
  });
})();

/* ===== 种族长休消耗（手册第一章） ===== */
const LONG_REST_COST = {
  human:  { water: 1000, food: 2 },
  red:    { water: 750,  food: 2 },
  canine: { water: 1000, food: 2 },
  feline: { water: 750,  food: 2 },
  rodent: { water: 500,  food: 1 },
  bovine: { water: 1250, food: 2 },
  beast:  { water: 1250, food: 3 }
};
function heroRace(u) {
  const n = String((u && u.note) || "");
  if (/鼠类人|兔/.test(n)) return "rodent";
  if (/猫类人|豹|虎/.test(n)) return "feline";
  if (/犬类人|狐|狼/.test(n)) return "canine";
  if (/牛类人|马|羊/.test(n)) return "bovine";
  if (/兽人/.test(n)) return "beast";
  if (/红皮人/.test(n)) return "red";
  return "human";
}
function heroRestCost(u) { return LONG_REST_COST[heroRace(u)] || LONG_REST_COST.human; }

/** 短休治疗加成（角色特长）：川川「活力源泉」+25% */
const SHORT_REST_BONUS = { chuan: 0.25 };
/** 每天可短休次数：熊兽人 1 次，其余 2 次 */
function shortRestCap(u) { return /熊/.test(String((u && u.note) || "")) ? 1 : 2; }

/** 新档的起始时刻：早上 8 点 */
const CLOCK_START = 8 * 60;

/* ===== 档案本体 ===== */
const LEDGER = {
  day: 1,
  hours: 0,            // 距上次长休的小时数（可以带零头：按分钟推进时间）
  clock: 480,          // 当天时刻：从 0 点起的分钟数（0–1439），新档从早上 8 点开始
  dur: {},             // 武器 kit → 当前耐久
  heroes: {},          // 角色 kit → { layers:[当前值], shp, dying, dead, upOnShp }
  weapons: {},         // 武器人 kit → [{ type, current }]：武器人的伤势跨战斗保留，长休回满
  shortUsed: {},       // 角色 kit → 今天已用短休次数
  restOnce: {},        // 角色 kit → { 技能 key: 次数 }：「长休一次」的技能，长休才刷新

  /** 存进队伍档案 */
  save() {
    return JSON.parse(JSON.stringify({
      day: this.day, hours: this.hours, clock: this.clock, dur: this.dur,
      heroes: this.heroes, weapons: this.weapons, shortUsed: this.shortUsed,
      restOnce: this.restOnce, water: ledgerWater()
    }));
  },
  load(s) {
    s = s || {};
    this.day = Number(s.day) || 1;
    this.hours = Number(s.hours) || 0;
    this.clock = s.clock != null && isFinite(Number(s.clock)) ? ((Math.floor(Number(s.clock)) % 1440) + 1440) % 1440 : CLOCK_START;
    this.dur = s.dur || {};
    this.heroes = s.heroes || {};
    this.weapons = s.weapons || {};
    this.shortUsed = s.shortUsed || {};
    this.restOnce = s.restOnce || {};
    if (s.water != null) setLedgerWater(s.water);
  },
  reset() { this.load({}); }
};

/* ===== 「长休一次」的技能 ===== */
const REST_ONCE_KEYS = ["rally"];
/** 用一次「长休一次」的技能。用完了返回 false */
function useRestOnce(kit, key, limit) {
  LEDGER.restOnce = LEDGER.restOnce || {};
  const row = LEDGER.restOnce[kit] = LEDGER.restOnce[kit] || {};
  const n = Number(row[key]) || 0;
  if (n >= (limit || 1)) return false;
  row[key] = n + 1;
  return true;
}

/* ===== 水 ===== */
function ledgerWater() {
  if (typeof ensureBag === "function") ensureBag();
  return Math.max(0, Number(state.bag && state.bag.water) || 0);
}
function setLedgerWater(ml) {
  if (typeof ensureBag === "function") ensureBag();
  state.bag.water = Math.max(0, Math.round(Number(ml) || 0));
}

/* ===== 武器与耐久 ===== */
function partyHeroes() {
  return (state.units || []).filter(u => u.isPlayer && !isWeaponUnit(u) && !u._removed);
}
function heroByKit(kit) { return partyHeroes().find(u => u.kit === kit) || null; }
function weaponOwner(kit) {
  return partyHeroes().find(h => (h.linkedKits || []).indexOf(kit) >= 0) || null;
}
function weaponName(kit) {
  const c = typeof livePartyCards === "function" ? livePartyCards().find(x => x.kit === kit) : null;
  return c ? c.name : kit;
}
/** 耐久上限：基础耐久 + 武器等级 / 2（与 growth.js 一致） */
function weaponDurMax(kit) {
  const base = weaponDurBase(kit);
  return typeof bpDurMax === "function" ? bpDurMax(base, weaponMod(kit)) : base;
}
/** 没装图纸时的耐久上限 */
function weaponDurBase(kit) {
  const owner = weaponOwner(kit);
  const lv = owner && owner.weaponLevels && owner.weaponLevels[kit] ? Number(owner.weaponLevels[kit]) : 1;
  const g = (typeof WEAPON_GROWTH !== "undefined" && WEAPON_GROWTH[kit]) || {};
  return (g.baseDur || 5) + Math.floor(lv / 2);
}
/** 武器上装的客制化图纸加成（单局在开战前写进 state.weaponMods；战斗原型没有） */
function weaponMod(kit) {
  return (kit && state.weaponMods && state.weaponMods[kit]) || {};
}
/** 这个单位此刻吃到的图纸加成：角色看手里那把，武器人看自己 */
function unitWeaponMod(u) {
  if (!u || !state.weaponMods) return {};
  if (state.weaponMods[u.kit]) return state.weaponMods[u.kit];
  return weaponMod(heldWeaponKit(u));
}
function weaponDur(kit) {
  if (LEDGER.dur[kit] == null) LEDGER.dur[kit] = weaponDurMax(kit);
  return Math.max(0, Number(LEDGER.dur[kit]) || 0);
}
function weaponBroken(kit) { return weaponDur(kit) <= 0; }

/** 角色此刻拿在手里的那把武器（分出去的不算） */
function heldWeaponKit(hero) {
  if (!hero || hero.weaponHeld === false) return null;
  if (hero.kit === "hiaki") {
    const b = hero.resources && hero.resources.blade;
    const r = hero.resources || {};
    if (b === "niu" && !r.niuOut) return "niu";
    if (b === "naruto" && !r.narutoOut) return "naruto";
    return null;
  }
  const kits = hero.linkedKits || [];
  return kits.find(k => !(state.units || []).some(u => u.kit === k && !u.hidden && !u.fused)) || null;
}

/** 扣耐久。归零时手里的武器就不能再用了。 */
function spendDurability(kit, n, reason, notes) {
  if (!kit || !n) return;
  const before = weaponDur(kit);
  const after = Math.max(0, before - n);
  LEDGER.dur[kit] = after;
  const unit = (state.units || []).find(u => u.kit === kit && !u._removed);
  if (unit && unit.resources) unit.resources.durability = after;
  if (notes && after !== before) notes.push(`${weaponName(kit)} 耐久 ${before} → ${after}（${reason}）`);
  if (after <= 0 && before > 0) {
    if (notes) notes.push(`⚠ ${weaponName(kit)} 耐久归零，无法使用（修好之前都只能空手：维修工具包或长休）。`);
    const owner = weaponOwner(kit);
    if (owner && typeof spawnPopup === "function") spawnPopup(owner, { kind: "status", text: "武器损坏", element: "physical" });
    if (owner && heldWeaponKit(owner) === kit) disarmBrokenWeapon(owner, notes);
  }
}
function restoreDurability(kit, n) {
  const max = weaponDurMax(kit);
  LEDGER.dur[kit] = n == null ? max : Math.min(max, weaponDur(kit) + n);
  const unit = (state.units || []).find(u => u.kit === kit && !u._removed);
  if (unit && unit.resources) unit.resources.durability = LEDGER.dur[kit];
}

/** 手里的武器坏了：绯秋换另一把刀，其余角色变空手 */
function disarmBrokenWeapon(hero, notes) {
  if (!hero) return;
  if (hero.kit === "hiaki") {
    const r = hero.resources || {};
    const other = r.blade === "niu" ? "naruto" : "niu";
    const otherOut = other === "niu" ? r.niuOut : r.narutoOut;
    if (!weaponBroken(other) && !otherOut) {
      r.blade = other;
      if (notes) notes.push(`绯秋 改持${weaponName(other)}。`);
      return;
    }
  }
  hero.weaponHeld = false;
  hero.atk = Number(hero.personalAtk) || 0;
  if (notes) notes.push(`${hero.name} 的武器无法使用，只能空手作战。`);
}

/** 协助格挡时扣耐久（空手格挡不扣）。由 app.js 的 performAssistBlock 调用。 */
function ledgerOnBlock(helper, notes) {
  if (!helper || !helper.isPlayer) return;
  const kit = isWeaponUnit(helper) ? helper.kit : heldWeaponKit(helper);
  if (!kit) return;
  spendDurability(kit, 1, "发动格挡", notes);
}

/* ===== 开战与结算 ===== */

/** 开战：把档案里的状态盖到场上的角色身上（不再每场回满） */
function ledgerApplyToField(notes) {
  partyHeroes().forEach(h => {
    const rec = LEDGER.heroes[h.kit];
    if (rec) {
      (h.layers || []).forEach((l, i) => {
        const v = (rec.layers || [])[i];
        if (v != null) l.current = Math.max(0, Math.min(Number(l.max) || 0, Number(v) || 0));
      });
      if (rec.shp != null) h.shp = Math.max(0, Math.min(Number(h.shpMax) || 0, Number(rec.shp) || 0));
      h.dead = !!rec.dead;
      h.dying = !!rec.dying && !rec.dead;
      h.upOnShp = !!rec.upOnShp && !rec.dead;
    }
    // 耐久为 0 的武器不能用
    (h.linkedKits || []).forEach(k => weaponDur(k));
    const held = heldWeaponKit(h);
    if (held && weaponBroken(held)) disarmBrokenWeapon(h, notes);
  });
}

/** 武器人上次留下的伤势（spawnWeapon 唤出时用）。没有记录返回 null（满血） */
function weaponCarryLayers(kit) {
  return (LEDGER.weapons && LEDGER.weapons[kit]) || null;
}

/** 记下场上角色的状态 */
function ledgerCapture() {
  // 武器人：唤出过的（包括收回后隐藏的）记下伤势；这场没唤出过的保留上次的记录
  (state.units || []).filter(u => u.isPlayer && isWeaponUnit(u) && !u._removed && !u.fused).forEach(u => {
    LEDGER.weapons = LEDGER.weapons || {};
    LEDGER.weapons[u.kit] = persistentLayers(u);
  });
  partyHeroes().forEach(h => {
    LEDGER.heroes[h.kit] = {
      layers: persistentLayers(h).map(l => l.current),
      shp: Math.max(0, Number(h.shp) || 0),
      dying: !!h.dying,
      dead: !!h.dead,
      upOnShp: !!h.upOnShp
    };
  });
}

/** 战斗结束：每把武器 −1，被击败的武器人再 −2，然后记下状态 */
function ledgerAfterBattle(notes) {
  notes = notes || [];
  const heroes = partyHeroes();
  heroes.forEach(h => (h.linkedKits || []).forEach(k => spendDurability(k, 1, "战斗结束", notes)));
  (state.units || []).filter(u => u.isPlayer && isWeaponUnit(u) && u.dead && !u._durCounted).forEach(u => {
    u._durCounted = true;
    spendDurability(u.kit, 2, "武器人被击败", notes);
  });
  if (typeof recoverDownedAfterBattle === "function") recoverDownedAfterBattle(notes);
  ledgerCapture();
  return notes;
}

/* ===== 时间 =====
 * 24 小时时钟：LEDGER.clock 是当天从 0 点起的分钟数。推进时间时时钟跟着走，过了 0 点就进入下一天（短休次数刷新）。
 * LEDGER.hours 是距上次长休的小时数（力竭按它算），按分钟推进时可以带零头。 */
/** 分钟数 → "08:05" */
function clockText(min) {
  min = ((Math.floor(Number(min) || 0) % 1440) + 1440) % 1440;
  return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
}
/** "8:05" / "08:05" → 分钟数；看不懂返回 null */
function parseClock(text) {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/.exec(String(text == null ? "" : text));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
/** 时段：深夜 / 清晨 / 上午 / 中午 / 下午 / 傍晚 / 夜晚 */
function dayPeriod(min) {
  const h = Math.floor((((Number(min) || 0) % 1440) + 1440) % 1440 / 60);
  return h < 5 ? "深夜" : h < 8 ? "清晨" : h < 12 ? "上午" : h < 14 ? "中午" : h < 18 ? "下午" : h < 20 ? "傍晚" : "夜晚";
}
/** 「3 小时 20 分」 */
function durationText(hours) {
  const total = Math.round((Number(hours) || 0) * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return m ? (h ? `${h} 小时 ${m} 分` : `${m} 分钟`) : `${h} 小时`;
}
/** 「第 2 天 14:30（下午）」 */
function ledgerTimeText() {
  const c = LEDGER.clock == null ? CLOCK_START : LEDGER.clock;
  return `第 ${LEDGER.day || 1} 天 ${clockText(c)}（${dayPeriod(c)}）`;
}
/** 时钟往前走 minutes 分钟；返回跨过了几个 0 点 */
function advanceClock(minutes) {
  const c = (LEDGER.clock == null ? CLOCK_START : LEDGER.clock) + Math.max(0, Math.round(Number(minutes) || 0));
  LEDGER.clock = c % 1440;
  return Math.floor(c / 1440);
}
function ledgerAdvance(hours, notes) {
  hours = Math.max(0, Number(hours) || 0);
  const minutes = Math.round(hours * 60);
  if (!minutes) return;
  LEDGER.hours = Math.round(((Number(LEDGER.hours) || 0) + minutes / 60) * 600) / 600;
  // 过了 0 点算新的一天，短休次数刷新
  const days = advanceClock(minutes);
  if (days > 0) {
    LEDGER.day += days;
    LEDGER.shortUsed = {};
    if (notes) notes.push(`进入第 ${LEDGER.day} 天，短休次数刷新。`);
  }
  const t = exhaustTier();
  if (t && notes) notes.push(`距上次长休 ${durationText(LEDGER.hours)}：${exhaustText(t)}`);
}
function exhaustTier() {
  const h = LEDGER.hours;
  return h >= 80 ? 4 : h >= 60 ? 3 : h >= 40 ? 2 : h >= 20 ? 1 : 0;
}
function exhaustText(t) {
  return ["精神正常", "力竭（无法用坚毅生命起身）", "力竭 2（atk −3，def −1）",
          "力竭 3（被击倒立刻死亡）", "力竭致死"][t] || "";
}

/* ===== 短休 ===== */
function shortRestLeft(h) { return Math.max(0, shortRestCap(h) - (Number(LEDGER.shortUsed[h.kit]) || 0)); }

function ledgerShortRest(kits, notes) {
  notes = notes || [];
  const list = partyHeroes().filter(h => !h.dead && (!kits || kits.indexOf(h.kit) >= 0));
  let any = false;
  list.forEach(h => {
    if (shortRestLeft(h) <= 0) { notes.push(`${h.name} 今天的短休次数已用完。`); return; }
    const con = Number(h.attrs && h.attrs.con) || 0;
    let heal = (Number(h.level) || 1) * 2 + con;
    if (SHORT_REST_BONUS[h.kit]) heal = Math.floor(heal * (1 + SHORT_REST_BONUS[h.kit]));
    const before = totalHpOf(h);
    healHeroFlesh(h, heal);
    LEDGER.shortUsed[h.kit] = (Number(LEDGER.shortUsed[h.kit]) || 0) + 1;
    notes.push(`${h.name} 短休恢复 ${totalHpOf(h) - before} 点（今日剩 ${shortRestLeft(h)} 次）。`);
    any = true;
  });
  if (any) ledgerAdvance(1, notes);
  ledgerCapture();
  return notes;
}

/* ===== 长休 ===== */

/** 长休计划：plan = { hours, food: { kit: foodId }, force } */
function longRestNeeds(plan) {
  plan = plan || {};
  const heroes = partyHeroes().filter(h => !h.dead);
  let water = 0;
  const food = {};
  heroes.forEach(h => {
    const c = heroRestCost(h);
    water += c.water;
    const fid = (plan.food && plan.food[h.kit]) || defaultFoodFor();
    food[fid] = (food[fid] || 0) + c.food;
  });
  const lack = [];
  if (ledgerWater() < water) lack.push(`水差 ${water - ledgerWater()} ml`);
  Object.keys(food).forEach(fid => {
    const have = bagCount(fid);
    if (have < food[fid]) lack.push(`${(ITEM_CATALOG[fid] || {}).name || fid} 差 ${food[fid] - have} 份`);
  });
  return { water, food, lack, ok: lack.length === 0 };
}
/** 默认吃最便宜的、背包里有的食物 */
function defaultFoodFor() {
  return FOOD_ORDER.find(id => bagCount(id) > 0) || FOOD_ORDER[0];
}

function unitNameOf(kit) {
  const h = partyHeroes().find(x => x.kit === kit);
  if (h) return h.name;
  return typeof weaponName === "function" ? weaponName(kit) : kit;
}

/** 长休。plan.watch：守夜者的 kit（角色或武器人），他这次不恢复 */
function ledgerLongRest(plan, notes) {
  notes = notes || [];
  plan = plan || {};
  const hours = Math.max(8, Math.min(12, Number(plan.hours) || 8));
  const need = longRestNeeds(plan);
  if (!need.ok && !plan.force) {
    notes.push(`补给不足，无法长休：${need.lack.join("，")}。只能消磨时间。`);
    ledgerAdvance(hours, notes);
    return { ok: false, notes };
  }
  if (!plan.force) {
    setLedgerWater(ledgerWater() - need.water);
    Object.keys(need.food).forEach(fid => bagAdd(fid, -need.food[fid]));
    notes.push(`长休 ${hours} 小时，消耗 ${need.water} ml 水、` +
      Object.keys(need.food).map(fid => `${ITEM_CATALOG[fid].name} ${need.food[fid]} 份`).join("、") + "。");
  } else {
    notes.push(`长休 ${hours} 小时（主持人强制，不扣补给）。`);
  }
  // 守夜：选一名角色或武器人整夜放哨。他不吃长休的恢复，也不刷新短休次数和「长休一次」的技能
  const watch = plan.watch || null;
  if (watch) notes.push(`${unitNameOf(watch)} 守夜：这次长休不恢复，短休次数和「长休一次」的技能也不刷新。`);
  let bags = bagCount("sleepbag");
  partyHeroes().filter(h => !h.dead).forEach(h => {
    if (h.kit === watch) { (h.linkedKits || []).forEach(k => { if (k !== watch) restoreDurability(k); }); return; }
    (h.layers || []).forEach(l => { l.current = l.max; });
    h.dying = false;
    h.upOnShp = false;
    h.stunned = false;
    const fid = (plan.food && plan.food[h.kit]) || defaultFoodFor();
    const foodBonus = ((ITEM_CATALOG[fid] || {}).shp || 0) * heroRestCost(h).food;
    const hasBag = bags > 0;
    if (hasBag) bags--;
    const perHour = 2 + (hasBag ? 1 : 0);
    const gain = hours * perHour + foodBonus;
    const before = Number(h.shp) || 0;
    h.shp = Math.min(Number(h.shpMax) || 0, before + gain);
    const why = `${hasBag ? "睡袋" : ""}${hasBag && foodBonus ? "、" : ""}${foodBonus ? "好一点的食物" : ""}`;
    notes.push(typeof shpHidden === "function" && shpHidden()
      ? `${h.name} 血量回满，坚毅生命慢慢恢复${why ? `（${why}有帮助）` : ""}。`
      : `${h.name} 血量回满，坚毅 ${before} → ${h.shp}` +
        `（${hours} 小时 × ${perHour}${hasBag ? "，含睡袋" : ""}${foodBonus ? `，食物 +${foodBonus}` : ""}）。`);
    (h.linkedKits || []).forEach(k => { if (k !== watch) restoreDurability(k); });
  });
  const keepW = watch && LEDGER.weapons && LEDGER.weapons[watch];
  LEDGER.weapons = keepW ? { [watch]: keepW } : {};
  notes.push(watch ? "除守夜者外，武器耐久回满，武器人伤势痊愈。" : "全部武器耐久回满，武器人伤势痊愈。");
  LEDGER.hours = 0;
  const keep = (tab) => (watch && tab && tab[watch] != null ? { [watch]: tab[watch] } : {});
  LEDGER.shortUsed = keep(LEDGER.shortUsed);
  LEDGER.restOnce = keep(LEDGER.restOnce);
  // 时钟照常往前走；过了 0 点才换天（长休本身已经刷新了短休次数）
  const days = advanceClock(hours * 60);
  LEDGER.day += days;
  notes.push(days ? `醒来：进入第 ${LEDGER.day} 天，${clockText(LEDGER.clock)}。` : `醒来：${clockText(LEDGER.clock)}。`);
  ledgerCapture();
  return { ok: true, notes };
}

/** 主持人：全员复原（不扣补给、不推进时间） */
function ledgerRestoreAll(notes) {
  notes = notes || [];
  partyHeroes().forEach(h => {
    (h.layers || []).forEach(l => { l.current = l.max; });
    h.shp = h.shpMax;
    h.dead = false; h.dying = false; h.upOnShp = false; h.stunned = false;
    h.weaponHeld = true;
    (h.linkedKits || []).forEach(k => restoreDurability(k));
  });
  LEDGER.weapons = {};
  LEDGER.shortUsed = {};
  LEDGER.restOnce = {};
  notes.push("主持人：全员血量、坚毅、耐久复原。");
  ledgerCapture();
  return notes;
}

/* ===== 维修与休整时用药 ===== */
function ledgerRepair(kit, notes) {
  notes = notes || [];
  if (bagCount("repair_kit") < 1) { notes.push("没有维修工具包。"); return notes; }
  const before = weaponDur(kit);
  const max = weaponDurMax(kit);
  if (before >= max) { notes.push(`${weaponName(kit)} 耐久已满。`); return notes; }
  bagAdd("repair_kit", -1);
  restoreDurability(kit, 10);
  notes.push(`用维修工具包修复 ${weaponName(kit)}：耐久 ${before} → ${weaponDur(kit)}。`);
  const owner = weaponOwner(kit);
  if (owner && owner.weaponHeld === false && !owner.dead) owner.weaponHeld = true;
  return notes;
}
function ledgerHealItem(itemId, kit, notes) {
  notes = notes || [];
  const h = heroByKit(kit);
  if (!h) return notes;
  if (bagCount(itemId) < 1) { notes.push("背包里没有这个物品。"); return notes; }
  const n = itemId === "clinic" ? 2 : 1;
  const r = takeDice(n, 4, 6);
  bagAdd(itemId, -1);
  const before = totalHpOf(h);
  healHeroFlesh(h, r.total);
  notes.push(`对 ${h.name} 使用${ITEM_CATALOG[itemId].name}：${r.text}，实际恢复 ${totalHpOf(h) - before}。`);
  ledgerCapture();
  return notes;
}

/* ===== 小工具 ===== */
function totalHpOf(u) { return (u.layers || []).reduce((s, l) => s + (Number(l.current) || 0), 0); }
function totalHpMaxOf(u) { return (u.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0); }
/** 休整时的治疗：从内到外补，死亡角色不能被治疗 */
function healHeroFlesh(u, n) {
  if (!u || u.dead) return;
  if (typeof healUnit === "function") { healUnit(u, n); return; }
  let left = Number(n) || 0;
  for (let i = (u.layers || []).length - 1; i >= 0 && left > 0; i--) {
    const l = u.layers[i];
    const add = Math.min(left, (Number(l.max) || 0) - (Number(l.current) || 0));
    l.current += add;
    left -= add;
  }
}
