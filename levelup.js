/* 升级提示（所有模式共用，不碰网页）：角色升级、武器升级时，比一比「升级前会什么」和「升级后会什么」，
 * 记成一条升级事件：数值变化、新技能（带完整说明）、被动升级、武器的新技能 / 改装槽、待选的奖励。
 * 画面在 levelup-ui.js（单机、跑团、单局、房主）和 online-ui.js（联机玩家只看自己的角色）。
 *
 *   LevelUp.snapshot(unit)            这名角色此刻的能力（不改动 unit）
 *   LevelUp.note(kind, unit, before, extra)   和 before 比，有变化就记一条事件
 *   LevelUp.unseen() / markSeen(id)   没看过的事件 / 看过了
 *   LevelUp.amend(kit, lines)         给这名角色最近一条没看过的事件补几行「待选」（单局升级后的选择）
 */
const LevelUp = (function () {
  "use strict";
  const MAX = 60;
  let events = [], seq = 0, muted = 0;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const inSim = () => typeof GAME !== "undefined" && GAME && GAME.sim;

  function skillMap(u) {
    const out = {};
    let list = [];
    try { list = (typeof skillList === "function" ? skillList(u) : []) || []; } catch (e) { list = []; }
    list.forEach(s => { if (s && s.id && !out[s.id]) out[s.id] = { id: s.id, name: s.name, hint: s.hint || "" }; });
    return out;
  }
  const totalMax = (u) => (u.layers || []).reduce((s, l) => s + (Number(l.max) || 0), 0);
  /** 这名角色此刻的能力；u 不会被改动（在副本上按等级重算） */
  function snapshot(u) {
    if (!u || !u.kit) return null;
    const c = clone(u);
    c.resources = Object.assign({}, c.resources || {});
    try { if (typeof applyLevelStats === "function") applyLevelStats(c); } catch (e) { /* 老卡没有属性 */ }
    let passives = [];
    try { passives = typeof SkillText !== "undefined" ? SkillText.passivesOf(c) : []; } catch (e) { passives = []; }
    const kits = (c.linkedKits && c.linkedKits.length) ? c.linkedKits : (typeof defaultLinkedKits === "function" ? defaultLinkedKits(c.kit) : []);
    const weapons = {};
    kits.forEach(k => {
      const lv = Number((c.weaponLevels || {})[k]) || 1;
      const rlv = typeof weaponRewardLevel === "function" ? weaponRewardLevel(c, k) : lv;
      const probe = { kit: k, level: lv, isPlayer: true, weaponOf: c.kit, weaponUnit: true, resources: {}, statuses: {} };
      weapons[k] = { kit: k, name: typeof weaponName === "function" ? weaponName(k) : k, level: lv,
        slots: typeof weaponPartSlots === "function" ? weaponPartSlots(rlv) : 0, skills: skillMap(probe) };
    });
    return {
      kit: c.kit, name: c.name || c.kit, level: Number(c.level) || 1,
      stats: { hp: totalMax(c), atk: Number(c.atk) || 0, def: Number(c.defMax != null ? c.defMax : c.def) || 0, shp: Number(c.shpMax) || 0 },
      attrPoints: Number(c.attrPoints) || 0,
      skills: skillMap(c), passives: passives.map(p => ({ name: p.name, text: p.text, plus: !!p.plus })), weapons
    };
  }
  function skillRow(s) {
    const text = typeof SkillText !== "undefined" ? SkillText.skillText(s.id) : null;
    const cost = typeof SkillText !== "undefined" ? SkillText.skillCostText(s.id) : "";
    return { name: s.name, cost, text: text || s.hint || "" };
  }
  const STAT = [["hp", "生命上限"], ["atk", "ATK"], ["def", "架势上限"], ["shp", "坚毅生命上限"]];
  /** 两次快照之间多了什么 */
  function diff(a, b) {
    if (!a || !b) return null;
    const stats = STAT.filter(([k]) => Math.round(a.stats[k]) !== Math.round(b.stats[k]))
      .map(([key, label]) => ({ key, label, from: Math.round(a.stats[key]), to: Math.round(b.stats[key]) }));
    const skills = Object.keys(b.skills).filter(id => !a.skills[id]).map(id => skillRow(b.skills[id]));
    const passives = b.passives.map((p, i) => {
      const old = a.passives[i];
      if (!old) return { name: p.name, text: p.text, kind: "new" };
      if (p.plus && !old.plus) return { name: p.name, text: p.text, kind: "plus" };
      return null;
    }).filter(Boolean);
    const weapons = Object.keys(b.weapons).map(k => {
      const wa = a.weapons[k] || { level: 0, slots: 0, skills: {} }, wb = b.weapons[k];
      const out = { name: wb.name, from: wa.level, to: wb.level, slots: Math.max(0, wb.slots - wa.slots),
        skills: Object.keys(wb.skills).filter(id => !wa.skills[id]).map(id => skillRow(wb.skills[id])) };
      return out.from !== out.to || out.slots || out.skills.length ? out : null;
    }).filter(Boolean);
    const pending = [];
    if (b.attrPoints > a.attrPoints) pending.push(`属性点 +${b.attrPoints - a.attrPoints}（在角色资料里分配）`);
    const empty = !stats.length && !skills.length && !passives.length && !weapons.length && !pending.length && a.level === b.level;
    return empty ? null : { stats, skills, passives, weapons, pending };
  }
  /** kind：level（角色升级）/ weapon（武器升级）；extra：{ weapon: 武器名 } */
  function note(kind, u, before, extra) {
    if (inSim() || muted || !u || !before) return null;
    const after = snapshot(u);
    const d = diff(before, after);
    if (!d) return null;
    extra = extra || {};
    const w = d.weapons[0];
    const title = kind === "weapon" && w ? `${w.name} 升到 ${w.to} 级` : kind === "choice" ? `${after.name} 学会了新能力` : `${after.name} 升到 ${after.level} 级`;
    const ev = Object.assign({ id: "lv" + Date.now().toString(36) + "-" + (++seq), kind, kit: after.kit, name: after.name,
      from: before.level, to: after.level, title, seen: false, at: Date.now() }, d);
    if (extra.weapon && kind === "weapon") ev.title = `${extra.weapon} 升到 ${w ? w.to : "?"} 级`;
    events.push(ev);
    if (events.length > MAX) events = events.slice(-MAX);
    return ev;
  }
  function amend(kit, lines) {
    const ev = events.slice().reverse().find(e => e.kit === kit && !e.seen && e.kind === "level");
    if (!ev || !lines || !lines.length) return false;
    lines.forEach(t => { if (!ev.pending.includes(t)) ev.pending.push(t); });
    return true;
  }
  return {
    snapshot, diff, note, amend,
    /** 布置用的升级（训练场按目标等级直接拉上去）不弹提示 */
    quiet(fn) { muted++; try { return fn(); } finally { muted--; } },
    unseen: () => events.filter(e => !e.seen),
    all: () => events.slice(),
    markSeen(id) { const e = events.find(x => x.id === id); if (e) e.seen = true; return !!e; },
    save: () => clone(events),
    load(arr) { events = Array.isArray(arr) ? clone(arr) : []; },
    clear() { events = []; }
  };
})();
if (typeof window !== "undefined") window.LevelUp = LevelUp;
