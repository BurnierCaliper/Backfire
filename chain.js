/* 连续战斗与援军（规则，不碰网页）
 *
 * 遭遇（run.js 的遭遇格式 / 战斗模板转出来的）可以多带两样东西：
 *   waves：援军 [{ turns: 3, enemies: [{ preset, level, zone, count }] }]
 *          这一场开始后第 turns 个回合开始时抵达，进入写好的区域。
 *          抵达之前场上的敌人就全死了：援军在下一回合开始时抵达（不用干等）；
 *          写了 cancelOnClear 的援军例外：场上全灭就算战斗结束，它不来了（亡命之王的狂徒援军）。
 *   stages：后面接着打的场次 [遭遇, 遭遇, …]（第一场就是遭遇本身）
 *          这一场的敌人（含援军）全部打完，不结束战斗，而是前往下一个区域：
 *          换上下一场的区、棋盘、场地、间隙、配置物和敌人。仍是同一场战斗：
 *          天气、回合数、角色的血量 / 资源 / 状态、评分都接着算，什么都不重置。
 *
 * 状态：state.chain = { stages, index, level, partyN, waveTotal } | null；state.waves = [{ no, at, enemies, done }]
 * 评分：基准分本来就是把出现过的每个敌人加起来（app.js · scorePar）；
 *       固定分数线每多一波援军、每多一场连续战斗 ×1.2（fixedMult，app.js · gradeLines 用）。
 */
const Chain = (function () {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const RATE = 1.2;
  const foes = () => (typeof EnemyAI !== "undefined" && EnemyAI.foes ? EnemyAI.foes()
    : (state.units || []).filter(u => !u.isPlayer && !u.dead && !u._removed && !u.hidden && u.kit !== "ironwall"));

  function wavesOf(enc, base) {
    return (Array.isArray(enc && enc.waves) ? enc.waves : []).filter(w => w && Array.isArray(w.enemies) && w.enemies.length)
      .map((w, i) => ({ no: i + 1, at: base + Math.max(1, Math.floor(Number(w.turns) || 1)), enemies: clone(w.enemies), done: false, cancelOnClear: !!w.cancelOnClear }));
  }
  const waveCount = (enc) => (Array.isArray(enc && enc.waves) ? enc.waves.filter(w => w && Array.isArray(w.enemies) && w.enemies.length).length : 0);

  /** 开战布置完之后调用（battle-commands.js · setup、sim.js · setup） */
  function init(enc, level, partyN) {
    state.chain = null;
    state.waves = [];
    if (!enc) return;
    const stages = Array.isArray(enc.stages) ? enc.stages.filter(Boolean) : [];
    const first = clone(enc); delete first.stages;
    const all = [first].concat(stages.map(clone));
    const waveTotal = all.reduce((s, e) => s + waveCount(e), 0);
    if (all.length > 1 || waveTotal) state.chain = { stages: all, index: 0, level: Number(level) || 1, partyN: Number(partyN) || 2, waveTotal };
    state.waves = wavesOf(first, Number(state.turnNo) || 1);
  }
  function clear() { state.chain = null; state.waves = []; }

  function partyN() { return (state.chain && state.chain.partyN) || (typeof liveHeroCount === "function" ? liveHeroCount() : 2) || 2; }
  function level() { return (state.chain && state.chain.level) || 1; }
  function zonesText(rows) { return [...new Set((rows || []).map(r => Number(r.zone) || 2))].sort().map(z => z + " 区").join("、"); }
  function spawnWave(w, notes) {
    w.done = true;
    const made = typeof spawnEncounterRows === "function" ? spawnEncounterRows(w.enemies, level(), partyN()) : [];
    if (made.length) notes.push(`援军抵达（第 ${w.no} 波）：${made.map(u => u.name).join("、")} 进入 ${zonesText(w.enemies)}。`);
    return made;
  }
  /** 回合开始（app.js · beginRound）：到时候的援军进场 */
  function roundStart(notes) {
    notes = notes || [];
    const t = Number(state.turnNo) || 1;
    (state.waves || []).filter(w => !w.done && w.at <= t).forEach(w => spawnWave(w, notes));
    return notes;
  }
  const pending = () => (state.waves || []).filter(w => !w.done);
  const hasNext = () => !!(state.chain && state.chain.index < state.chain.stages.length - 1);
  /** 场上的敌人打完了：还有援军 → 援军改成下一回合抵达；还有下一场 → 前往下一个区域。返回 true = 战斗继续 */
  function onCleared(notes) {
    notes = notes || [];
    if (foes().length) return true;
    // 战斗已经结束才赶到的援军：不来了
    const late = pending().filter(w => w.cancelOnClear);
    if (late.length) { late.forEach(w => { w.done = true; w.cancelled = true; }); notes.push(`战斗已经结束，${late.length} 波援军不会再赶来了。`); }
    const left = pending();
    if (left.length) {
      const next = left.reduce((a, w) => (w.at < a.at ? w : a), left[0]);
      const t = (Number(state.turnNo) || 1) + 1;
      if (next.at > t) { next.at = t; notes.push(`敌人全灭：第 ${next.no} 波援军提前，下一回合抵达。`); }
      return true;
    }
    if (hasNext()) { advance(notes); return true; }
    return false;
  }
  /** 前往下一个区域：换场地和敌人，我方原样带过去 */
  function advance(notes) {
    notes = notes || [];
    const c = state.chain;
    c.index += 1;
    const enc = clone(c.stages[c.index]);
    if (typeof applyEncounterLayout === "function") applyEncounterLayout(enc);
    // 天气、回合、相位等这场战斗的东西不变；敌方单位、配置物、地面效果换成新区域的
    const keep = { weather: state.weather, weatherBy: state.weatherBy, sandDir: state.sandDir, weatherLock: state.weatherLock, phaseStep: state.phaseStep };
    state.units = (state.units || []).filter(u => u.isPlayer);
    state.props = [];
    if (typeof buildEncounterField === "function") buildEncounterField(enc);
    Object.assign(state, keep);
    const zone = Number(enc.playerZone) || (state.board && state.board.playerZone) || 1;
    state.units.forEach(u => { if (!u.hidden) u.zone = zone; });
    const made = typeof spawnEncounterRows === "function" ? spawnEncounterRows(enc.enemies, c.level, partyN()) : [];
    if (typeof applyBattlefieldFeatures === "function") applyBattlefieldFeatures(enc.features, c.level);
    state.waves = wavesOf(enc, Number(state.turnNo) || 1);
    state.blockQueue = []; state.assistQueue = [];
    notes.push(`第 ${c.index} 场打完，前往下一个区域${enc.name ? "「" + enc.name + "」" : ""}（第 ${c.index + 1} / ${c.stages.length} 场）：${made.map(u => u.name).join("、") || "暂时没有敌人"}。`);
    return made;
  }
  /** 固定分数线的倍率：每一波援军、每多一场连续战斗 ×1.2 */
  function fixedMult() {
    const c = state.chain;
    if (!c) return 1;
    return Math.pow(RATE, Math.max(0, c.stages.length - 1) + (Number(c.waveTotal) || 0));
  }
  /** 画面用：第几场 / 共几场；还没到的援军各还有几回合、进哪个区 */
  function status() {
    const c = state.chain, t = Number(state.turnNo) || 1;
    return {
      total: c ? c.stages.length : 1, index: c ? c.index : 0,
      names: c ? c.stages.map((s, i) => s.name || `第 ${i + 1} 场`) : [],
      waves: pending().map(w => ({ no: w.no, in: Math.max(0, w.at - t), zones: zonesText(w.enemies), count: w.enemies.reduce((s, r) => s + Math.max(1, Number(r.count) || 1), 0) }))
    };
  }
  /** 画面顶上的一条：●···●···○ 第几场 / 共几场（打完的金色、还没打的蓝色，和路线图一样），加上援军倒计时。
   *  st：status() 的结果（联机玩家用收到的那份）。只有一场又没有援军时返回空串 */
  const GOLD = "#f2c230", BLUE = "#4aa3ff";
  function barHtml(st) {
    if (!st) return "";
    const total = Math.max(1, Number(st.total) || 1), idx = Math.max(0, Math.min(total - 1, Number(st.index) || 0));
    const waves = Array.isArray(st.waves) ? st.waves : [];
    if (total <= 1 && !waves.length) return "";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const names = Array.isArray(st.names) ? st.names : [];
    let dots = "";
    if (total > 1) {
      for (let i = 0; i < total; i++) {
        const done = i < idx, cur = i === idx;
        const color = done ? GOLD : BLUE;
        if (i) dots += `<i class="ch-link" style="display:inline-block;width:18px;border-top:3px dotted ${i <= idx ? GOLD : BLUE};vertical-align:middle;margin:0 2px"></i>`;
        dots += `<b class="ch-dot${done ? " done" : ""}${cur ? " cur" : ""}" title="${esc(names[i] || "第 " + (i + 1) + " 场")}${done ? "（已打完）" : cur ? "（正在打）" : ""}" style="display:inline-block;width:${cur ? 14 : 10}px;height:${cur ? 14 : 10}px;border-radius:50%;vertical-align:middle;background:${cur ? BLUE : color};${cur ? `box-shadow:0 0 0 2px ${GOLD}` : ""}"></b>`;
      }
      dots = `<span class="ch-dots" aria-label="连续战斗 第 ${idx + 1} 场，共 ${total} 场">${dots}</span><span class="ch-label" style="margin-left:6px">第 ${idx + 1} / ${total} 场</span>`;
    }
    const w = waves.map(x => `<span class="ch-wave" style="margin-left:10px;color:${x.in <= 1 ? "#ff7a2e" : "inherit"}">援军 ${x.count} 个 · ${x.in <= 0 ? "本回合" : x.in === 1 ? "下回合" : x.in + " 回合后"}抵达 ${esc(x.zones)}</span>`).join("");
    return `<span class="ch-bar" style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:2px">${dots}${w}</span>`;
  }
  return { init, clear, roundStart, onCleared, advance, fixedMult, status, barHtml, RATE };
})();
if (typeof window !== "undefined") window.Chain = Chain;
