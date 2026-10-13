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

/* 武器改装件也放在背包里（growth.js 的 WEAPON_PARTS，物品 id = part_改装件id） */
function registerWeaponPartItems() {
  if (typeof WEAPON_PARTS === "undefined") return;
  Object.keys(WEAPON_PARTS).forEach(id => {
    const p = WEAPON_PARTS[id];
    const key = typeof weaponPartItemId === "function" ? weaponPartItemId(id) : "part_" + id;
    const neg = p.neg && typeof WEAPON_PART_ATTR_CN !== "undefined" ? ` · ${WEAPON_PART_ATTR_CN[p.neg]}−` : "";
    if (!ITEM_CATALOG[key]) ITEM_CATALOG[key] = { name: `改装件·${p.name}${p.grade ? `（${p.grade}级${neg}）` : ""}`,
      hint: typeof weaponPartText === "function" ? weaponPartText(id) : "", combat: false, part: id };
  });
}
registerWeaponPartItems();

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

/* 联机单局按角色分物品（online-rogue.js）：某名单位能用的数量 = 自己的 + 队伍公用的。没装就是整个背包 */
let itemAccess = null;
function setItemAccess(fn) { itemAccess = typeof fn === "function" ? fn : null; }
function itemCountFor(unit, id) {
  return itemAccess && unit ? Math.max(0, Math.min(bagCount(id), Number(itemAccess(unit, id)) || 0)) : bagCount(id);
}
/** 背包里的物品；给了 unit 就只算这名单位能用的（联机单局） */
function bagList(unit) {
  ensureBag();
  return state.bag.items
    .filter(x => (Number(x.qty) || 0) > 0 && ITEM_CATALOG[x.id])
    .map(x => Object.assign({ qty: unit ? itemCountFor(unit, x.id) : x.qty }, ITEM_CATALOG[x.id], { id: x.id }))
    .filter(x => x.qty > 0);
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
  if (kit === "thug_knife" || kit === "thug_hammer" || kit === "mine_overseer") return roll(1, 4, 0) * 10;
  if (kit === "bandit_boss") return roll(3, 4, 0) * 50 + 50;
  // 主持人手册第十章（摧毁植入体的掉落；破解另计，由主持人给）
  if (kit === "mecha_mg" || kit === "mecha_gl" || kit === "gas_collector") return roll(2, 6, 0) * 100;
  if (kit === "captain_wolf" || kit === "captain_ox" || kit === "captain_lizard" || kit === "ant_guard" || kit === "ant_hunter") return roll(1, 6, 0) * 50 + 100;
  if (kit === "giant") return roll(3, 6, 0) * 100 + 100;
  if (kit === "outlaw_king") return 0;
  const fixed = {
    guard_sword: 20, guard_gun: 20, patrol_car: 30, buoy: 20, dumpdrone: 35, mine_guard: 20, flint_sweeper: 20, alarm_bot: 20, meteor_miner: 35,
    crow: 15, swarm: 200, patrolboat: 200, spreader: 180, watchcrow: 350, dustbody: 120
  };
  return fixed[kit] || 0;
}

/** 维修工具包能修的武器：[{ kit, name, unit, owner, down, dur, max, need }]（need = 这次能用掉几点） */
function repairTargets() {
  const out = [];
  const units = state.units || [];
  partyHeroes().filter(h => !h.dead).forEach(h => (h.linkedKits || []).forEach(k => {
    const unit = units.find(u => u.kit === k && !u._removed && !u.fused && (!u.weaponOf || u.weaponOf === h.kit)) || null;
    const down = !!(unit && unit.dead);
    const dur = weaponDur(k), max = weaponDurMax(k);
    out.push({ kit: k, name: weaponName(k), unit, owner: h, down, dur, max, need: down ? reviveCost(unit) : Math.max(0, max - dur) });
  }));
  return out;
}
/** 修好倒地的武器人要用几点：恢复最大生命的 25%（至少 1 点），1 点维修量 = 1 点生命 */
const REPAIR_REVIVE_RATIO = 0.25;
function reviveCost(unit) {
  const max = (unit.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0);
  return Math.max(1, Math.ceil(max * REPAIR_REVIVE_RATIO));
}
/** 战斗中用维修工具包：kit 指定哪把武器（不给就按目标单位：武器人自己，角色手里那把） */
function useRepairKit(actor, target, kit, notes) {
  if (repairPoints() < 1) { notes.push("没有维修工具包。"); return notes; }
  const list = repairTargets();
  let row = typeof kit === "string" ? list.find(r => r.kit === kit) : null;
  if (!row && target) row = list.find(r => r.unit === target) || list.find(r => r.owner === target && typeof heldWeaponKit === "function" && r.kit === heldWeaponKit(target));
  if (!row) { notes.push("选一把要修的武器。"); return notes; }
  if (row.down) {
    // 倒地的武器人：修好重新站起来（从最内层开始补血），这回合没有行动
    const u = row.unit;
    const used = spendRepairPoints(row.need);
    u.dead = false; u.dying = false; u.stunned = false;
    u.ap = 0; u.bonus = 0;
    let left = used;
    for (let i = u.layers.length - 1; i >= 0 && left > 0; i--) {
      const l = u.layers[i];
      const add = Math.min(left, (Number(l.max) || 0) - (Number(l.current) || 0));
      l.current = (Number(l.current) || 0) + add;
      left -= add;
    }
    u.def = u.defMax != null ? u.defMax : u.def;
    notes.push(`${actor.name} 用维修工具包修好倒地的 ${row.name}：恢复 ${used} 点生命重新站起来，用掉 ${used} 点维修量（还剩 ${repairPoints()} 点）。`);
    return notes;
  }
  if (row.need <= 0) { notes.push(`${row.name} 耐久已满。`); return notes; }
  const before = row.dur;
  const used = spendRepairPoints(row.need);
  restoreDurability(row.kit, used);
  // 修好的武器回到主人手里——除非它正以武器人在场（以前修在场的武器人会把主人也设成持械，两边同时拿着）
  if (row.owner && row.owner.weaponHeld === false && !row.owner.dead && before <= 0 && typeof heldWeaponKit === "function" &&
      !(typeof weaponOutOnField === "function" && weaponOutOnField(row.kit))) row.owner.weaponHeld = true;
  notes.push(`${actor.name} 用维修工具包修 ${row.name}：耐久 ${before} → ${weaponDur(row.kit)}，用掉 ${used} 点维修量（还剩 ${repairPoints()} 点）。`);
  return notes;
}
/** 道具自己扣坚毅生命（强心 / 强化注射剂）：不会致死，坚毅最少留 1。返回实际扣掉的量 */
function selfShpCost(u, n) {
  const cur = Math.max(0, Number(u.shp) || 0);
  const next = Math.max(Math.min(1, cur), cur - n);
  u.shp = next;
  return cur - next;
}
function useItemOn(actor, itemId, target, zone) {
  const notes = [];
  // 濒死没起身的人不能用道具（以前规则层不拦，只靠界面）
  if (actor && actor.dying && !actor.upOnShp) { notes.push(`${actor.name} 濒死中。先点「起身」。`); return notes; }
  const spec = ITEM_CATALOG[itemId];
  if (!spec) { notes.push("没有这种道具。"); return notes; }
  if (spec.target === "weapon") return useRepairKit(actor, target, zone, notes);   // 维修工具包按点数用，不是一次一个
  if (bagCount(itemId) < 1) { notes.push(`没有${spec.name}。`); return notes; }
  // 投掷类道具（手榴弹、酸液瓶、冲击炸弹）：危墙 / 关着的门倒塌 / 打开之前影响不到对面，扔过去没用，道具不用掉
  if (spec.target === "zone" && typeof lineBlocked === "function") {
    const z = zone != null ? Number(zone) : Number((target && target.zone) || actor.zone);
    const block = lineBlocked(actor.zone, z);
    if (block) { notes.push(`${actor.name} 的${spec.name}影响不到 ${z} 区：${block}`); return notes; }
  }
  bagAdd(itemId, -1, notes);
  if (itemId === "medkit" || itemId === "clinic") {
    const t = target || actor;
    const n = itemId === "clinic" ? 2 : 1;
    const r = takeDice(n, 4, 6);
    // 和其他治疗一样从内往外补，可以治到外层（作者定）
    const got = typeof healUnit === "function" ? healUnit(t, r.total) : r.total;
    notes.push(`${actor.name} 对 ${t.name} 使用${spec.name}，掷出 ${r.text}，实际恢复 ${Math.floor(got || 0)}` +
      (t.dying ? "（濒死不能靠治疗恢复）" : t.upOnShp ? "（起身中，治疗不回坚毅生命）" : "") + "。");
  } else if (itemId === "stim") {
    const got = typeof healUnit === "function" ? healUnit(actor, 16) : 16;
    const lost = selfShpCost(actor, 6);
    notes.push(`${actor.name} 使用强心注射剂：恢复 ${Math.floor(got || 0)} 生命，坚毅 −${lost}${lost < 6 ? "（自己扣坚毅的道具不会致死，至少留 1）" : ""}。`);
  } else if (itemId === "steroid") {
    actor.atk = (Number(actor.atk) || 0) + 3;
    actor.itemAtkBonus = (Number(actor.itemAtkBonus) || 0) + 3;
    const lost = selfShpCost(actor, 6);
    notes.push(`${actor.name} 使用强化注射剂：ATK +3 至战斗结束，坚毅 −${lost}${lost < 6 ? "（自己扣坚毅的道具不会致死，至少留 1）" : ""}。`);
  } else if (itemId === "bomb_e" || itemId === "bomb_a" || itemId === "shockbomb") {
    const z = zone != null ? Number(zone) : Number((target && target.zone) || actor.zone);
    const units = (typeof fieldUnits === "function" ? fieldUnits() : state.units).filter(u =>
      Number(u.zone) === z && !u.dead && !u.hidden && !u.fused
    );
    notes.push(`${actor.name} 向 ${z} 区投出${spec.name}。`);
    // 范围攻击：这个区的按钮 / 拉杆触发一次（区里没人也会炸到）
    if (typeof markAoeZone === "function") {
      state.aoePulse = {};
      // 区里没人也会炸到配置物（震荡弹只有击破，打不动配置物）
      markAoeZone(z, itemId === "shockbomb" ? null : { element: itemId === "bomb_e" ? "electric" : "acid", dmg: 9, attacker: actor });
    }
    units.forEach(u => {
      // 被铁壁 / 废铁墙这类屏障保护的单位不受范围攻击（屏障在配置物那一轮挨打）
      if (itemId === "shockbomb" && typeof aoeShieldFor === "function" && aoeShieldFor(u)) {
        notes.push(`${u.name} 被${aoeShieldFor(u).name}护住，没受影响。`);
        return;
      }
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
