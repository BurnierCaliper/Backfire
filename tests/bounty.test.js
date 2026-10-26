// 悬赏任务：路线一站一站显示；3 次线索检定成功找到目标（失败 5 次也会找到）；目标血量 / atk ×1.5、【目标】、多占 1 代币
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function bountyRun(seed) {
  const c = H.load(); const R = c.Rogue;
  for (let i = 0; i < 60; i++) {
    const run = R.newRun({ party: ["kolt", "helu"], seed: seed + i });
    const k = run.board.findIndex(t => t.kind === "bounty");
    if (k >= 0) return { c, R, run, k };
  }
  throw new Error("没抽到悬赏任务");
}
/** 让检定必定成功：难度改成简单，全队这项熟练三级 */
function passCheck(R, run) {
  const info = R.checkInfo(run);
  const node = R.currentNode(run);
  node.check.diff = "easy";
  (node.check.options || []).forEach(o => { o.diff = "easy"; });
  run.party.forEach(h => { h.profs[info.prof] = 3; });
  return R.attemptCheck(run, run.party[0].kit);
}
/** 非检定节点：随便走过去，一直走到下一个检定（或目标）。
 *  按小时强制的休息点是额外的一站（tests/rest-spacing.test.js）：休息点 → 随机站 → 检定，所以两个检定之间可能有两站 */
function passOther(c, R, run) {
  let out;
  for (let g = 0; g < 4; g++) {
    const n = R.currentNode(run);
    if (!n || n.type === "check" || n.target || run.stage !== "task") break;
    const forced = n.type === "rest" && n.noPay;
    if (n.type === "battle" || n.type === "elite") out = R.finishBattle(run, "win");
    else if (n.type === "rest") out = R.restAtNode(run, "leave");
    else out = R.leaveNode(run);
    const nx = R.currentNode(run);
    if (forced && nx && !nx.target) assert.notEqual(nx.type, "check", "强制休息点后面先接随机站");
  }
  return out;
}

test("任务板：悬赏不显示路线，只有第一个线索检定", () => {
  const { run, k } = bountyRun("BTY-A");
  const t = run.board[k];
  assert.deepEqual(plain(t.cols), [["check"]]);
  assert.deepEqual(plain(t.hunt), { need: 3, failMax: 5 });
});

test("检定和其他节点交替，一站一站加进路线；3 次成功找到目标，下一站是精英战", () => {
  const { c, R, run, k } = bountyRun("BTY-B");
  R.acceptTask(run, k);
  assert.equal(run.task.nodes.length, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(R.currentNode(run).type, "check");
    passCheck(R, run);
    assert.equal(run.task.hunt.found, i + 1);
    if (i < 2) {
      assert.notEqual(R.currentNode(run).type, "check", "检定后面跟一站别的");
      assert.notEqual(R.currentNode(run).type, "elite");
      assert.equal(run.task.nodes.length, run.task.index + 1, "后面的路线还没显示");
      passOther(c, R, run);
    }
  }
  const n = R.currentNode(run);
  assert.equal(n.type, "elite");
  assert.ok(n.target);
  assert.ok(run.task.hunt.located);
  assert.match(run.task.hunt.target.name, /^【目标】/);
  // 目标那一战
  const spec = R.battleSpec(run);
  c.BattleSim.setup(spec);
  const tg = c.S.state.units.find(u => u.bountyTarget);
  assert.ok(tg);
  assert.match(tg.name, /^【目标】/);
  const base = c.enemyPresets().find(p => p.id === run.task.hunt.target.preset).build(spec.level, c.S.state.partySize);
  // 目标也有个体值（enemies.js）：先按水平波动，再 ×1.5
  const iv = tg.iv || { hp: 0, atk: 0 };
  assert.equal(tg.layers[0].max, Math.round(Math.round(base.layers[0].max * (1 + iv.hp / 100)) * 1.5));
  assert.equal(c.effectiveAtk(tg, c.S.state.units), Math.round(Math.round(base.personalAtk * (1 + iv.atk / 100) * 10) / 10 * 1.5));
  // 每一行敌人按代币算（成群的整组记一次：三区制的站位把一组拆成一只一行，按只数折回去，和 tests/three-way.test.js 一样），
  // 目标再多算 1 枚：总数不超过精英战的 5 枚
  const tokens = Math.round(spec.encounter.enemies.reduce((s, e) => {
    const g = Number((c.enemyInfo(e.preset) || {}).group) || 1;
    return s + c.enemyTokens(e.preset) * (e.count || 1) / g;
  }, 0));
  assert.ok(tokens + 1 <= 5, `目标多占 1 枚代币：${tokens} + 1`);
  assert.equal(spec.encounter.enemies.filter(e => e.bounty).length, 1);
  const notes = R.finishBattle(run, "win");
  assert.ok(notes.some(t => /任务「悬赏」完成/.test(t)), notes.join("\n"));
  assert.equal(run.stage, "camp");
});

test("检定失败（或绕过去）下一次换熟练项；失败 5 次目标也会直接出现", () => {
  const { c, R, run, k } = bountyRun("BTY-C");
  R.acceptTask(run, k);
  let lastProf = null;
  for (let i = 0; i < 5; i++) {
    const info = R.checkInfo(run);
    if (lastProf) assert.notEqual(info.prof, lastProf, "失败后换一个熟练项");
    lastProf = info.prof;
    R.skipCheck(run);
    assert.equal(run.task.hunt.fails, i + 1);
    if (i < 4) passOther(c, R, run);
  }
  assert.equal(R.currentNode(run).type, "elite");
  assert.ok(R.currentNode(run).target);
});

test("从目标那一战撤退：目标逃走，任务失败", () => {
  const { R, run, k } = bountyRun("BTY-D");
  R.acceptTask(run, k);
  for (let i = 0; i < 5; i++) { R.skipCheck(run); if (i < 4) passOther(null, R, run); }
  const notes = R.finishBattle(run, "retreat");
  assert.ok(notes.some(t => /悬赏失败：悬赏目标逃走了/.test(t)), notes.join("\n"));
  assert.equal(run.task, null);
});

test("同一个种子路线和目标都一样（读档不变）", () => {
  const a = bountyRun("BTY-E"), b = bountyRun("BTY-E");
  [a, b].forEach(({ R, run, k }) => { R.acceptTask(run, k); for (let i = 0; i < 3; i++) { R.skipCheck(run); if (i < 2) passOther(null, R, run); } });
  assert.deepEqual(plain(a.run.task.nodes.map(n => n.type)), plain(b.run.task.nodes.map(n => n.type)));
  assert.deepEqual(plain(a.run.task.nodes.filter(n => n.check).map(n => n.check.prof)), plain(b.run.task.nodes.filter(n => n.check).map(n => n.check.prof)));
});

test("悬赏线索检定：一次给三种不同的熟练项，难度各自掷；普通检定仍然只有一种", () => {
  const { R, run, k } = bountyRun("BTY-OPT");
  R.acceptTask(run, k);
  const info = R.checkInfo(run);
  assert.equal(info.options.length, 3);
  assert.equal(new Set(info.options.map(o => o.prof)).size, 3, "三种不同的熟练项");
  info.options.forEach((o, i) => {
    assert.ok(o.diffName && o.reward > 0);
    assert.equal(R.checkInfo(run, i).prof, o.prof);
    assert.equal(R.checkOdds(run, run.party[0].kit, i).prof, o.prof);
  });
  // 多抽几局：三种选项的难度不总是一样
  let differ = false;
  for (let s = 0; s < 30 && !differ; s++) {
    const b = bountyRun("BTY-DIFF" + s);
    b.R.acceptTask(b.run, b.k);
    differ = new Set(b.R.checkInfo(b.run).options.map(o => o.diff)).size > 1;
  }
  assert.ok(differ, "难度不一定一样");
});

test("悬赏线索检定：用第三种熟练项成功也算找到线索；失败后下一次不再出那一种；绕过去这次三种都不再出", () => {
  const { R, run, k } = bountyRun("BTY-OPT2");
  R.acceptTask(run, k);
  const node = R.currentNode(run);
  const third = R.checkInfo(run).options[2];
  node.check.options[2].diff = "easy";
  run.party.forEach(h => { h.profs[third.prof] = 3; });
  R.attemptCheck(run, run.party[0].kit, 2);
  assert.equal(run.task.hunt.found, 1, "第三种成功也算");
  passOther(null, R, run);
  // 这次失败：记成用第二种熟练项试过、失败了，再走过去 → 下一次不再出这一种（其他两种还可能出）
  const info2 = R.checkInfo(run);
  const failed = info2.options[1].prof;
  R.currentNode(run).check.result = { kit: run.party[0].kit, prof: 0, ok: false, opt: 1, profName: failed };
  R.skipCheck(run);
  assert.equal(run.task.hunt.fails, 1);
  assert.deepEqual(plain(run.task.hunt.lastFailProfs), [failed]);
  passOther(null, R, run);
  assert.ok(!R.checkInfo(run).options.map(o => o.prof).includes(failed), "失败的那种不再出");
  // 用公开接口：绕过去
  const s3 = bountyRun("BTY-OPT3");
  s3.R.acceptTask(s3.run, s3.k);
  const skipped = s3.R.checkInfo(s3.run).options.map(o => o.prof);
  s3.R.skipCheck(s3.run);
  passOther(null, s3.R, s3.run);
  const next = s3.R.checkInfo(s3.run).options.map(o => o.prof);
  skipped.forEach(p => assert.ok(!next.includes(p), "绕过去的三种都不再出：" + p));
});

/* ---------- issue #124：第三采矿场悬赏 ---------- */
const vm = require("node:vm");
test("悬赏目标只从本区域的敌人表里抽（第三采矿场的敌人都只占 1 枚代币，以前落到全部区域去抽）", () => {
  const c = H.load();
  for (const region of ["第三采矿场", "第一采矿场", "第二采矿场", "外城区", "沙漠", "巨人城"]) {
    const r = JSON.stringify(region);
    assert.deepEqual(plain(vm.runInContext(`bountyCandidates(${r}).filter(k => ENEMY_INFO[k].regions.indexOf(${r}) < 0)`, c)), [], `${region} 的悬赏候选都在本区域`);
    assert.ok(vm.runInContext(`bountyCandidates(${r}).length`, c) > 0);
  }
});

test("第三采矿场悬赏战：随从和目标同一阵营（安保 / 异星生物不互相敌对）", () => {
  const c = H.load();
  const bad = plain(vm.runInContext(`(() => {
    const bad = [];
    for (const preset of bountyCandidates("第三采矿场")) for (let i = 0; i < 40; i++) {
      const enc = rollBountyEncounter(preset, { region: "第三采矿场", tokens: 5, extraTokens: 1, hpMul: 1.5, atkMul: 1.5 });
      const allow = alliesOf(ENEMY_INFO[preset].faction);
      enc.enemies.forEach(e => { if (allow.indexOf(ENEMY_INFO[e.preset].faction) < 0) bad.push([preset, e.preset]); });
    }
    return bad;
  })()`, c));
  assert.deepEqual(bad, []);
});
