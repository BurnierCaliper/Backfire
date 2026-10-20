/* 克制表（战斗中随时可看，跟着当前天气变）：纯数据，不画界面。
 * 规则全部调用 engine.js 的原函数（chartMod 克制表格子、weatherDamagePct 天气按属性的伤害修正），这里不另抄一份数值。
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

function matchupChart(weather, opt) {
  opt = opt || {};
  weather = MATCHUP_WEATHER_NAME[weather] ? weather : "none";
  const envX = Math.max(1, Number(opt.envX) || 1);
  const field = opt.field && opt.field.ice ? { ice: true } : null;
  const phaseStep = opt.phaseStep == null ? null : Number(opt.phaseStep);
  const cols = MATCHUP_LAYERS.map(id => ({ id, name: LAYER[id] }));
  // 相位波峰 / 波谷（engine.js · resolveAttack 里 weather === "phase" 的两段）：全属性 ±50% × envX，和克制、天气修正一起加算（不连乘）
  const phasePct = weather === "phase" ? (phaseStep === 2 ? 0.5 * envX : phaseStep === 0 ? -0.5 * envX : 0) : 0;
  const phaseReason = phasePct ? `${phaseStep === 2 ? "相位波峰" : "相位波谷"}：全属性 ${matchupPctText(phasePct)}` : "";
  const rows = MATCHUP_ELEMENTS.map(id => {
    const wp = (weatherDamagePct(weather, id) || 0) * envX;
    const pct = wp + phasePct;
    return { id, name: ELE[id], pct, pctBase: 0, pctReason: [matchupRowReason(weather, id, wp), phaseReason].filter(Boolean).join("；") };
  });
  const changed = [];
  const cells = MATCHUP_ELEMENTS.map(el => MATCHUP_LAYERS.map(layer => {
    const base = chartMod(el, layer, "none", null, false, 1);
    const value = chartMod(el, layer, weather, field, weather === "acid", envX) + 0;   // +0：微光把 0 反转成 −0
    const kindId = matchupKind(value), baseKindId = matchupKind(base);
    const isChanged = Math.abs(value - base) > 1e-9;
    const reason = isChanged || (field && el === "ice") ? matchupCellReason(weather, el, layer, field, base, value) : "";
    if (isChanged) changed.push({ row: el, col: layer });
    return { row: el, col: layer, base, value, kind: MATCHUP_KIND_CN[kindId], kindId, baseKind: MATCHUP_KIND_CN[baseKindId], changed: isChanged, reason };
  }));
  const notes = [];
  const x = envX > 1 ? `（恶劣环境 / 末日 ×${envX}）` : "";
  if (weather === "snow") notes.push(`雪天：目标霜结时全属性再 −${10 * envX}%${x}`);
  if (weather === "glow") notes.push(`微光：击破 −${envX}（不会减到 0）${x}`);
  if (weather === "phase") {
    if (phaseStep === 0) notes.push(`相位波谷：伤害 −${50 * envX}%，击破 −${envX}${x}`);
    else if (phaseStep === 2) notes.push(`相位波峰：伤害 +${50 * envX}%，击破 +${envX}${x}`);
    else notes.push("相位：平稳期，没有额外修正");
  }
  if (field) notes.push("冻土：冰属性对这一区的目标固定易伤（飞行单位不吃）");
  if (envX > 1 && weather !== "none") notes.push(`恶劣环境 / 末日：天气效果 ×${envX}`);
  return { weather, weatherName: MATCHUP_WEATHER_NAME[weather], envX, phaseStep, field, cols, rows, cells, changed, notes };
}

/** 按战场现状算：st = state（天气、fields、apocalypse、phaseStep），unitId = 当前行动 / 选中的单位（没有就不看冻土、不看个人的恶劣环境）。
 *  返回 matchupChart 的结果，另附 opt（实际用的参数，界面可以改了再调 matchupChart 切换冻土等） */
function matchupForState(st, unitId) {
  st = st || {};
  const u = unitId ? (st.units || []).find(x => x && x.id === unitId) : null;
  const fields = st.fields || {};
  const exempt = u && (u.shelterTurn || u.isolate);
  const zf = u ? fields[u.zone] || {} : {};
  const weather = exempt || zf.isolate ? "none" : (st.weather || "none");
  const envX = (st.apocalypse ? 2 : 1) * (u && u.harshEnv ? 2 : 1);
  const opt = { envX, phaseStep: weather === "phase" ? Number(st.phaseStep) || 0 : null };
  if (u && !exempt && !u.flying && zf.ice) opt.field = { ice: true };
  return Object.assign(matchupChart(weather, opt), { opt, unitId: u ? u.id : null, unitName: u ? String(u.name || u.kit || u.id) : null, zone: u ? u.zone : null });
}
