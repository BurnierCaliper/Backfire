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
  // 维修工具包：一包 10 点维修量，修几点耐久就用掉几点，用不完的留在「开封的维修工具包」里（数量 = 剩下的点数）。
  // 战斗中也能用（使用道具）：修手里或场上武器的耐久；对倒地的武器人用会把它修好重新站起来
  repair_kit:   { name: "维修工具包", hint: "共 10 点维修量：修几点耐久用几点，可以分几次用完 · 战斗中也能用，能修好倒地的武器人", repair: 10, combat: true, target: "weapon" },
  repair_kit_open: { name: "开封的维修工具包", hint: "数量 = 还剩几点维修量（先用这个，用完再开新的一包）", repairPts: true, combat: true, target: "weapon" },
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
/** 种族文字：先看角色资料（party.js · HERO_PROFILES 的「犬类人-犬」「兽人-狼」），没有再看卡片说明 */
function heroRaceText(u) {
  const p = u && typeof heroProfile === "function" ? heroProfile(u.kit) : null;
  return String((p && p.race) || (u && u.note) || "");
}
function heroRace(u) {
  const n = heroRaceText(u);
  // 兽人要先判：「兽人-狼」里的「狼」不能被当成犬类人
  if (/兽人/.test(n)) return "beast";
  if (/鼠类人|兔/.test(n)) return "rodent";
  if (/猫类人|豹|虎/.test(n)) return "feline";
  if (/犬类人|狐|狼/.test(n)) return "canine";
  if (/牛类人|马|羊/.test(n)) return "bovine";
  if (/红皮人/.test(n)) return "red";
  return "human";
}
function heroRestCost(u) { return LONG_REST_COST[heroRace(u)] || LONG_REST_COST.human; }

/** 短休治疗加成：犬类人-犬的种族特长「活力源泉」+25%（川川、灯）。以前按角色写死，只有川川有 */
function shortRestBonus(u) { return /犬类人-犬/.test(heroRaceText(u)) ? 0.25 : 0; }
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
  weapons: {},         // 旧档留下的武器人伤势；现在武器人每场开战回满血，不再使用
  shortUsed: {},       // 角色 kit → 今天已用短休次数
  restOnce: {},        // 角色 kit → { 技能 key: 次数 }：「长休一次」的技能，长休才刷新
  career: null,        // 整局战场记录：{ battles: [每场摘要], kits: { kit: 累计数据 } }（careerRecordBattle）
  tasks: [],           // 跑团：主持人发布的任务（trpg-tasks.js）
  place: null,         // 跑团：队伍在角鳞星地图上的位置（world-data.js · WORLD_PLACES 的 id）
  placePos: null,      // 跑团：标记拖到了地图上任意位置时的坐标 { x, y }（百分比）；place 记最近的地点
  spit: {},            // 角色 kit → 吐酸攻击的属性（兽人-蜥蜴种族特长，长休时可以换；没写是酸）
  ammoOrder: {},       // 胶囊弹药+：龙哥长休排好的下一场开局弹序（"RRBBRB"），用一场就清掉

  /** 存进队伍档案 */
  save() {
    return JSON.parse(JSON.stringify({
      day: this.day, hours: this.hours, clock: this.clock, dur: this.dur,
      heroes: this.heroes, weapons: this.weapons, shortUsed: this.shortUsed,
      restOnce: this.restOnce, career: this.career, tasks: this.tasks || [], place: this.place || null, placePos: this.placePos || null, spit: this.spit || {}, ammoOrder: this.ammoOrder || {}, water: ledgerWater()
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
    this.career = s.career || null;
    this.tasks = Array.isArray(s.tasks) ? s.tasks : [];
    this.place = typeof s.place === "string" ? s.place : null;
    this.placePos = s.placePos && isFinite(Number(s.placePos.x)) && isFinite(Number(s.placePos.y)) ? { x: Number(s.placePos.x), y: Number(s.placePos.y) } : null;
    this.spit = s.spit && typeof s.spit === "object" ? Object.assign({}, s.spit) : {};
    this.ammoOrder = s.ammoOrder && typeof s.ammoOrder === "object" ? Object.assign({}, s.ammoOrder) : {};
    if (s.water != null) setLedgerWater(s.water);
  },
  reset() { this.load({}); }
};

/* ===== 整局战场记录 =====
 * 每场战斗结算（settleBattleRewards）时，把这场的战场数据（state.battleStats）按角色 / 武器人的 kit 并进来。
 * 存在 LEDGER 里：单局跟着本局走（新开一局清空），跑团跟着存档空位走（重新开团清空）。 */
const CAREER_KEYS = ["dmg", "brk", "taken", "kills", "heal", "score", "assists", "blocks", "blockOk", "avoided", "staggers", "reduced"];
const CAREER_MAX_BATTLES = 200;
function careerData() {
  if (!LEDGER.career) LEDGER.career = { battles: [], kits: {} };
  LEDGER.career.battles = LEDGER.career.battles || [];
  LEDGER.career.kits = LEDGER.career.kits || {};
  return LEDGER.career;
}
const CAREER_DETAIL_BATTLES = 10;   // 最近几场留下每个人的明细（战绩页「最近 10 场」）
function careerRecordBattle(outcome, grade, extra) {
  const stats = (typeof state !== "undefined" && state.battleStats) || {};
  const ids = Object.keys(stats);
  const units = (typeof state !== "undefined" && state.units) || [];
  const c = careerData();
  const no = (c.battles.length ? c.battles[c.battles.length - 1].no : 0) + 1;
  let teamDmg = 0, mvp = null;
  ids.forEach(id => {
    const s = stats[id];
    if (!s || !s.kit) return;
    const row = c.kits[s.kit] || (c.kits[s.kit] = { name: s.name, kit: s.kit, weaponOf: s.weaponOf || null, battles: 0 });
    row.name = s.name;
    row.weaponOf = s.weaponOf || row.weaponOf || null;
    CAREER_KEYS.forEach(k => { row[k] = (Number(row[k]) || 0) + Math.round(Number(s[k]) || 0); });
    teamDmg += Math.round(Number(s.dmg) || 0);
    if (!mvp || (Number(s.dmg) || 0) > mvp.dmg) mvp = { name: s.name, dmg: Math.round(Number(s.dmg) || 0) };
  });
  // 出场的角色（不管有没有数据）都算打过这一场
  units.filter(u => u.isPlayer && !u._removed && !(typeof isWeaponUnit === "function" && isWeaponUnit(u)) && u.kit).forEach(u => {
    const row = c.kits[u.kit] || (c.kits[u.kit] = { name: u.name, kit: u.kit, weaponOf: null, battles: 0 });
    row.battles = (Number(row.battles) || 0) + 1;
  });
  // 明细：有数据的都算上，没出手的上场角色也列出来（全是 0）
  const seen = new Set(ids.map(id => stats[id] && stats[id].kit).filter(Boolean));
  const idle = units.filter(u => u.isPlayer && !u._removed && !u.hidden && u.kit && !u.escort && !seen.has(u.kit))
    .map(u => ({ name: u.name, kit: u.kit, weaponOf: u.weaponOf || null }));
  const rows = ids.map(id => stats[id]).filter(x => x && x.kit).concat(idle).map(x => {
    const r = { name: x.name, kit: x.kit, weaponOf: x.weaponOf || null };
    CAREER_KEYS.forEach(k => { r[k] = Math.round(Number(x[k]) || 0); });
    r.share = teamDmg > 0 ? Math.round(r.dmg / teamDmg * 1000) / 10 : 0;
    return r;
  });
  extra = extra || {};
  c.battles.push({
    no, outcome, turns: Number(state.turnNo) || 1,
    grade: grade ? grade.grade : "", score: grade ? grade.score : 0,
    when: typeof ledgerTimeText === "function" ? ledgerTimeText() : "", teamDmg,
    mvp: mvp && mvp.dmg > 0 ? mvp : null,
    name: extra.name || "", drops: extra.drops || null, rows
  });
  while (c.battles.length > CAREER_MAX_BATTLES) c.battles.shift();
  c.battles.slice(0, -CAREER_DETAIL_BATTLES).forEach(b => { delete b.rows; });   // 更早的只留概要
  return c;
}

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
  if (typeof weaponBaseDur === "function") return weaponBaseDur(kit, lv);
  const g = (typeof WEAPON_GROWTH !== "undefined" && WEAPON_GROWTH[kit]) || {};
  return (g.baseDur || 5) + Math.floor(lv / 2);
}
/** 武器上装的客制化图纸加成（单局在开战前写进 state.weaponMods；战斗原型没有）。
 *  武器不到 4 级时图纸不生效（mods.js · bpUnlocked：旧存档、后台把武器降了级） */
function weaponMod(kit) {
  const m = kit && state.weaponMods && state.weaponMods[kit];
  return m && (typeof bpUnlocked !== "function" || bpUnlocked(kit)) ? m : {};
}
/** 这个单位此刻吃到的图纸加成：角色看手里那把，武器人看自己 */
function unitWeaponMod(u) {
  if (!u || !state.weaponMods) return {};
  if (state.weaponMods[u.kit]) return weaponMod(u.kit);
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

/** 武器人上次留下的伤势。作者定：武器人每次开战都回满血（唯一上不了场的情况是耐久为 0），
 *  所以不再跨战斗带伤，一律返回 null（满血） */
function weaponCarryLayers(kit) {
  return null;
}

/** 记下场上角色的状态 */
function ledgerCapture() {
  // 武器人每次开战都回满血，不记伤势（weaponCarryLayers）
  if (LEDGER.weapons) delete LEDGER.weapons;
  partyHeroes().forEach(h => {
    LEDGER.heroes[h.kit] = {
      layers: persistentLayers(h).map(l => l.current),
      // 自焚吸血回的坚毅是临时的：战后不超过吸血前的坚毅（先扣掉的那部分算在临时的里）
      shp: Math.max(0, h.shpBurnBase != null ? Math.min(Number(h.shp) || 0, Number(h.shpBurnBase) || 0) : Number(h.shp) || 0),
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
  (state.units || []).filter(u => u.isPlayer && isWeaponUnit(u) && !u.escort && u.dead && !u._durCounted).forEach(u => {
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
/** 单局期间（rogue.js 换上了本局的档案）：第几天跟着单局的任务天数走（rogue.js · advanceDays 同步过来），
 *  时钟过 0 点不另算一天；满 80 小时的力竭致死由单局结算（本局结束）。
 *  以前两边各算各的，顶栏的天数和整局数据里每场战斗的时间对不上 */
function ledgerInRun() {
  return typeof Rogue !== "undefined" && typeof Rogue.inRunMode === "function" && Rogue.inRunMode();
}
function ledgerAdvance(hours, notes) {
  hours = Math.max(0, Number(hours) || 0);
  const minutes = Math.round(hours * 60);
  if (!minutes) return;
  LEDGER.hours = Math.round(((Number(LEDGER.hours) || 0) + minutes / 60) * 600) / 600;
  // 过了 0 点算新的一天，短休次数刷新
  const days = advanceClock(minutes);
  if (days > 0) {
    const inRun = ledgerInRun();
    if (!inRun) LEDGER.day += days;
    LEDGER.shortUsed = {};
    if (notes) notes.push(inRun ? "过了 0 点，短休次数刷新。" : `进入第 ${LEDGER.day} 天，短休次数刷新。`);
  }
  const t = exhaustTier();
  if (t && notes) notes.push(`距上次长休 ${durationText(LEDGER.hours)}：${exhaustText(t)}`);
  ledgerExhaustDeath(notes);
}
/** 满 80 小时没长休：全队力竭致死（手册第五章）。推进时间的地方都会走到这里：
 *  跑团推进时间、短休、补给不够只能消磨时间的长休、战斗画面的休整面板。以前只有跑团推进时间判，
 *  短休和消磨时间推过 80 小时不会死（记录却写着力竭致死）。单局由 rogue.js 自己结算（整局结束） */
function ledgerExhaustDeath(notes) {
  if (exhaustTier() < 4 || ledgerInRun()) return;
  const gone = partyHeroes().filter(u => !u.dead);
  gone.forEach(u => { u.dead = true; if (notes) notes.push(`${u.name} 力竭致死。`); });
  if (gone.length) ledgerCapture();
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
    if (shortRestBonus(h)) heal = Math.floor(heal * (1 + shortRestBonus(h)));
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

/** 睡眠道具（物品表里带 sleep 的，例如睡袋）：不消耗，一人一个，长休每小时坚毅恢复 +sleep */
function sleepItemIds() { return Object.keys(ITEM_CATALOG).filter(id => Number(ITEM_CATALOG[id].sleep) > 0); }
/** 没有指定时的睡眠道具分配：按队伍顺序，有几个睡袋给前几个人 */
function defaultSleepPlan() {
  const out = {};
  const left = {};
  sleepItemIds().forEach(id => { left[id] = bagCount(id); });
  partyHeroes().filter(h => !h.dead).forEach(h => {
    const id = sleepItemIds().find(x => left[x] > 0);
    out[h.kit] = id || "";
    if (id) left[id] -= 1;
  });
  return out;
}
/** 这个角色这次长休用哪个睡眠道具（"" = 不用） */
function sleepFor(plan, kit) {
  const s = plan && plan.sleep && Object.prototype.hasOwnProperty.call(plan.sleep, kit) ? plan.sleep[kit] : defaultSleepPlan()[kit];
  return s && ITEM_CATALOG[s] && Number(ITEM_CATALOG[s].sleep) > 0 ? s : "";
}

/** 长休计划：plan = { hours, food: { kit: foodId }, sleep: { kit: 睡眠道具 id 或 "" }, force }
 *  每个角色单独选吃哪种食物（这个角色要吃的几份都吃这一种）和用哪个睡眠道具（不写就按默认分配） */
function longRestNeeds(plan) {
  plan = plan || {};
  const heroes = partyHeroes().filter(h => !h.dead);
  let water = 0;
  const food = {}, sleep = {};
  heroes.forEach(h => {
    const c = heroRestCost(h);
    water += c.water;
    const fid = (plan.food && plan.food[h.kit]) || defaultFoodFor();
    food[fid] = (food[fid] || 0) + c.food;
    const sid = sleepFor(plan, h.kit);
    if (sid) sleep[sid] = (sleep[sid] || 0) + 1;
  });
  const lack = [];
  if (ledgerWater() < water) lack.push(`水差 ${water - ledgerWater()} ml`);
  Object.keys(food).forEach(fid => {
    const have = bagCount(fid);
    if (have < food[fid]) lack.push(`${(ITEM_CATALOG[fid] || {}).name || fid} 差 ${food[fid] - have} 份`);
  });
  Object.keys(sleep).forEach(sid => {
    const have = bagCount(sid);
    if (have < sleep[sid]) lack.push(`${(ITEM_CATALOG[sid] || {}).name || sid} 只有 ${have} 个，分给了 ${sleep[sid]} 个人`);
  });
  return { water, food, sleep, lack, ok: lack.length === 0 };
}
/* ===== 吐酸（兽人-蜥蜴种族特长）的属性：长休时可以改 ===== */
const SPIT_ELEMENTS = ["acid", "fire", "ice", "electric", "energy", "physical", "harmonic"];
/** 这个角色有没有吐酸（看种族） */
function canSpit(kit) { return typeof heroProfile === "function" && (heroProfile(kit) || {}).race === "兽人-蜥蜴"; }
/** 这个角色现在吐酸是什么属性 */
function spitElementOf(kit) {
  const e = LEDGER.spit && LEDGER.spit[kit];
  return SPIT_ELEMENTS.indexOf(e) >= 0 ? e : "acid";
}
/** 胶囊弹药+：龙哥长休时能不能排下一场的弹序；所有 3 红 3 蓝的排法（"RRRBBB"……共 20 种） */
function canOrderAmmo(h) { return !!h && h.kit === "longge" && typeof passivePlus === "function" && passivePlus(h, 2); }
const AMMO_ORDERS = (() => {
  const out = [];
  for (let m = 0; m < 64; m++) {
    const bits = m.toString(2).padStart(6, "0");
    if ((bits.match(/1/g) || []).length === 3) out.push(bits.replace(/1/g, "R").replace(/0/g, "B"));
  }
  return out;
})();
/** 长休界面用：每个角色要多少、现在选了什么，以及能选的食物 / 睡眠道具（带库存）。plan 同 longRestNeeds */
function longRestOptions(plan) {
  plan = plan || {};
  const heroes = partyHeroes().filter(h => !h.dead).map(h => {
    const c = heroRestCost(h);
    const fid = (plan.food && plan.food[h.kit]) || defaultFoodFor();
    const spit = canSpit(h.kit) ? ((plan.spit && SPIT_ELEMENTS.indexOf(plan.spit[h.kit]) >= 0) ? plan.spit[h.kit] : spitElementOf(h.kit)) : null;
    const ammo = canOrderAmmo(h) ? ((plan.ammo && plan.ammo[h.kit] != null) ? plan.ammo[h.kit] : ((LEDGER.ammoOrder || {})[h.kit] || "")) : null;
    return { kit: h.kit, name: h.name, water: c.water, food: c.food, foodId: fid, sleepId: sleepFor(plan, h.kit), spit, ammo };
  });
  const foods = FOOD_ORDER.filter(id => ITEM_CATALOG[id]).map(id => ({ id, name: ITEM_CATALOG[id].name, have: bagCount(id), shp: Number(ITEM_CATALOG[id].shp) || 0 }));
  const sleeps = sleepItemIds().map(id => ({ id, name: ITEM_CATALOG[id].name, have: bagCount(id), bonus: Number(ITEM_CATALOG[id].sleep) || 0 }));
  const food = {}, sleep = {};
  heroes.forEach(h => { food[h.kit] = h.foodId; sleep[h.kit] = h.sleepId; });
  const spit = {};
  heroes.forEach(h => { if (h.spit) spit[h.kit] = h.spit; });
  const spitElements = SPIT_ELEMENTS.map(id => ({ id, name: (typeof ELE !== "undefined" && ELE[id]) || id }));
  const ammo = {};
  heroes.forEach(h => { if (h.ammo != null) ammo[h.kit] = h.ammo; });
  // 弹序选项：空 = 开局随机；其余是 3 红 3 蓝的排法，按「红红红蓝蓝蓝」这样写
  const ammoOrders = [{ id: "", name: "开局随机" }].concat(AMMO_ORDERS.map(id => ({ id, name: id.replace(/R/g, "红").replace(/B/g, "蓝") })));
  return { heroes, foods, sleeps, spitElements, ammoOrders, water: ledgerWater(), plan: { food, sleep, spit, ammo }, need: longRestNeeds(Object.assign({}, plan, { food, sleep })) };
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
  // 胶囊弹药+：排好下一场开局的 6 发子弹顺序（空 = 随机）
  Object.keys(plan.ammo || {}).forEach(kit => {
    const h = partyHeroes().find(x => x.kit === kit);
    const v = String(plan.ammo[kit] || "");
    if (!canOrderAmmo(h) || (v && AMMO_ORDERS.indexOf(v) < 0)) return;
    LEDGER.ammoOrder = LEDGER.ammoOrder || {};
    if (v) { LEDGER.ammoOrder[kit] = v; notes.push(`${h.name} 排好了下一场的弹序：${v.replace(/R/g, "红").replace(/B/g, "蓝")}。`); }
    else delete LEDGER.ammoOrder[kit];
  });
  // 吐酸：长休时可以改变吐酸攻击的属性（守夜的人也能改，这不算恢复）
  Object.keys(plan.spit || {}).forEach(kit => {
    const e = plan.spit[kit];
    if (!canSpit(kit) || SPIT_ELEMENTS.indexOf(e) < 0 || e === spitElementOf(kit)) return;
    LEDGER.spit = LEDGER.spit || {};
    const before = spitElementOf(kit);
    LEDGER.spit[kit] = e;
    const nm = (k) => (typeof ELE !== "undefined" && ELE[k]) || k;
    notes.push(`${unitNameOf(kit)} 的吐酸攻击属性：${nm(before)} → ${nm(e)}。`);
  });
  partyHeroes().filter(h => !h.dead).forEach(h => {
    if (h.kit === watch) { (h.linkedKits || []).forEach(k => { if (k !== watch) restoreDurability(k); }); return; }
    (h.layers || []).forEach(l => { l.current = l.max; });
    h.dying = false;
    h.upOnShp = false;
    h.stunned = false;
    const fid = (plan.food && plan.food[h.kit]) || defaultFoodFor();
    const foodBonus = ((ITEM_CATALOG[fid] || {}).shp || 0) * heroRestCost(h).food;
    const sid = sleepFor(plan, h.kit);
    const hasBag = !!sid;
    const perHour = 2 + (hasBag ? Number(ITEM_CATALOG[sid].sleep) || 0 : 0);
    const gain = hours * perHour + foodBonus;
    const before = Number(h.shp) || 0;
    h.shp = Math.min(Number(h.shpMax) || 0, before + gain);
    const bagName = hasBag ? ITEM_CATALOG[sid].name : "";
    const why = `${bagName}${hasBag && foodBonus ? "、" : ""}${foodBonus ? "好一点的食物" : ""}`;
    notes.push(typeof shpHidden === "function" && shpHidden()
      ? `${h.name} 血量回满，坚毅生命慢慢恢复${why ? `（${why}有帮助）` : ""}。`
      : `${h.name} 血量回满，坚毅 ${before} → ${h.shp}` +
        `（${hours} 小时 × ${perHour}${hasBag ? `，含${bagName}` : ""}${foodBonus ? `，食物 +${foodBonus}` : ""}）。`);
    (h.linkedKits || []).forEach(k => { if (k !== watch) restoreDurability(k); });
  });
  const keepW = watch && LEDGER.weapons && LEDGER.weapons[watch];
  LEDGER.weapons = keepW ? { [watch]: keepW } : {};
  notes.push(watch ? "除守夜者外，武器耐久回满，武器人伤势痊愈。" : "全部武器耐久回满，武器人伤势痊愈。");
  LEDGER.hours = 0;
  const keep = (tab) => (watch && tab && tab[watch] != null ? { [watch]: tab[watch] } : {});
  LEDGER.shortUsed = keep(LEDGER.shortUsed);
  LEDGER.restOnce = keep(LEDGER.restOnce);
  // 时钟照常往前走；过了 0 点才换天（长休本身已经刷新了短休次数）。单局按任务天数记日子，这里不换天
  const days = advanceClock(hours * 60);
  const newDay = days > 0 && !ledgerInRun();
  if (newDay) LEDGER.day += days;
  notes.push(newDay ? `醒来：进入第 ${LEDGER.day} 天，${clockText(LEDGER.clock)}。` : `醒来：${clockText(LEDGER.clock)}。`);
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
/* ===== 维修点数：维修工具包按点数用 ===== */
const REPAIR_KIT_POINTS = 10;
/** 背包里一共还有几点维修量（没开封的每包 10 点 + 开封那包剩下的） */
function repairPoints() { return bagCount("repair_kit") * REPAIR_KIT_POINTS + bagCount("repair_kit_open"); }
/** 用掉 n 点维修量：先用开封的，不够再开新的一包，剩下的留在开封那包里。返回实际用掉几点 */
function spendRepairPoints(n) {
  let left = Math.max(0, Math.min(Math.floor(Number(n) || 0), repairPoints()));
  const used = left;
  const open = Math.min(bagCount("repair_kit_open"), left);
  if (open) { bagAdd("repair_kit_open", -open); left -= open; }
  while (left > 0 && bagCount("repair_kit") > 0) {
    bagAdd("repair_kit", -1);
    const take = Math.min(REPAIR_KIT_POINTS, left);
    left -= take;
    if (REPAIR_KIT_POINTS - take > 0) bagAdd("repair_kit_open", REPAIR_KIT_POINTS - take);
  }
  return used;
}
function repairPointsText() {
  const kits = bagCount("repair_kit"), open = bagCount("repair_kit_open");
  return `维修量 ${repairPoints()} 点（${kits} 包没开封${open ? `，开封的还剩 ${open} 点` : ""}）`;
}
/** 修一把武器的耐久：缺几点修几点（维修量不够就修到用完为止） */
function ledgerRepair(kit, notes) {
  notes = notes || [];
  if (repairPoints() < 1) { notes.push("没有维修工具包。"); return notes; }
  const before = weaponDur(kit);
  const max = weaponDurMax(kit);
  if (before >= max) { notes.push(`${weaponName(kit)} 耐久已满。`); return notes; }
  const used = spendRepairPoints(max - before);
  restoreDurability(kit, used);
  notes.push(`用维修工具包修复 ${weaponName(kit)}：耐久 ${before} → ${weaponDur(kit)}，用掉 ${used} 点维修量（还剩 ${repairPoints()} 点）。`);
  const owner = weaponOwner(kit);
  if (owner && owner.weaponHeld === false && !owner.dead && !weaponOutOnField(kit)) owner.weaponHeld = true;
  return notes;
}
/** 这把武器此刻是不是以武器人的样子在场上（倒下没收回的也算）：在场时主人手里没有它 */
function weaponOutOnField(kit) {
  return (state.units || []).some(u => u.kit === kit && !u.hidden && !u.fused && !u._removed && (typeof isWeaponUnit !== "function" || isWeaponUnit(u)));
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
  healHeroFlesh(h, r.total);   // 医疗包：和其他治疗一样从内往外补，可以治到外层（作者定）
  notes.push(`对 ${h.name} 使用${ITEM_CATALOG[itemId].name}：${r.text}，实际恢复 ${totalHpOf(h) - before}。`);
  ledgerCapture();
  return notes;
}

/* ===== 小工具 ===== */
/** 进下一场战斗前的提醒：血量低于 20% 而且今天还能短休的队员（濒死 / 死亡的不算）。
 *  返回 [{ kit, name, hp, max, pct, left }]，空数组 = 不用提醒 */
const LOW_HP_WARN_RATIO = 0.2;
function lowHpRestWarning() {
  return partyHeroes().filter(h => !h.dead && !h.dying && !h.hidden).map(h => {
    const hp = totalHpOf(h), max = totalHpMaxOf(h);
    return { kit: h.kit, name: h.name, hp, max, pct: max > 0 ? Math.round(hp / max * 100) : 100, left: shortRestLeft(h) };
  }).filter(x => x.max > 0 && x.hp / x.max < LOW_HP_WARN_RATIO && x.left > 0);
}
function lowHpWarningText(list) {
  return `队伍状态不佳：${list.map(x => `${x.name} 血量 ${x.hp}/${x.max}（${x.pct}%，今天还能短休 ${x.left} 次）`).join("；")}。\n\n确定直接进入下一场战斗吗？（取消的话可以先短休）`;
}
function totalHpOf(u) { return (u.layers || []).reduce((s, l) => s + (Number(l.current) || 0), 0); }
function totalHpMaxOf(u) { return (u.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0); }
/** 休整时的治疗：从内到外补，死亡角色不能被治疗。opt.inner：只补最内层（医疗包「治疗内层生命」） */
function healHeroFlesh(u, n, opt) {
  if (!u || u.dead) return;
  if (typeof healUnit === "function") { healUnit(u, n, opt); return; }
  let left = Number(n) || 0;
  const ls = opt && opt.inner ? (u.layers || []).slice(-1) : (u.layers || []);
  for (let i = ls.length - 1; i >= 0 && left > 0; i--) {
    const l = ls[i];
    const add = Math.min(left, (Number(l.max) || 0) - (Number(l.current) || 0));
    l.current += add;
    left -= add;
  }
}
