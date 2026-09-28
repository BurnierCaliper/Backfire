const XP_BY_RANK = {
  minion: [0,5,15,30,50,80,110,200,320,400,570,740,950,1200,1400,1600,1800,2100,2400,2700,3000,3500,4000,4500,5000,5500],
  elite:  [0,10,30,70,100,150,210,320,600,800,1200,1600,2000,2500,3000,3500,4000,4500,5000,5500,6000,6600,7200,7800,8400,9200],
  boss:   [0,30,80,200,400,600,1200,2400,3500,5000,7000,9000,11000,14000,16000,18000,20000,22000,25000,27000,30000,34000,38000,42000,46000,50000]
};

const ENEMY_RANK = {
  guard_sword: "minion", guard_gun: "minion", thug_knife: "minion", thug_hammer: "minion",
  boomcar: "minion", sand_beast: "minion", sand_human: "minion", buoy: "minion",
  dumpdrone: "minion", swarm: "minion", crow: "minion", patrol_car: "minion",
  mecha_mg: "elite", mecha_gl: "elite", bandit_boss: "elite", captain_wolf: "elite",
  captain_ox: "elite", captain_lizard: "elite", bigsand: "elite", livesand: "elite",
  giant: "elite", patrolboat: "elite", spreader: "elite", watchcrow: "elite", dustbody: "elite",
  outlaw_king: "boss", chixia: "boss", sand_aggregate: "boss",
  ufo_body: "boss", ufo_leg: "minion"
};

function enemyRankOf(u) {
  if (!u || u.isPlayer) return null;
  return ENEMY_RANK[u.kit] || "minion";
}

function enemyActBudget(u) {
  if (!u || u.isPlayer) return { ap: 1, bonus: 1 };
  if (u.kit === "chixia" || u.kit === "outlaw_king") return { ap: 3, bonus: 1 };
  // 扬尘体：原本是 2 行动点 0 附赠，靠行动点移动。改成移动只能用附赠之后，
  // 给它 1 附赠保持「移动 + 一次攻击」的原有强度，否则它完全动不了。
  if (u.kit === "dustbody") return { ap: 1, bonus: 1 };
  if (u.kit === "sand_aggregate") {
    const ph = (u.resources && u.resources.phase) || 1;
    if (ph === 2 || ph === 3) return { ap: 2, bonus: 1 };
    return { ap: 1, bonus: 1 };
  }
  const r = enemyRankOf(u);
  if (r === "minion") return { ap: 1, bonus: 0 };
  if (r === "elite") return { ap: 1, bonus: 1 };
  return { ap: 1, bonus: 1 };
}

function xpDrop(rank, level) {
  const t = XP_BY_RANK[rank] || XP_BY_RANK.minion;
  const lv = Math.max(1, Math.min(25, Number(level) || 1));
  return t[lv] || t[t.length - 1];
}

function xpToNext(lv) {
  const n = Math.max(1, Number(lv) || 1);
  const need = {
    1: 155, 2: 390, 3: 700, 4: 1050, 5: 2100, 6: 4100, 7: 6600, 8: 9600, 9: 12000,
    10: 17000, 11: 21000, 12: 26000, 13: 30000, 14: 38000, 15: 44000, 16: 52000,
    17: 58000, 18: 67000, 19: 73000
  };
  return need[n] || 0;
}

function ceilDiv2(n) {
  return Math.ceil(n / 2);
}

function derivedFromAttrs(attrs, level) {
  attrs = attrs || {};
  const str = Number(attrs.str) || 5;
  const con = Number(attrs.con) || 5;
  const dex = Number(attrs.dex) || 5;
  const wil = Number(attrs.wil) || 5;
  const intel = Number(attrs.int) || 5;
  const sta = Number(attrs.sta) || 5;
  const lv = Math.max(1, Number(level) || 1);
  const up = lv - 1;
  return {
    hp: con * 2 + 2 + con * up,
    personalAtk: Math.ceil(4 + (str - 5) / 2) + Math.ceil(str * up / 7),
    def: Math.ceil(4 + (sta - 5) / 2) + Math.floor(lv / 10),
    shp: 10 + (wil - 5) + wil * up,
    cyber: Math.max(0, Math.min(99, 50 + (intel - 5) * 10)),
    dex, str, con, wil, intel, sta
  };
}

const WEAPON_GROWTH = {
  mint:     { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 8, atk: 4, baseDef: 3, baseDur: 5 },
  latte:    { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 4, atk: 3, baseDef: 3, baseDur: 6 },
  niu:      { layer: "armor",  baseHp: 8,  hp: 4, baseAtk: 5, atk: 4, baseDef: 3, baseDur: 5 },
  naruto:   { layer: "armor",  baseHp: 7,  hp: 4, baseAtk: 4, atk: 3, baseDef: 3, baseDur: 5 },
  mochi:    { layer: "armor",  baseHp: 12, hp: 5, baseAtk: 5, atk: 3, baseDef: 4, baseDur: 6 },
  berniel:  { layer: "armor",  baseHp: 10, hp: 6, baseAtk: 5, atk: 0, baseDef: 3, baseDur: 5 },
  bili:     { layer: "shield", baseHp: 10, hp: 4, baseAtk: 3, atk: 0, baseDef: 3, baseDur: 6 },
  // 维塔斯：内层装甲每级 +1，外层护盾每级 +4
  vitas:    { layer: "armor",  baseHp: 5,  hp: 1, baseDef: 4, baseDur: 4,
              extra: [{ layer: "shield", baseHp: 6, hp: 4 }] },
  torque:   { layer: "armor",  baseHp: 14, hp: 6, baseDef: 4, baseDur: 6 },
  ecmo:     { layer: "armor",  baseHp: 8,  hp: 4, baseDef: 3, baseDur: 4 },
  edc:      { layer: "armor",  baseHp: 10, hp: 4, baseDef: 4, baseDur: 5 }
};

const WEAPON_FORMULA = {
  mint: { base: 4, mainAttr: "int", mainCoef: 0.5, subAttr: "dex", subCoef: 0.3 },
  latte: { base: 2, mainAttr: "int", mainCoef: 0.5 },
  niu: { base: 4, mainAttr: "str", mainCoef: 0.6 },
  naruto: { base: 3, mainAttr: "str", mainCoef: 0.4, subAttr: "dex", subCoef: 0.2 },
  mochi: { base: 3, mainAttr: "str", mainCoef: 0.6 },
  berniel: { base: 5, mainAttr: "str", mainCoef: 0.8 },
  bili: { base: 3, mainAttr: "dex", mainCoef: 0.5 },
  vitas: { base: 4, mainAttr: "int", mainCoef: 0.4, subAttr: "dex", subCoef: 0.2 },
  torque: { base: 2, mainAttr: "str", mainCoef: 0.3, subAttr: "int", subCoef: 0.2 },
  ecmo: { base: 2, mainAttr: "int", mainCoef: 0.8 },
  edc: { base: 3, mainAttr: "int", mainCoef: 0.6, subAttr: "con", subCoef: 0.2 }
};

function weaponTier(lv) {
  return 0.5 * Math.max(1, Number(lv) || 1);
}

function computeWeaponAtk(kit, attrs, lv) {
  const f = WEAPON_FORMULA[kit];
  const g = WEAPON_GROWTH[kit];
  lv = Math.max(1, Number(lv) || 1);
  if (f) {
    attrs = attrs || {};
    const main = (Number(attrs[f.mainAttr]) || 0) * (Number(f.mainCoef) || 0);
    const sub = f.subAttr ? (Number(attrs[f.subAttr]) || 0) * (Number(f.subCoef) || 0) : 0;
    const neg = f.negAttr ? (Number(attrs[f.negAttr]) || 0) * (Number(f.negCoef) || 0) : 0;
    const base = (Number(f.base) || 3) + (lv - 1) * 1;
    return Math.max(0, Math.round(base + (main + sub + neg) * weaponTier(lv)));
  }
  if (g) return (g.baseAtk || 0) + (g.atk || 0) * (lv - 1);
  return 0;
}

function applyWeaponLevel(u) {
  if (!u) return;
  const g = WEAPON_GROWTH[u.kit];
  if (!g) return;
  const lv = Math.max(1, Number(u.level) || 1);
  const up = lv - 1;
  const hp = g.baseHp + g.hp * up;
  const layer = (u.layers || []).find(l => l.type === g.layer) || (u.layers || [])[0];
  if (layer) {
    const ratio = layer.max ? layer.current / layer.max : 1;
    layer.max = hp;
    layer.current = Math.max(0, Math.min(hp, Math.round(hp * ratio)));
  }
  (g.extra || []).forEach(ex => {
    const l2 = (u.layers || []).find(l => l.type === ex.layer);
    if (!l2) return;
    const hp2 = ex.baseHp + ex.hp * up;
    const r2 = l2.max ? l2.current / l2.max : 1;
    l2.max = hp2;
    l2.current = Math.max(0, Math.min(hp2, Math.round(hp2 * r2)));
  });
  let owner = null;
  if (typeof state !== "undefined" && u.weaponOf) {
    owner = (typeof findKit === "function") ? findKit(u.weaponOf, state.units) : null;
  }
  const watk = computeWeaponAtk(u.kit, owner && owner.attrs, lv);
  u.personalAtk = watk;
  u.atk = watk;
  if (owner && owner.kit === "hiaki" && typeof refreshHiakiAtk === "function") {
    refreshHiakiAtk(owner);
  } else if (owner && owner.weaponHeld !== false && (typeof weaponIsOut !== "function" || !weaponIsOut(owner))) {
    const primary = (owner.linkedKits || [])[0];
    if (!primary || primary === u.kit) {
      owner.weaponAtk = watk;
      owner.atk = (owner.personalAtk || 0) + watk;
    }
  }
  const def = g.baseDef + Math.floor(lv / 5);
  const defRatio = u.defMax ? u.def / u.defMax : 1;
  u.defMax = def;
  u.def = Math.max(0, Math.min(def, Math.round(def * defRatio)));
  u.resources = u.resources || {};
  u.resources.durability = (g.baseDur || 5) + Math.floor(lv / 2);
}

function applyLevelStats(u) {
  if (!u || !u.isPlayer || isWeaponUnit(u)) return;
  if (u.growth) {
    const up = Math.max(0, (u.level || 1) - 1);
    const hp = (u.baseHp || 14) + (u.growth.hp || 0) * up;
    const flesh = (u.layers || []).find(l => l.type === "flesh");
    if (flesh) {
      const ratio = flesh.max ? flesh.current / flesh.max : 1;
      flesh.max = hp;
      flesh.current = Math.max(0, Math.min(hp, Math.round(hp * ratio)));
    }
    if (u.attrs) {
      u.personalAtk = derivedFromAttrs(u.attrs, u.level).personalAtk;
    } else if (Number(u.growth.atk) > 0) {
      u.personalAtk = (u.baseAtk || u.personalAtk || 5) + u.growth.atk * up;
    }
    const primary = (u.linkedKits || [])[0];
    if (primary && typeof computeWeaponAtk === "function") {
      u.weaponAtk = computeWeaponAtk(primary, u.attrs, (u.weaponLevels && u.weaponLevels[primary]) || 1);
    }
    u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
    if (u.growth.shp) {
      const shp = (u.baseShp || u.shpMax || 10) + u.growth.shp * up;
      const shpRatio = u.shpMax ? u.shp / u.shpMax : 1;
      u.shpMax = shp;
      u.shp = Math.max(0, Math.min(shp, Math.round(shp * shpRatio)));
    }
    if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
    return;
  }
  if (!u.attrs) return;
  const d = derivedFromAttrs(u.attrs, u.level);
  const flesh = (u.layers || []).find(l => l.type === "flesh");
  if (flesh) {
    const ratio = flesh.max ? flesh.current / flesh.max : 1;
    flesh.max = d.hp;
    flesh.current = Math.max(0, Math.min(d.hp, Math.round(d.hp * ratio)));
  }
  u.personalAtk = d.personalAtk;
  const primary = (u.linkedKits || [])[0];
  if (primary && typeof computeWeaponAtk === "function") {
    u.weaponAtk = computeWeaponAtk(primary, u.attrs, (u.weaponLevels && u.weaponLevels[primary]) || 1);
  }
  u.atk = (u.personalAtk || 0) + (u.weaponHeld === false ? 0 : (u.weaponAtk || 0));
  const defRatio = u.defMax ? u.def / u.defMax : 1;
  u.defMax = d.def;
  u.def = Math.max(0, Math.min(d.def, Math.round(d.def * defRatio)));
  const shpRatio = u.shpMax ? u.shp / u.shpMax : 1;
  u.shpMax = d.shp;
  u.shp = Math.max(0, Math.min(d.shp, Math.round(d.shp * shpRatio)));
  u.cyber = d.cyber;
  if (u.kit === "hiaki" && typeof refreshHiakiAtk === "function") refreshHiakiAtk(u);
}

function unspentForLevel(lv) {
  let n = 0;
  if (lv >= 4) n += 1;
  if (lv >= 8) n += 1;
  return n;
}

function grantXpToPlayers(amount, reason) {
  amount = Math.floor(Number(amount) || 0);
  if (amount <= 0) return;
  fieldUnits().filter(u => u.isPlayer && !isWeaponUnit(u) && !u.dead).forEach(u => {
    u.xp = (u.xp || 0) + amount;
    const need = xpToNext(u.level);
    appendLog(`${u.name} 获得 ${amount} 经验${reason ? "（" + reason + "）" : ""}。当前 ${u.xp}/${need || "满级"}`);
  });
}

function tryLevelUp(u) {
  if (!u || isWeaponUnit(u)) return false;
  let changed = false;
  while (xpToNext(u.level) > 0 && (u.xp || 0) >= xpToNext(u.level)) {
    u.xp -= xpToNext(u.level);
    u.level += 1;
    if (u.level === 4 || u.level === 8) u.attrPoints = (u.attrPoints || 0) + 1;
    applyLevelStats(u);
    appendLog(`${u.name} 升到 ${u.level} 级。`);
    changed = true;
  }
  return changed;
}

function roleSkillsUnlocked(u) {
  const out = [];
  if (!u || !u.roles) return out;
  const spec = u.roles.primary && u.roles.primary === u.roles.secondary;
  const lv = u.level || 1;
  const add = (role, n) => out.push({ role, n });
  if (spec) {
    add(u.roles.primary, 1);
    if (lv >= 5) add(u.roles.primary, 2);
    if (lv >= 10) add(u.roles.primary, 3);
    if (lv >= 15) add(u.roles.primary, 4);
  } else {
    add(u.roles.primary, 1);
    if (lv >= 5) add(u.roles.secondary, 1);
    if (lv >= 10) add(u.roles.primary, 2);
    if (lv >= 15) add(u.roles.primary, 3);
  }
  return out;
}
