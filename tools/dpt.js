// 理想状态下每个角色（连同武器人）的最优输出循环与 DPT（每回合伤害）。
//
// 场地：两区直排，常态天气，没有场地效果；关闭属性克制表（state.noChart）。
// 目标：一个训练假人——血量极高打不死、架势极高打不进失衡、不行动（只走回合流转：回合开始 / 结束的结算照常）。
// 角色：走单局的升级流程（主属性加点、第一个合法奖励），武器等级 = clamp(round(等级 × 0.6), 1, 10)，满血，没有义体、不用道具。
// 搜索：束搜索。每一步列出所有合法动作（角色和在场武器人的每个技能 × 每种分步选择 × 每个目标、移动、结束回合），
//   在沙盒里试跑，按「累计伤害」排序；同一种资源状态只留伤害最高的一个，免得束里塞满同一条路的变体、把攒资源的路线挤掉。
//   每个候选在几组不同的骰子（平行世界）下各跑一遍取平均，同一步的所有候选用同一批种子（公平比较）；
//   最后把找到的序列换新的种子重放取平均，作为报告的 DPT（不会比搜索时更「走运」）。
// 只算伤害（假人掉的血）；击破、治疗另算。协助攻击、失衡等要队友触发的收益不算。
//
// 用法：node tools/dpt.js [--kits ruby,kolt] [--levels 1,5,10] [--turns 8] [--beam 40] [--worlds 3] [--seeds 5] [--json out.json]
"use strict";
const H = require("../tests/headless");
const B = require("./balance-common");

const DUMMY_HP = 1e9, DUMMY_DEF = 1e6;

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
  dummy.layers = [{ type: "flesh", current: DUMMY_HP, max: DUMMY_HP }];
  dummy.def = dummy.defMax = DUMMY_DEF;
  dummy.zone = 2;
  S.units.push(dummy);
  S.units.filter(u => u.isPlayer).forEach(u => { u.zone = 1; });
  c.startCombat();
  c.S.RNG.install(`dpt:${kit}:${level}:${seed}`);
  return { c, S, dummy };
}

const dummyDamage = (S) => S.units.filter(u => !u.isPlayer && u.name === "训练假人")
  .reduce((s, u) => s + (u.layers || []).reduce((a, l) => a + Math.max(0, (Number(l.max) || 0) - Math.max(0, Number(l.current) || 0)), 0), 0);

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
  return true;
}
function endTurn(c) {
  c.endPlayerTurn();
  c.endEnemyTurn();
  const S = c.S.state;
  S.combatPhase = "player";
  // 假人不动：敌人回合只走回合流转
}

/* ---------- 束搜索 ---------- */
function search(kit, level, opt) {
  // 每个节点同时带 W 个「平行世界」（同一串动作，不同的骰子）：候选动作在每个世界里各跑一遍，按平均伤害排序，
  // 免得只挑到「这一组骰子刚好运气好」的打法。同一步的所有候选用同一组种子（公平比较）
  const W = Math.max(1, opt.worlds || 3);
  const { c, S } = setupField(kit, level, 0);
  const turns = opt.turns, width = opt.beam;
  const base = snap(c);
  let beam = [{ snaps: Array.from({ length: W }, () => base), dmg: 0, path: [], turnDmg: [] }];
  const maxSteps = 10;   // 每回合最多几个动作（防止不耗行动的开关来回切）
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (let turn = 1; turn <= turns; turn++) {
    let open = beam.map(b => Object.assign({}, b, { steps: 0, start: b.dmg }));
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
        ended.push({ snaps: endSnaps, dmg: dEnd, path: node.path.concat([{ turn, end: true }]), turnDmg: node.turnDmg.concat([dEnd - node.start]), key: bucketKey(S) });
        if (node.steps >= maxSteps) return;
        load(c, node.snaps[0]);
        const before0 = signature(S);
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
          const d = mean(ds), key = key0 + "|" + Math.round(d * 10);
          const prev = next.get(key);
          if (prev && prev.dmg >= d) return;
          next.set(key, { snaps, dmg: d, path: node.path.concat([Object.assign({ turn }, tok)]), turnDmg: node.turnDmg, steps: node.steps + 1, start: node.start, key: key0 });
        });
      });
      open = keepBest([...next.values()], width);
    }
    beam = keepBest(ended, width);
  }
  beam.sort((a, b) => b.dmg - a.dmg);
  return { c, best: beam[0] };
}
function keepBest(list, width) {
  // 同一种资源状态（不含伤害）只留伤害最高的那个，再按伤害取前 width 个
  const byKey = new Map();
  list.forEach(n => { const p = byKey.get(n.key); if (!p || n.dmg > p.dmg) byKey.set(n.key, n); });
  return [...byKey.values()].sort((a, b) => b.dmg - a.dmg).slice(0, width);
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
    const { best } = search(kit, level, { turns, beam, worlds });
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
module.exports = { setupField, search, replay, dummyDamage, candidateActions, execute, snap, load, signature, endTurn, resolve };
