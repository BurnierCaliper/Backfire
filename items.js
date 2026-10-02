/* 背包、掉落、道具使用。计算器和游戏共用。 */

const ITEM_CATALOG = {
  medkit:     { name: "简易医疗包", hint: "治疗一名友方 1d4+6 内层生命", target: "ally", combat: true },
  clinic:     { name: "诊所医疗包", hint: "治疗一名友方 2d4+6 内层生命", target: "ally", combat: true },
  stim:       { name: "强心注射剂", hint: "自身恢复 16 生命，失去 6 坚毅生命", target: "self", combat: true },
  steroid:    { name: "强化注射剂", hint: "自身 ATK +3 至战斗结束，失去 6 坚毅生命", target: "self", combat: true },
  bomb_e:     { name: "简易电手榴弹", hint: "对一个区域全部单位造成 1d6+6 电击", target: "zone", combat: true },
  bomb_a:     { name: "简易酸液瓶", hint: "对一个区域全部单位造成 1d6+6 酸液", target: "zone", combat: true },
  shockbomb:  { name: "冲击炸弹", hint: "对一个区域全部单位造成 2 击破", target: "zone", combat: true }
};

function ensureBag() {
  if (!state.bag || typeof state.bag !== "object") state.bag = { items: [] };
  if (!Array.isArray(state.bag.items)) state.bag.items = [];
  state.kuizhi = Number(state.kuizhi) || 0;
  return state.bag;
}

function bagCount(id) {
  ensureBag();
  const row = state.bag.items.find(x => x.id === id);
  return row ? Number(row.qty) || 0 : 0;
}

function bagAdd(id, qty, notes) {
  ensureBag();
  qty = Math.floor(Number(qty) || 0);
  if (!id || qty === 0) return;
  const spec = ITEM_CATALOG[id];
  if (!spec) return;
  let row = state.bag.items.find(x => x.id === id);
  if (!row) {
    row = { id, qty: 0 };
    state.bag.items.push(row);
  }
  row.qty = Math.max(0, (Number(row.qty) || 0) + qty);
  if (row.qty === 0) state.bag.items = state.bag.items.filter(x => x.id !== id);
  if (notes) notes.push(`${qty > 0 ? "获得" : "消耗"} ${spec.name} ×${Math.abs(qty)}`);
}

function bagList() {
  ensureBag();
  return state.bag.items
    .filter(x => (Number(x.qty) || 0) > 0 && ITEM_CATALOG[x.id])
    .map(x => Object.assign({ qty: x.qty }, ITEM_CATALOG[x.id], { id: x.id }));
}

function addKuizhi(n, notes, reason) {
  n = Math.floor(Number(n) || 0);
  if (!n) return;
  state.kuizhi = (Number(state.kuizhi) || 0) + n;
  if (notes) notes.push(`获得 ${n} 奎支${reason ? "（" + reason + "）" : ""}。背包现有 ${state.kuizhi}。`);
}

function rollEnemyLoot(u) {
  if (!u || u.isPlayer) return 0;
  // 单局（Roguelike）统一按杂兵 / 精英 / 首领三档，由开战的一方写进 state.lootByRank
  if (typeof state !== "undefined" && state.lootByKit && state.lootByKit[u.kit] != null) return Number(state.lootByKit[u.kit]) || 0;
  if (typeof state !== "undefined" && state.lootByRank) {
    const rank = typeof enemyRankOf === "function" ? enemyRankOf(u) : "minion";
    return Number(state.lootByRank[rank]) || 0;
  }
  if (Number(u.lootKuizhi) > 0) return Number(u.lootKuizhi);
  const kit = u.kit || "";
  const roll = (n, s, b) => (typeof takeDice === "function" ? takeDice(n, s, b).total : n * Math.ceil(s / 2) + (b || 0));
  if (kit === "thug_knife" || kit === "thug_hammer") return roll(1, 4, 0) * 10;
  if (kit === "bandit_boss") return roll(3, 4, 0) * 50 + 50;
  // 主持人手册第十章（摧毁植入体的掉落；破解另计，由主持人给）
  if (kit === "mecha_mg" || kit === "mecha_gl") return roll(2, 6, 0) * 100;
  if (kit === "captain_wolf" || kit === "captain_ox" || kit === "captain_lizard") return roll(1, 6, 0) * 50 + 100;
  if (kit === "giant") return roll(3, 6, 0) * 100 + 100;
  if (kit === "outlaw_king") return 0;
  const fixed = {
    guard_sword: 20, guard_gun: 20, patrol_car: 30, buoy: 20, dumpdrone: 35,
    crow: 15, swarm: 200, patrolboat: 200, spreader: 180, watchcrow: 350, dustbody: 120
  };
  return fixed[kit] || 0;
}

function useItemOn(actor, itemId, target, zone) {
  const notes = [];
  const spec = ITEM_CATALOG[itemId];
  if (!spec) { notes.push("没有这种道具。"); return notes; }
  if (bagCount(itemId) < 1) { notes.push(`没有${spec.name}。`); return notes; }
  bagAdd(itemId, -1, notes);
  if (itemId === "medkit" || itemId === "clinic") {
    const t = target || actor;
    const n = itemId === "clinic" ? 2 : 1;
    const r = takeDice(n, 4, 6);
    if (typeof healUnit === "function") healUnit(t, r.total);
    notes.push(`${actor.name} 对 ${t.name} 使用${spec.name}，恢复 ${r.text}。`);
  } else if (itemId === "stim") {
    if (typeof healUnit === "function") healUnit(actor, 16);
    actor.shp = Math.max(0, (Number(actor.shp) || 0) - 6);
    notes.push(`${actor.name} 使用强心注射剂：+16 生命，坚毅 −6。`);
  } else if (itemId === "steroid") {
    actor.atk = (Number(actor.atk) || 0) + 3;
    actor.itemAtkBonus = (Number(actor.itemAtkBonus) || 0) + 3;
    actor.shp = Math.max(0, (Number(actor.shp) || 0) - 6);
    notes.push(`${actor.name} 使用强化注射剂：ATK +3 至战斗结束，坚毅 −6。`);
  } else if (itemId === "bomb_e" || itemId === "bomb_a" || itemId === "shockbomb") {
    const z = zone != null ? Number(zone) : Number((target && target.zone) || actor.zone);
    const units = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(u =>
      Number(u.zone) === z && !u.dead && !u.hidden && !u.fused
    );
    notes.push(`${actor.name} 向 ${z} 区投出${spec.name}。`);
    // 范围攻击：这个区的按钮 / 拉杆触发一次（区里没人也会炸到）
    if (typeof markAoeZone === "function") { state.aoePulse = {}; markAoeZone(z); }
    units.forEach(u => {
      if (itemId === "shockbomb") {
        if (typeof dealBreak === "function") dealBreak(u, 2, "physical", notes, spec.name);
      } else {
        const ele = itemId === "bomb_e" ? "electric" : "acid";
        const r = takeDice(1, 6, 6);
        if (typeof dealTo === "function") {
          dealTo(actor, u, {
            atk: 0, mult: 0, flat: r.total, element: ele, baseBreak: 0,
            flags: { action: true, aoe: true, blockResolved: true }
          });
        }
        notes.push(`${u.name} 受到 ${r.text} ${ele}。`);
      }
    });
    if (typeof flushAoePulse === "function") flushAoePulse();
  }
  return notes;
}

function cheatFillBag() {
  const notes = [];
  addKuizhi(1000, notes, "后台刷入");
  Object.keys(ITEM_CATALOG).forEach(id => bagAdd(id, 3, notes));
  return notes;
}
