/* 克制表（战斗中随时可看，跟着当前天气变）：纯数据，不画界面。
 * 规则全部调用 engine.js 的原函数（chartMod 克制表格子、meltArmorMod 熔融装甲、weatherDamagePct 天气按属性的伤害修正），这里不另抄一份数值。
 *
 *   matchupChart(weather, opt) → { weather, weatherName, envX, phaseStep, field,
 *     cols: [{ id, name }]（血量层）, rows: [{ id, name, pct, pctBase, pctReason }]（属性）,
 *     cells[行][列]: { row, col, base, value, kind, kindId, baseKind, changed, reason },
 *     changed: [{ row, col }], notes: [文字] }
 *   opt: { envX（恶劣环境 / 末日倍率，默认 1）, field（{ ice: true } 冻土）, phaseStep（相位 0 波谷 / 1 / 2 波峰） }
 *   matchupForState(st, unitId) → 按战场现状（天气、恶劣环境、单位所在区的冻土、相位）算好的 matchupChart，附 { opt, unitId, unitName, zone }；
 *     phaseStep 只在相位天气时有值，field 是 { ice: true } 或 null
 */
const MATCHUP_WEATHER_NAME = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };
const MATCHUP_ELEMENTS = ["fire", "acid", "electric", "ice", "energy", "physical", "harmonic"];
const MATCHUP_LAYERS = ["flesh", "armor", "shield", "sand", "spirit"];
const MATCHUP_KIND_CN = { adv: "克制", dis: "被克制", neu: "普通" };

function matchupPctText(v) {
  const n = Math.round(v * 100);
  return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n) + "%";
}
/** 天气按属性的整行伤害修正说明（engine.js · weatherDamagePct） */
function matchupRowReason(weather, el, pct) {
  if (!pct) return "";
  const W = MATCHUP_WEATHER_NAME[weather] || weather;
  return `${W}：${ELE[el]}伤害 ${matchupPctText(pct)}`;
}
/** 一格为什么变了（按 engine.js · chartMod 的分支顺序：微光反转 → 冻土强制 → 酸雨装甲） */
function matchupCellReason(weather, el, layer, field, base, value) {
  if (field && field.ice && el === "ice") return "冻土：冰易伤不受天气影响";
  if (value === base) return "";
  const out = [];
  if (weather === "glow" && el !== "energy" && base !== 0) out.push("微光：克制关系反转（能量除外）");
  if (weather === "acid" && layer === "armor" && el !== "acid" && el !== "ice") out.push("酸雨：装甲减伤失效（+25%）");
  return out.join("；");
}

/* 雪天霜结 −10%：engine.js · resolveAttack 里是「受击者 t.self === "frost" 且雪天」（作者确认：选中的单位霜结、挨打时才有）。
 * 要改成看攻击方，只改这一个开关。 */
const MATCHUP_SNOW_FROST_SIDE = "defender";
const MATCHUP_GENERIC_STATE = "当前状态：不吃属性克制（克制表全部按 0%）";

/** 这名单位作为受击者时，按属性加算进 pct 的修正：[{ value, reason }]（照 engine.js · resolveAttack 的顺序和数值；都不算无可阻挡） */
function matchupDefenderRow(u, el, weather, envX, fieldT) {
  const out = [];
  const add = (value, reason) => { if (value) out.push({ value, reason }); };
  const r = u.resources || {};
  // 干涉场叠层（站在干涉场里、叠层是这一区叠的才算）
  const interfHere = !!(fieldT && fieldT.harmonic) && (u.interfereZone == null || Number(u.interfereZone) === Number(u.zone));
  if (interfHere) { const d = Math.max(-INTERFERE_CAP, Math.min(INTERFERE_CAP, Number(u.interfere) || 0)); add(d, `干涉场叠层：${matchupPctText(d)}`); }
  if (r.flattened) { const v = -(typeof DESERT !== "undefined" ? DESERT.flattenCut : 0.5); add(v, `摊平：受到伤害 ${matchupPctText(v)}`); }
  if (u.kit === "outlaw_king" && r.hostage) add(0.25, "被挟持：易伤 +25%");
  if (u.self === "burn" && (el === "fire" || el === "ice")) { const st = Math.max(1, Number(u.selfBurnStacks) || 1); add(-0.10 * st, `自焚×${st}：火 / 冰受伤 −${10 * st}%`); }
  if (u.self === "frost") {
    if (["physical", "acid", "energy", "harmonic", "ice"].includes(el)) add(-0.25, "霜结：该属性受伤 −25%");
    if (weather === "snow" && MATCHUP_SNOW_FROST_SIDE === "defender") add(-0.10 * envX, `雪天霜结：全属性再 −${10 * envX}%`);
  }
  if (u.self === "splash" && (el === "acid" || el === "fire")) add(-0.25, "溅射：酸 / 火受伤 −25%");
  if (el === "energy" && u.kit && u.isPlayer && !u.weaponOf && typeof heroProfile === "function" && (heroProfile(u.kit) || {}).race === "兽人-蜥蜴") add(0.25, "鳞片（兽人-蜥蜴）：能量受伤 +25%");
  if (typeof raceDefendMods === "function") raceDefendMods(u, el).forEach(m => add(m.value, m.reason.replace(/。$/, "")));   // 敌人的种族被动：热耐性、鳞片
  if (u.self === "store" && el === "harmonic") add(0.25, "蓄能：谐波受伤 +25%");
  (u.etchMarks || []).forEach(m => { if (m && m.element === el) { const v = Number(m.pct) || 0.1; add(v, `蚀刻残留：${ELE[el]} +${Math.round(v * 100)}%，并视为被克制`); } });
  if (r.rallyDr && !(u.stunned || u.dying)) add(-0.15, "全队集结（坦克）：全属性减伤 −15%");
  if (typeof frenzyTakenCut === "function") { const v = frenzyTakenCut(u); if (v) add(-v, `狂暴：受到的伤害 −${Math.round(v * 100)}%`); }   // effects.js · FRENZY
  if (u.instant && u.instant.iceNext) add(0.5, "冰冻：下一次被攻击的第一击 +50%");
  return out;
}

function matchupChart(weather, opt) {
  opt = opt || {};
  weather = MATCHUP_WEATHER_NAME[weather] ? weather : "none";
  const envX = Math.max(1, Number(opt.envX) || 1);
  const field = opt.field && opt.field.ice ? Object.assign({ ice: true }, opt.field) : null;
  // opt.defender：选中的单位（作为受击者）。没有就是通用表
  const D = opt.defender && typeof opt.defender === "object" ? opt.defender : null;
  const onShp = !!(D && (D.chartOff || (D.upOnShp && D.isPlayer)));
  const melt = !!(D && D.instant && D.instant.melt);
  const fieldForChart = D && D.flying ? null : field;
  const phaseStep = opt.phaseStep == null ? null : Number(opt.phaseStep);
  const cols = MATCHUP_LAYERS.map(id => ({ id, name: LAYER[id] }));
  // 相位波峰 / 波谷（engine.js · resolveAttack 里 weather === "phase" 的两段）：全属性 ±50% × envX，和克制、天气修正一起加算（不连乘）
  const phasePct = weather === "phase" ? (phaseStep === 2 ? 0.5 * envX : phaseStep === 0 ? -0.5 * envX : 0) : 0;
  const phaseReason = phasePct ? `${phaseStep === 2 ? "相位波峰" : "相位波谷"}：全属性 ${matchupPctText(phasePct)}` : "";
  const rows = MATCHUP_ELEMENTS.map(id => {
    const wp = (weatherDamagePct(weather, id) || 0) * envX;
    const effects = D ? matchupDefenderRow(D, id, weather, envX, D.flying ? null : (opt.defenderField || field)) : [];
    const pct = wp + phasePct + effects.reduce((a, e) => a + e.value, 0);
    const row = { id, name: ELE[id], pct, pctBase: 0, pctReason: [matchupRowReason(weather, id, wp), phaseReason].concat(effects.map(e => e.reason)).filter(Boolean).join("；") };
    if (D) {
      row.effects = effects;
      // 冰打熔融：每一段 ×2（另外相乘，不在 pct 里）
      if (melt && id === "ice") { row.mult = 2; row.multReason = "熔融：冰属性攻击伤害 ×2、击破 +1（结算完熔融结束）"; }
    }
    return row;
  });
  const changed = [];
  const cells = MATCHUP_ELEMENTS.map(el => MATCHUP_LAYERS.map(layer => {
    const base = chartMod(el, layer, "none", null, false, 1);
    let value = chartMod(el, layer, weather, fieldForChart, weather === "acid", envX) + 0;   // +0：微光把 0 反转成 −0
    const unitWhy = [];
    if (onShp) { value = 0; unitWhy.push(MATCHUP_GENERIC_STATE); }
    else if (D) {
      // 熔融装甲（engine.js · meltArmorMod）：强制 +50%，微光照样反转成 −50%（原因里接着写「微光：克制关系反转」）
      if (melt && layer === "armor" && el === "physical") { value = meltArmorMod(weather); unitWhy.push(`熔融装甲：物理打装甲强制 ${matchupPctText(MELT_ARMOR_PHYSICAL)}`); }
      // 愿你无恙（mods.js · bpChartCap）：快照里带好上限 weaknessCap；直接传真单位时照原函数算
      const cap = D.weaknessCap != null ? (value > D.weaknessCap ? D.weaknessCap : value) : (typeof bpChartCap === "function" ? bpChartCap(D, value) : value);
      if (cap !== value) { unitWhy.push(`愿你无恙：克制加成最多 ${matchupPctText(cap)}`); value = cap; }
      if (D.flying && field && el === "ice") unitWhy.push("飞行：不吃冻土");
    }
    const etch = !onShp && D && (D.etchMarks || []).some(m => m && m.element === el);
    const kindId = etch ? "adv" : matchupKind(value), baseKindId = matchupKind(base);
    const isChanged = Math.abs(value - base) > 1e-9 || kindId !== baseKindId;
    let reason = (isChanged || (fieldForChart && el === "ice")) && !onShp ? matchupCellReason(weather, el, layer, fieldForChart, base, value) : "";
    if (unitWhy.length) reason = unitWhy.concat(reason && !onShp ? [reason] : []).join("；");
    if (etch) reason = [reason, "蚀刻残留：视为被克制"].filter(Boolean).join("；");
    if (isChanged) changed.push({ row: el, col: layer });
    return { row: el, col: layer, base, value, kind: MATCHUP_KIND_CN[kindId], kindId, baseKind: MATCHUP_KIND_CN[baseKindId], changed: isChanged, reason };
  }));
  const notes = [];
  const x = envX > 1 ? `（恶劣环境 / 末日 ×${envX}）` : "";
  if (weather === "snow" && !D) notes.push(`雪天：目标霜结时全属性再 −${10 * envX}%${x}`);
  if (weather === "glow") notes.push(`微光：击破 −${envX}（不会减到 0）${x}`);
  if (weather === "phase") {
    if (phaseStep === 0) notes.push(`相位波谷：伤害 −${50 * envX}%，击破 −${envX}${x}`);
    else if (phaseStep === 2) notes.push(`相位波峰：伤害 +${50 * envX}%，击破 +${envX}${x}`);
    else notes.push("相位：平稳期，没有额外修正");
  }
  if (field) notes.push("冻土：冰属性对这一区的目标固定易伤（飞行单位不吃）");
  if (melt && !onShp) notes.push("熔融：冰属性攻击伤害 ×2、击破 +1");
  if (envX > 1 && weather !== "none") notes.push(`恶劣环境 / 末日：天气效果 ×${envX}`);
  const out = { weather, weatherName: MATCHUP_WEATHER_NAME[weather], envX, phaseStep, field, cols, rows, cells, changed, notes };
  if (D) out.defender = true;
  return out;
}

/** 冻土在哪几区：[区号]（升序） */
function matchupIceZones(fields) {
  return Object.keys(fields || {}).filter(z => fields[z] && fields[z].ice).map(Number).sort((a, b) => a - b);
}
const matchupZoneLabel = zs => (zs.length ? `冻土：${zs.map(z => z + "区").join("、")}` : "");
/** 单位快照里只留克制表要用的字段（不带血量、坚毅数值） */
function matchupDefenderOf(u) {
  const pick = ["id", "kit", "name", "zone", "isPlayer", "weaponOf", "flying", "self", "selfBurnStacks", "etchMarks", "interfere", "interfereZone", "stunned", "dying", "harshEnv", "shelterTurn", "isolate"];
  const d = {};
  pick.forEach(k => { if (u[k] !== undefined) d[k] = u[k]; });
  // 起身状态（坚毅生命）：只记「不吃克制」，不带坚毅相关字段
  if (u.upOnShp && u.isPlayer) d.chartOff = true;
  d.resources = { flattened: !!(u.resources && u.resources.flattened), hostage: !!(u.resources && u.resources.hostage), rallyDr: !!(u.resources && u.resources.rallyDr) };
  d.instant = { melt: !!(u.instant && u.instant.melt), iceNext: !!(u.instant && u.instant.iceNext) };
  return d;
}

/** 按战场现状算：st = state（天气、fields、apocalypse、phaseStep），unitId = 选中的单位。
 *  有单位时：这名单位所在区的天气 / 冻土 / 恶劣环境，并（默认）按它作为受击者叠加个体效果；opt.defender === false 只看环境（兼容旧行为）。
 *  返回 matchupChart 的结果，另附 { opt, unitId, unitName, zone, iceZones, iceLabel } */
function matchupForState(st, unitId, o) {
  st = st || {};
  o = o || {};
  const u = unitId ? (st.units || []).find(x => x && x.id === unitId) : null;
  const fields = st.fields || {};
  const exempt = u && (u.shelterTurn || u.isolate);
  const zf = u ? fields[u.zone] || {} : {};
  const weather = exempt || zf.isolate ? "none" : (st.weather || "none");
  const envX = (st.apocalypse ? 2 : 1) * (u && u.harshEnv ? 2 : 1);
  const opt = { envX, phaseStep: weather === "phase" ? Number(st.phaseStep) || 0 : null };
  // 冻土：跟着单位所在区（飞行的单位不吃：不给 field；全场哪几区有冻土看 iceZones）
  if (u && !exempt && zf.ice && !u.flying) opt.field = { ice: true, zone: u.zone, label: matchupZoneLabel([u.zone]) };
  if (u && o.defender !== false) {
    const d = matchupDefenderOf(u);
    // 愿你无恙：用真单位求上限（bpChartCap 读改装数据），写进快照
    if (typeof bpChartCap === "function") { const cap = bpChartCap(u, 9); if (cap !== 9) d.weaknessCap = cap; }
    opt.defender = d;
    opt.defenderField = exempt ? {} : zf;
  }
  const iceZones = matchupIceZones(fields);
  return Object.assign(matchupChart(weather, opt), { opt, unitId: u ? u.id : null, unitName: u ? String(u.name || u.kit || u.id) : null, zone: u ? u.zone : null,
    iceZones, iceLabel: matchupZoneLabel(iceZones) });
}

/** 联机：给每个看得见的单位各算一份（作为受击者），按 unitId → 图表；去掉了血量和坚毅数值 */
function matchupUnitCharts(st) {
  const out = {};
  ((st && st.units) || []).filter(u => u && !u.dead && !u.hidden && u.id).forEach(u => { out[u.id] = matchupForState(st, u.id); });
  return out;
}
