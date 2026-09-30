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
  active: false
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
  const cost = row.price * qty;
  if (!free && (Number(state.kuizhi) || 0) < cost) return [`奎支不够：${trpgShopName(row)} ×${qty} 要 ${cost}，手里只有 ${Number(state.kuizhi) || 0}。`];
  if (!free) state.kuizhi = (Number(state.kuizhi) || 0) - cost;
  if (row.give.water) setLedgerWater(ledgerWater() + row.give.water * qty);
  if (row.give.item) bagAdd(row.give.item, qty);
  return [`${free ? "主持人给予" : "买下"} ${trpgShopName(row)} ×${qty}${free ? "" : `，花掉 ${cost} 奎支（剩 ${state.kuizhi}）`}。`];
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

/* ---------- 时间与休息（规则都在 ledger.js，照手册第五章） ---------- */
function trpgPassHours(h) {
  const notes = [];
  h = Math.max(0, Math.floor(Number(h) || 0));
  if (!h) return notes;
  notes.push(`经过 ${h} 小时。`);
  ledgerAdvance(h, notes);
  if (exhaustTier() >= 4) {
    trpgHeroes().filter(u => !u.dead).forEach(u => { u.dead = true; notes.push(`${u.name} 力竭致死。`); });
  }
  ledgerCapture();
  return notes;
}
function trpgShortRest(kits) {
  return ledgerShortRest(kits && kits.length ? kits : null, []);
}
/** plan：{ hours, food: { kit: foodId }, force } */
function trpgLongRest(plan) {
  const r = ledgerLongRest(plan || {}, []);
  return r.notes;
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
  if (u.attrPicks.length >= 1 && u.attrPicks.indexOf(attr) >= 0) {
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

/* ---------- 武器升级（手册：材料 + 4 级以上找工匠付费） ---------- */
function trpgWeaponLevel(owner, kit) {
  return Number((owner.weaponLevels || {})[kit]) || 1;
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
  if (typeof setOwnedWeaponLevel === "function") setOwnedWeaponLevel(owner, kit, info.next);
  else { owner.weaponLevels = owner.weaponLevels || {}; owner.weaponLevels[kit] = info.next; }
  ledgerCapture();
  return notes;
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
  if (edit.hours != null) { const v = num(edit.hours, 0); if (v != null) { change("距上次长休（小时）", LEDGER.hours, v); LEDGER.hours = v; } }
  if (edit.kuizhi != null) { const v = num(edit.kuizhi, 0); if (v != null) { change("奎支", Number(state.kuizhi) || 0, v); state.kuizhi = v; } }
  if (edit.water != null) { const v = num(edit.water, 0); if (v != null) { change("水（ml）", ledgerWater(), v); setLedgerWater(v); } }

  Object.keys(edit.heroes || {}).forEach(kit => {
    const u = trpgHeroes().find(h => h.kit === kit);
    const e = edit.heroes[kit];
    if (!u || !e) return;
    const n = (label, a, b) => change(`${u.name} ${label}`, a, b);
    // 等级、属性先改：会重算血量与坚毅上限
    let restat = false;
    if (e.level != null) { const v = num(e.level, 1, 25); if (v != null && v !== (u.level || 1)) { n("等级", u.level || 1, v); u.level = v; restat = true; } }
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

/* ---------- 存档：每个团一个空位 ----------
 * 空位里放：{ name, at, campaign（队伍记忆）, log（探索记录）, level（敌人等级）, enc（上次的遭遇） }
 * 玩的时候每个操作、每场战斗结算都自动写回当前空位。 */
const TRPG_SLOT_COUNT = 3;
const TRPG_SLOTS_KEY = "anterscale-trpg-slots";
function trpgReadSlots() {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(TRPG_SLOTS_KEY) || "[]") || []; } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  // 旧版只有一份队伍记忆：第一次打开时放进空位 1
  if (!arr.some(Boolean)) {
    try {
      const old = localStorage.getItem("anterscale-campaign");
      if (old) {
        let log = [];
        try { log = JSON.parse(localStorage.getItem("anterscale-trpg-log") || "[]"); } catch (e) {}
        arr[0] = { name: "团 1", at: Date.now(), campaign: JSON.parse(old), log, level: 1, enc: null };
        localStorage.setItem(TRPG_SLOTS_KEY, JSON.stringify(arr));
      }
    } catch (e) {}
  }
  while (arr.length < TRPG_SLOT_COUNT) arr.push(null);
  return arr.slice(0, TRPG_SLOT_COUNT);
}
function trpgWriteSlot(i, data) {
  const arr = trpgReadSlots();
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
