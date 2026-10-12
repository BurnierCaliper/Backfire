// 理想状态下每个角色（连同武器人）的最优输出循环与 DPT（每回合伤害）。
//
// 场地：两区直排，常态天气，没有场地效果；关闭属性克制表（state.noChart）。
// 目标：一个训练假人——血量和同等级 4 人队伍的精英牛一样，掉到一半以下就补满（伤害照记）；架势极高打不进失衡；
//   不行动（只走回合流转：回合开始 / 结束的结算照常）。
// 角色：走单局的升级流程（主属性加点、第一个合法奖励），武器等级 = clamp(round(等级 × 0.6), 1, 10)，满血，没有义体、不用道具。
// 搜索：束搜索。每一步列出所有合法动作（角色和在场武器人的每个技能 × 每种分步选择 × 每个目标、移动、结束回合），
//   在沙盒里试跑，按「累计伤害」排序；同一种资源状态只留伤害最高的一个，免得束里塞满同一条路的变体、把攒资源的路线挤掉。
//   每个候选在几组不同的骰子（平行世界）下各跑一遍取平均，同一步的所有候选用同一批种子（公平比较）；
//   最后把找到的序列换新的种子重放取平均，作为报告的 DPT（不会比搜索时更「走运」）。
// 只算伤害（假人掉的血）；击破、治疗另算。协助攻击、失衡等要队友触发的收益不算。
// 假人打不碎，所以柯尔特「被摧毁的敌人血量层」的废料按估计注入：每 3 个回合一次 4 人队伍精英牛的护盾层（再按规则封顶）。
//
// 用法：node tools/dpt.js [--kits ruby,kolt] [--levels 1,5,10] [--turns 8] [--beam 40] [--worlds 3] [--seeds 5] [--json out.json]
"use strict";
const H = require("../tests/headless");
const B = require("./balance-common");

const DUMMY_DEF = 1e6;
// 假人血量：同等级 4 人队伍精英「警卫队队长（牛）」的总血量（一层肉体）。掉到一半以下就补满，补之前掉的血记进总伤害。
// 不用「打不死的超大血量」：有按目标生命百分比算的伤害（诺拉的留置针等），超大血量会算出离谱的数字；
// 一直保持在半血以上也不会触发斩杀线之类的低血量效果
const DUMMY_REFILL_AT = 0.5;

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

/** 布置：角色按单局升级流程到 level 级，站 1 区；训练假人在 2 区 */
function setupField(kit, level, seed) {
  const c = H.load(), R = c.Rogue;
  c.S.RNG.install(`dpt:${kit}:${level}:setup`);
  const filler = B.HEROES.find(k => k !== kit);
  const run = R.newRun({ party: [kit, filler], seed: `dpt:${kit}:${level}` });
  run.party.forEach(h => {
    const from = h.level || 1;
    h.level = level; h.xp = 0; h.hp = null; h.shp = null;
    R.queueLevelRewards(h, from, level, [], run);
    Object.keys(h.weaponLevels || {}).forEach(k => { h.weaponLevels[k] = Math.max(1, Math.min(10, Math.round(level * 0.6))); });
  });
  B.chooseLevels(R, run, []);
  run.party.forEach(h => { h.hp = null; h.shp = null; h.weaponState = {}; });
  c.S.LEDGER.dur = {}; c.S.LEDGER.weapons = {}; c.S.LEDGER.heroes = {}; c.S.LEDGER.hours = 0;
  // 借单局的 before（把升级后的角色数据写到场上的单位上）；队伍里只放这一个角色
  run.act = 1; run.actDay = 0; R.makeBoard(run); R.acceptTask(run, "main");
  run.task.nodes[run.task.index] = { type: "battle", done: false };
  const spec = R.battleSpec(run);
  // 布置用固定种子：单位编号每次都一样，重放时记下的动作才对得上；骰子的种子在布置完以后再换
  c.BattleSim.setup({ party: [kit], enemies: [], seed: `dpt:${kit}:${level}:setup`, before: spec.before, zoneMode: 2 });
  const S = c.S.state;
  S.zoneMode = 2; S.weather = "none"; S.noChart = true; S.board = null;
  S.fields = {}; S.gaps = {};
  const dummy = c.spawnEnemyGroup("thug_knife", level, 1, 2)[0];
  dummy.name = "训练假人";
  const hp = c.spawnEnemyGroup("captain_ox", level, 4, 2)[0].layers.reduce((a, l) => a + (Number(l.max) || 0), 0);
  dummy.layers = [{ type: "flesh", current: hp, max: hp }];
  S.dptBank = 0;   // 补血之前假人已经掉的血
  dummy.def = dummy.defMax = DUMMY_DEF;
  dummy.zone = 2;
  S.units.push(dummy);
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  // 柯尔特的废料：训练假人只有一层血、永远打不碎，实战里「被摧毁的敌人血量层」拿不到。
  // 按作者给的估计：每 3 个回合拿到一次精英「警卫队队长（牛）」的护盾层（4 人队伍的数值，再按废料规则封顶）
  if (kit === "kolt") S.dptScrap = { every: 3, type: "shield", lost: c.spawnEnemyGroup("captain_ox", level, 4, 1)[0].layers[0].max };
  c.startCombat();
  c.S.RNG.install(`dpt:${kit}:${level}:${seed}`);
  return { c, S, dummy };
}

const dummyLost = (S) => S.units.filter(u => !u.isPlayer && u.name === "训练假人")
  .reduce((s, u) => s + (u.layers || []).reduce((a, l) => a + Math.max(0, (Number(l.max) || 0) - Math.max(0, Number(l.current) || 0)), 0), 0);
const dummyDamage = (S) => (Number(S.dptBank) || 0) + dummyLost(S);
/** 假人掉到一半以下：补满，掉的血记进总伤害（也会顺手把假人从「倒下」里拉回来） */
function refillDummy(S) {
  S.units.filter(u => !u.isPlayer && u.name === "训练假人").forEach(u => {
    const max = (u.layers || []).reduce((a, l) => a + (Number(l.max) || 0), 0);
    const cur = (u.layers || []).reduce((a, l) => a + Math.max(0, Number(l.current) || 0), 0);
    if (!u.dead && cur >= max * DUMMY_REFILL_AT) return;
    S.dptBank = (Number(S.dptBank) || 0) + (max - cur);
    u.layers.forEach(l => { l.current = l.max; });
    u.dead = false; u.dying = false; u._removed = false; u.hidden = false;
  });
}

/* ---------- 局面存取（state + LEDGER） ---------- */
function snap(c) {
  const S = c.S.state;
  S.logPages = []; S.log = [];
  return { state: structuredClone(S), ledger: c.S.LEDGER.save() };
}
function load(c, s) {
  const S = c.S.state;
  const st = structuredClone(s.state);
  Object.keys(S).forEach(k => { if (!(k in st)) delete S[k]; });
  Object.assign(S, st);
  c.S.LEDGER.load(JSON.parse(JSON.stringify(s.ledger)));
}

/** 用来判断「这一下有没有真的做了什么」以及去重 */
function signature(S) {
  return JSON.stringify(S.units.filter(u => !u._removed).map(u => [u.id, u.zone, u.hidden ? 1 : 0, u.dead ? 1 : 0, u.ap, u.bonus,
    (u.layers || []).map(l => l.current), u.def, u.statuses, u.instant, u.self, u.resources, u.highEnergy, u.focuses]));
}
/** 资源状态（不含伤害）：同一种资源状态只留伤害最高的那个 */
function bucketKey(S) {
  return JSON.stringify(S.units.filter(u => !u._removed).map(u => [u.kit, u.zone, u.hidden ? 1 : 0, u.dead ? 1 : 0,
    u.isPlayer ? [u.ap, u.bonus, u.resources, u.self, u.instant] : [u.statuses, u.instant, u.highEnergy, u.focuses]]))
    + JSON.stringify(S.fields || {}) + JSON.stringify(S.weaponFallen || {});
}

/* ---------- 列出合法动作 ---------- */
function actors(c) {
  return c.S.state.units.filter(u => u.isPlayer && !u.hidden && !u.dead && !u._removed && !u.fused &&
    ((u.ap || 0) > 0 || (u.bonus || 0) > 0) && !u.stunned);
}
function flowPicks(c, id, actor, picks, depth, out) {
  if (out.length > 40) return;
  let steps = [];
  try { steps = c.skillFlowSteps(id, actor, picks) || []; } catch (e) { steps = []; }
  const step = steps.find(s => picks[s.key] === undefined);
  if (!step || depth > 6) { out.push(Object.assign({}, picks)); return; }
  let vals = [];
  if (step.type === "unit") vals = (step.units || []).map(u => u.id);
  else if (step.type === "zone") vals = (step.zones || []).map(Number);
  else vals = (step.options || []).map(o => o.value);
  if (step.optional || !vals.length) vals = vals.concat([null]);
  vals.forEach(v => flowPicks(c, id, actor, Object.assign({}, picks, { [step.key]: v }), depth + 1, out));
}
function candidateActions(c) {
  const S = c.S.state, out = [];
  actors(c).forEach(a => {
    let list = [];
    try { list = c.skillList(a) || []; } catch (e) { list = []; }
    list.forEach(sk => {
      const cost = c.skillCost(sk.id) || {};
      if ((cost.ap || 0) > (a.ap || 0) || (cost.bonus || 0) > (a.bonus || 0)) return;
      if (c.skillRequirementError(a, sk.id)) return;
      const picksList = [];
      flowPicks(c, sk.id, a, {}, 0, picksList);
      picksList.forEach(picks => {
        const flowTarget = picks.target;
        const targets = flowTarget !== undefined ? [flowTarget] :
          [null].concat(S.units.filter(u => !u.hidden && !u.dead && !u._removed).map(u => u.id));
        targets.forEach(t => out.push({ type: "skill", actor: a.id, skill: sk.id, target: t || null, picks, label: `${a.name}·${sk.name}` }));
      });
    });
    if ((a.bonus || 0) > 0 || (a.ap || 0) > 0) {
      (c.zoneNeighbors(a.zone) || []).forEach(z => out.push({ type: "move", actor: a.id, dest: Number(z), label: `${a.name}·移动到${z}区` }));
    }
  });
  return out;
}
/** 记录 / 重放用：单位编号换成「@kit」（假人是 @dummy），重放时再换回当时场上的编号（武器人每次唤出编号都不一样） */
function tokenOf(S, id) {
  const u = S.units.find(x => x.id === id);
  if (!u) return id;
  return u.name === "训练假人" ? "@dummy" : "@" + u.kit;
}
function idOf(S, tok) {
  if (typeof tok !== "string" || tok[0] !== "@") return tok;
  const live = S.units.filter(u => !u._removed);
  const u = tok === "@dummy" ? live.find(x => x.name === "训练假人") : (live.find(x => x.kit === tok.slice(1) && !x.hidden) || live.find(x => x.kit === tok.slice(1)));
  return u ? u.id : tok;
}
function tokenize(S, cmd) {
  const out = Object.assign({}, cmd, { actor: tokenOf(S, cmd.actor) });
  if (cmd.target) out.target = tokenOf(S, cmd.target);
  if (cmd.picks) { out.picks = {}; Object.keys(cmd.picks).forEach(k => { out.picks[k] = typeof cmd.picks[k] === "string" ? tokenOf(S, cmd.picks[k]) : cmd.picks[k]; }); }
  return out;
}
function resolve(S, cmd) {
  const out = Object.assign({}, cmd, { actor: idOf(S, cmd.actor) });
  if (cmd.target) out.target = idOf(S, cmd.target);
  if (cmd.picks) { out.picks = {}; Object.keys(cmd.picks).forEach(k => { out.picks[k] = idOf(S, cmd.picks[k]); }); }
  return out;
}
function execute(c, cmd) {
  const plain = JSON.parse(JSON.stringify(cmd)); delete plain.label;
  if (plain.type === "move") { delete plain.target; delete plain.picks; delete plain.skill; }
  try { c.BattleCommands.execute(plain); } catch (e) { return false; }
  try { c.BattleSim.resolveQueues(c.BattleSim.BASIC_POLICY); } catch (e) { /* 结算队列出错就当这一步无效 */ }
  refillDummy(c.S.state);
  return true;
}
function endTurn(c) {
  c.endPlayerTurn();
  refillDummy(c.S.state);
  c.endEnemyTurn();
  const S = c.S.state;
  refillDummy(S);
  S.combatPhase = "player";
  // 假人不动：敌人回合只走回合流转
  // 柯尔特：第 3、6……个回合开始时，当作刚打碎了一层牛的护盾（覆盖上一个，和实战一样只记最近一层）
  const sc = S.dptScrap;
  if (sc && Number(S.turnNo) % sc.every === 0) S.lastBrokenLayer = { type: sc.type, lost: sc.lost, dmg: sc.lost };
}

/** 假人身上会自己持续打伤害的东西（状态、聚焦、高能、被抓住……）：变了才需要重新往后看 */
function dummyMark(S) {
  const d = S.units.find(u => !u.isPlayer && u.name === "训练假人" && !u._removed);
  const grab = S.units.filter(u => u.isPlayer).map(u => (u.resources || {}).crushId || null);
  return JSON.stringify([d && d.statuses, d && d.focuses, d && d.highEnergy, d && d.highTags, grab, S.fields]);
}
/** 「打法」分类：假人身上挂了哪些状态、角色 / 武器人处于哪种自我效果和状态、在不在场。
 *  束里每一类至少留一个，免得「先铺垫、好几回合后才兑现」的打法（泄能攒高能、自焚……）在兑现之前就被普攻的各种变体挤掉 */
function styleKey(S) {
  const on = o => Object.keys(o || {}).filter(k => o[k]).sort().join(",");
  const d = S.units.find(u => !u.isPlayer && u.name === "训练假人" && !u._removed);
  const me = S.units.filter(u => u.isPlayer && !u._removed).map(u => [u.kit, u.hidden ? 0 : 1, u.self || "", on(u.statuses),
    (u.resources || {}).unstable ? 1 : 0, (u.resources || {}).engine ? 1 : 0, (u.resources || {}).crushId ? 1 : 0, (u.resources || {}).mode || (u.resources || {}).bit || ""].join(":"));
  return [d ? on(d.statuses) : "", ...me.sort()].join("|");
}
/** 从当前局面什么都不做、一直结束回合到第 turns 回合，假人还会掉多少血 */
function rollout(c, fromTurn, turns, seed) {
  const S = c.S.state;
  c.S.RNG.install(seed);
  const d0 = dummyDamage(S);
  for (let t = fromTurn; t <= turns; t++) endTurn(c);
  return dummyDamage(S) - d0;
}

/** 贪心打一回合：每一步把能做的技能都试一遍，挑当下伤害最高的那个做，直到没有能打出伤害的动作 */
function greedyTurn(c, maxSteps) {
  const S = c.S.state;
  for (let i = 0; i < (maxSteps || 4); i++) {
    const base = snap(c), d0 = dummyDamage(S);
    let best = null, bestGain = 0;
    candidateActions(c).filter(x => x.type === "skill").forEach(cmd => {
      load(c, base);
      if (!execute(c, cmd)) return;
      const g = dummyDamage(S) - d0;
      if (g > bestGain) { bestGain = g; best = snap(c); }
    });
    if (!best) { load(c, base); return; }
    load(c, best);
  }
}
/** 往后看（打下去版）：接下来 H 个回合每回合贪心地打，之后只结算持续伤害，到第 turns 回合为止。
 *  「什么都不做」的往后看只看得到灼烧这类自己会掉的血，看不到自焚、导体、不稳态这种要接着打才兑现的增益 */
function greedyRollout(c, fromTurn, turns, H, seed) {
  const S = c.S.state;
  c.S.RNG.install(seed);
  const d0 = dummyDamage(S);
  for (let t = fromTurn; t <= turns; t++) {
    if (t < fromTurn + H) greedyTurn(c);
    endTurn(c);
  }
  return dummyDamage(S) - d0;
}

/* ---------- 束搜索 ---------- */
function search(kit, level, opt) {
  // 每个节点同时带 W 个「平行世界」（同一串动作，不同的骰子）：候选动作在每个世界里各跑一遍，按平均伤害排序，
  // 免得只挑到「这一组骰子刚好运气好」的打法。同一步的所有候选用同一组种子（公平比较）
  const W = Math.max(1, opt.worlds || 3);
  const { c, S } = setupField(kit, level, 0);
  const turns = opt.turns, width = opt.beam;
  // 指定开局（做对照用）：先按顺序做完这几个动作，剩下的再搜
  const opening = (opt.opening || []).map(tok => Object.assign({ turn: 1, label: tok.label || tok.skill }, tok));
  opening.forEach(tok => execute(c, resolve(S, tok)));
  const base = snap(c);
  let beam = [{ snaps: Array.from({ length: W }, () => base), dmg: dummyDamage(S), path: opening, turnDmg: [] }];
  const maxSteps = 10;   // 每回合最多几个动作（防止不耗行动的开关来回切）
  const H = opt.horizon || turns;   // 打下去的往后看：贪心打几个回合（默认一直打到最后）
  const gcache = new Map();
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (let turn = 1; turn <= turns; turn++) {
    // 回合中途按「当回合伤害 + 什么都不做的往后看」排序（同一回合里大家口径一致）；回合结束时再按「打下去的往后看」排序
    let open = beam.map(b => Object.assign({}, b, { steps: 0, start: b.dmg, future: b.pfut || 0, score: b.dmg + (b.pfut || 0) }));
    const ended = [];
    for (let step = 0; step <= maxSteps && open.length; step++) {
      const next = new Map();
      open.forEach(node => {
        // 结束回合
        const endSnaps = [], endD = [];
        node.snaps.forEach((sn, w) => {
          load(c, sn);
          c.S.RNG.install(`dpt:${kit}:${level}:t${turn}:end:w${w}`);
          endTurn(c);
          endD.push(dummyDamage(S)); endSnaps.push(snap(c));
        });
        load(c, endSnaps[0]);
        const dEnd = mean(endD);
        const key = bucketKey(S);
        // 往后看：从这里开始什么都不做、一直结束回合到第 turns 回合，还会自己打出多少（灼烧 / 腐蚀 / 冻伤、狂怒碾压……）。
        // 只用来排序（束里留谁），记的伤害还是实际打出来的。不看的话，挂持续伤害的开局当回合几乎没伤害，会被提前剪掉
        let pfut = 0, gfut = 0;
        if (opt.lookahead !== false && turn < turns) {
          pfut = mean(endSnaps.map((sn, w) => { load(c, sn); return rollout(c, turn + 1, turns, `dpt:${kit}:${level}:t${turn}:look:w${w}`); }));
          // 打下去的往后看只在基准世界里算，同一个局面（资源状态）算过就复用
          const ck = turn + "|" + key;
          if (!gcache.has(ck)) { load(c, endSnaps[0]); gcache.set(ck, greedyRollout(c, turn + 1, turns, H, `dpt:${kit}:${level}:t${turn}:greedy`)); }
          gfut = gcache.get(ck);
          load(c, endSnaps[0]);
        }
        ended.push({ style: styleKey(S), snaps: endSnaps, dmg: dEnd, pfut, score: dEnd + Math.max(pfut, gfut), path: node.path.concat([{ turn, end: true }]), turnDmg: node.turnDmg.concat([dEnd - node.start]), key });
        if (node.steps >= maxSteps) return;
        load(c, node.snaps[0]);
        const before0 = signature(S);
        const mark0 = dummyMark(S);
        // 先在基准世界里把编号换成「@kit」：各个世界里唤出的武器人编号不一样
        const cands = candidateActions(c).map(cmd => tokenize(S, cmd));
        cands.forEach(tok => {
          const snaps = [], ds = [];
          let key0 = null;
          for (let w = 0; w < W; w++) {
            load(c, node.snaps[w]);
            const before = w === 0 ? before0 : signature(S);
            c.S.RNG.install(`dpt:${kit}:${level}:t${turn}:s${step}:w${w}`);
            const ok = execute(c, resolve(S, tok));
            if (w === 0 && (!ok || signature(S) === before)) return;          // 基准世界里没做成的不要
            if (S.units.some(u => u.isPlayer && !u.weaponOf && u.dead)) return;   // 把自己打死的不要
            ds.push(dummyDamage(S)); snaps.push(snap(c));
            if (w === 0) key0 = bucketKey(S);
          }
          // 回合中途也往后看：这一步给假人挂上 / 改了会持续打伤害的东西（当下几乎没伤害），
          // 只按当回合伤害排序的话还没到回合结束就被剪掉了。只在基准世界里看一次（省时间）
          let future = node.future || 0;
          if (opt.lookahead !== false) {
            load(c, snaps[0]);
            if (dummyMark(S) !== mark0) future = rollout(c, turn, turns, `dpt:${kit}:${level}:t${turn}:s${step}:look`);
          }
          const d = mean(ds), key = key0 + "|" + Math.round(d * 10);
          const prev = next.get(key);
          if (prev && prev.score >= d + future) return;
          load(c, snaps[0]);
          next.set(key, { style: styleKey(S), snaps, dmg: d, future, score: d + future, setup: tok.type === "skill" && d <= node.dmg, path: node.path.concat([Object.assign({ turn }, tok)]), turnDmg: node.turnDmg, steps: node.steps + 1, start: node.start, key: key0 });
        });
      });
      // 当下不打伤害的技能（增益、换姿态、唤出……）另外保留一批名额，让它们活到回合结束、用「打下去的往后看」评估
      const all = [...next.values()];
      const kept = keepBest(all, width);
      const keptSet = new Set(kept);
      open = withStyles(opt.diversity === false ? [] : null, kept.concat(keepBest(all.filter(n => n.setup && !keptSet.has(n)), Math.ceil(width / 2))), all, width);
    }
    beam = withStyles(opt.diversity === false ? [] : null, keepBest(ended, width), ended, width);
  }
  beam.sort((a, b) => b.dmg - a.dmg);
  return { c, best: beam[0] };
}
/** 在已经选好的束上，给还没有代表的每一类打法补一个（这一类里分数最高的），最多补 width 个 */
function withStyles(off, kept, all, width) {
  if (off) return kept;
  const sc = n => (n.score != null ? n.score : n.dmg);
  const have = new Set(kept.map(n => n.style)), keys = new Set(kept.map(n => n.key));
  const best = new Map();
  all.forEach(n => { if (n.style == null || have.has(n.style) || keys.has(n.key)) return; const p = best.get(n.style); if (!p || sc(n) > sc(p)) best.set(n.style, n); });
  return kept.concat([...best.values()].sort((a, b) => sc(b) - sc(a)).slice(0, width));
}
/** 搜两遍（束里保不保留各类打法），取实际伤害高的：两种剪枝各有漏掉的打法，谁也不总比谁好 */
function bestSearch(kit, level, opt) {
  const a = search(kit, level, Object.assign({}, opt, { diversity: false }));
  const b = search(kit, level, Object.assign({}, opt, { diversity: true }));
  return a.best.dmg >= b.best.dmg ? a : b;
}
function keepBest(list, width) {
  // 同一种资源状态（不含伤害）只留伤害最高的那个，再按伤害取前 width 个
  const byKey = new Map();
  const sc = n => (n.score != null ? n.score : n.dmg);
  list.forEach(n => { const p = byKey.get(n.key); if (!p || sc(n) > sc(p)) byKey.set(n.key, n); });
  return [...byKey.values()].sort((a, b) => sc(b) - sc(a)).slice(0, width);
}

/** 把找到的动作序列换种子重放：合法的照做，不合法的跳过 */
function replay(kit, level, path, seed, turns) {
  const { c, S } = setupField(kit, level, seed);
  c.S.RNG.install(`dpt:replay:${kit}:${level}:${seed}`);
  const perTurn = [];
  let start = 0, skipped = 0;
  for (const a of path) {
    if (a.end) { endTurn(c); const d = dummyDamage(S); perTurn.push(d - start); start = d; continue; }
    const before = signature(S);
    if (!execute(c, resolve(S, a)) || signature(S) === before) skipped++;
  }
  while (perTurn.length < turns) { endTurn(c); const d = dummyDamage(S); perTurn.push(d - start); start = d; }
  return { total: dummyDamage(S), perTurn, skipped };
}

function main() {
  const kits = String(arg("kits", B.HEROES.join(","))).split(",").filter(Boolean);
  const levels = String(arg("levels", "1,5,10,15")).split(",").map(Number);
  const turns = Number(arg("turns", 8)), beam = Number(arg("beam", 40)), seeds = Number(arg("seeds", 5)), worlds = Number(arg("worlds", 3));
  const rows = [];
  for (const kit of kits) for (const level of levels) {
    const t0 = Date.now();
    const { best } = bestSearch(kit, level, { turns, beam, worlds });
    const reps = Array.from({ length: seeds }, (_, i) => replay(kit, level, best.path, i + 1, turns));
    const mean = reps.reduce((s, r) => s + r.total, 0) / reps.length;
    const perTurn = Array.from({ length: turns }, (_, t) => reps.reduce((s, r) => s + (r.perTurn[t] || 0), 0) / reps.length);
    const row = { kit, level, turns, searchTotal: best.dmg, dpt: mean / turns, burst: Math.max(...perTurn), opening3: perTurn.slice(0, 3).reduce((a, b) => a + b, 0) / 3,
      perTurn: perTurn.map(x => Math.round(x * 10) / 10), skipped: reps.reduce((s, r) => s + r.skipped, 0) / reps.length,
      rotation: rotationText(best.path), ms: Date.now() - t0 };
    rows.push(row);
    console.log(`${kit} Lv${level}  DPT ${row.dpt.toFixed(1)}  爆发 ${row.burst.toFixed(0)}  前3回合 ${row.opening3.toFixed(1)}  逐回合 ${row.perTurn.join("/")}  (${(row.ms / 1000).toFixed(1)}s${row.skipped ? `，重放平均跳过 ${row.skipped.toFixed(1)} 步` : ""})`);
    console.log("  循环：" + row.rotation);
  }
  const out = arg("json", null);
  if (out) require("fs").writeFileSync(out, JSON.stringify(rows, null, 2));
  return rows;
}
function rotationText(path) {
  const turns = [];
  let cur = [];
  path.forEach(a => { if (a.end) { turns.push(cur.join(" → ") || "（不动）"); cur = []; } else cur.push(a.label); });
  return turns.map((t, i) => `T${i + 1}: ${t}`).join(" | ");
}

if (require.main === module) main();
module.exports = { setupField, search, bestSearch, replay, dummyDamage, refillDummy, candidateActions, execute, snap, load, signature, endTurn, resolve };
