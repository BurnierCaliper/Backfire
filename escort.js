/* Antlerscale: Backfire · 护送任务的「护送对象」
 *
 * 护送对象是我方单位，但玩家不能操作：
 *   货车 cart   不行动、不会失衡（没有架势），只是挨打
 *   人物 vip    每个敌人回合开始前自己行动：同区有敌人就往敌人少的相邻区躲；有攻击力就打一下射程内血最少的敌人
 * 规则上按「武器人形态」处理（isWeaponUnit 为真）：血量归零直接被摧毁、不进濒死，也不算进「全员倒地」判负。
 * 敌人按原来的目标逻辑打（不特别优先它）。被摧毁 = 护送失败；完好（剩余血量 ≥ ESCORT_RULES.intactRatio）有额外奖励。
 * 血量跨同一个任务的所有战斗保留（单局：run.task.escort.hp；跑团：任务里的 escort.hp）。
 *
 * 数值先按手感定（之后再调）：
 *   货车：装甲 20 + 6×等级；人物：肉体 12 + 3×等级，架势 3，atk 3 + 等级，射程任意，物理。 */
"use strict";

const ESCORT_KINDS = {
  cart: { name: "货车", note: "不行动、不会失衡，只是挨打", layer: "armor", hp: [20, 6], def: 0, atk: [0, 0], noPosture: true, moves: false },
  vip:  { name: "委托人", note: "敌人回合前会躲开有敌人的区域，能用手枪还击", layer: "flesh", hp: [12, 3], def: 3, atk: [3, 1], range: "any", element: "physical", moves: true }
};
const ESCORT_RULES = {
  intactRatio: 0.75,   // 完成时剩余血量比例 ≥ 这个值 = 完好
  intactBonus: 0.5     // 完好：报酬奎支额外 +50%
};

/** 护送对象的配置：{ kind, name, hp, def, atk }（hp / def / atk 不写就按等级算） */
function escortSpec(cfg, level) {
  cfg = cfg || {};
  const K = ESCORT_KINDS[cfg.kind] || ESCORT_KINDS.cart;
  const lv = Math.max(1, Number(level) || 1);
  const num = (v, d) => (v != null && v !== "" && isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : d);
  return {
    kind: ESCORT_KINDS[cfg.kind] ? cfg.kind : "cart",
    name: cfg.name || K.name,
    layer: K.layer,
    hpMax: Math.max(1, num(cfg.hp, K.hp[0] + K.hp[1] * lv)),
    def: num(cfg.def, K.def),
    atk: num(cfg.atk, K.atk[0] + K.atk[1] * lv),
    range: K.range || "melee",
    element: K.element || "physical",
    moves: !!K.moves,
    noPosture: !!K.noPosture
  };
}

function isEscortUnit(u) { return !!(u && u.escort); }

/** 放一个护送对象到场上。saved：之前战斗剩下的血量（null = 满血） */
function spawnEscort(cfg, level, saved, zone) {
  const sp = escortSpec(cfg, level);
  const hp = saved != null ? Math.max(0, Math.min(sp.hpMax, Number(saved) || 0)) : sp.hpMax;
  const u = unitOf(sp.name, Math.max(1, Number(level) || 1), [{ type: sp.layer, hp: sp.hpMax }], sp.def, sp.atk, {
    isPlayer: true, kit: "escort_" + sp.kind, range: sp.range, element: sp.element, ap: 0, apMax: 0, bonus: 0, bonusMax: 0
  });
  u.kit = "escort_" + sp.kind;
  u.escort = sp.kind;
  u.personalAtk = sp.atk;
  u.layers[0].current = hp;
  if (sp.noPosture) { u.noPosture = true; u.def = 0; u.defMax = 0; }
  const heroZone = (state.units || []).find(x => x.isPlayer && !x.hidden && !x.escort);
  u.zone = zone != null ? Number(zone) : (heroZone ? Number(heroZone.zone) : 1);
  u.shp = 0; u.shpMax = 0;
  u._xpGiven = true;
  state.units.push(u);
  return u;
}
function fieldEscort() { return (state.units || []).find(u => u.escort && !u._removed) || null; }
/** 战斗结束时护送对象的情况：{ hp, max, destroyed }，场上没有就是 null */
function escortStatus() {
  const u = fieldEscort();
  if (!u) return null;
  const l = u.layers[0] || { current: 0, max: 1 };
  const hp = Math.max(0, Number(l.current) || 0);
  return { hp, max: Number(l.max) || 1, destroyed: !!u.dead || hp <= 0 };
}
function escortIntact(hp, max) { return max > 0 && hp / max >= ESCORT_RULES.intactRatio; }

/* ---------- 人物自己的行动（敌人回合开始前） ---------- */
function escortAct(notes) {
  (state.units || []).filter(u => u.escort && !u.dead && !u.hidden && !u._removed).forEach(u => {
    if (!ESCORT_KINDS[u.escort] || !ESCORT_KINDS[u.escort].moves) return;
    if (u.stunned) { notes.push(`${u.name} 失衡，这回合没法行动。`); return; }
    const foes = (state.units || []).filter(e => !e.isPlayer && !e.dead && !e.hidden && !e._removed && e.kit !== "ironwall" && !e.untargetable);
    const count = (z) => foes.filter(e => Number(e.zone) === Number(z)).length;
    const maxZ = Number(state.zoneMode) || 2;
    const from = Number(u.zone);
    if (count(from) > 0) {
      const opts = [from - 1, from + 1].filter(z => z >= 1 && z <= maxZ)
        .filter(z => !(state.fields[z] && state.fields[z].abyss) && !(state.fields[from] && state.fields[from].abyss))
        .filter(z => { const g = typeof getGap === "function" ? getGap(from, z) : { type: "none" }; return g.type !== "wall" && !(g.type === "door" && !g.open) && !(g.type === "void" && !u.flying); })
        .sort((a, b) => count(a) - count(b));
      if (opts.length && count(opts[0]) < count(from)) {
        if (typeof doMove === "function") doMove(u, opts[0], { free: true });
        else u.zone = opts[0];
        notes.push(`${u.name} 躲开敌人，移动到 ${u.zone} 区。`);
      } else {
        notes.push(`${u.name} 想躲开敌人，但没有更安全的地方。`);
      }
    }
    if ((Number(u.atk) || 0) <= 0 || typeof dealTo !== "function") return;
    const reach = foes.filter(e => !e.dead && (u.range === "any" || zoneDist(u.zone, e.zone, state.zoneMode) === 0));
    if (!reach.length) return;
    const hpOf = (e) => (e.layers || []).reduce((s, l) => s + (Number(l.current) || 0), 0);
    const t = reach.sort((a, b) => hpOf(a) - hpOf(b))[0];
    const r = dealTo(u, t, { atk: u.atk, mult: 1, element: u.suggest.element, baseBreak: 1, atkRange: u.range,
      flags: { action: true, blockResolved: true, block: "none" } });
    const res = (r && r.res) || {};
    notes.push(`${u.name} 还击 ${t.name}：${Math.floor(Number(res.total) || 0)} 伤害。`);
  });
}
