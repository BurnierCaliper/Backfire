/* Antlerscale: Backfire · HD-2D 战场原型 · 房主那边：用规则真的结算一次出招，生成联机玩家收到的那一份
 *
 * 「演示出招」按钮按下去：房主用规则（runSkill，和 sim.js · BattleSim 的普通攻击一样）打一下，结算时规则弹的字（spawnPopup）
 * 照 game.js 的样子记成演出带（tape），再照 game.js · strikePlan 挑出攻击演出（fx：谁打谁、AttackFx.resolve 的招式），
 * 拼成联机的结果包，过一遍 online-view.js 的白名单（OnlineView.projectPacket，收件人是普通玩家）。画面只拿这个投影过的包播放。
 *
 *   const packet = HD2DHost.strike(env, { actorId, pick });
 *   // env = { G 规则函数所在的全局（浏览器 window，Node 里 tests/headless.js 的 ctx）, state 房主的战斗状态, BattleSim, OnlineView, AttackFx, itemCatalog }
 *   // 返回投影过的包 { type, seq, state, tape, fx, publicLogs }（没有坚毅生命）；谁都够不着 = null
 * 演示用：出手的人行动点不够时补上（只为了能反复按着看演出），别的全照规则。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DHost = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 联机的身份：房主（主持人）和收件的普通玩家（projectPacket 给不是主持人的人才过白名单） */
  const HOST = { gm: "hd2d-host", recipient: "hd2d-player" };

  const alive = (u) => u && !u.dead && !u.hidden && !u._removed && !u.fused;
  const hpOf = (u) => (u.layers || []).reduce((s, l) => s + Math.max(0, Number(l.current) || 0), 0);
  /** 结算那一刻所有单位的样子（game.js 的 snap：projectTape 按它判断这一下是不是打在坚毅生命上，是就不给数）。房主自己的数据，只有投影过的才发出去 */
  function snapUnits(state) {
    try { return JSON.parse(JSON.stringify(state.units)); } catch (e) { return null; }
  }

  /** 挑谁打谁：先看当前行动的人，再看我方别的人；用他的普通攻击（_aa），够得着的敌人里按距离、顺序排，pick 轮流换目标。
   *  规则不让选的不挑：下潜中、躲藏中的（app.js 的攻击结算会拒掉：「不能被选作攻击目标」） */
  function pickStrike(env, actorId, pick) {
    const G = env.G, state = env.state;
    const foes = state.units.filter(u => !u.isPlayer && alive(u) && !u.untargetable && !u.submerged && !(u.statuses && u.statuses.hide));
    if (!foes.length) return null;
    const mine = state.units.filter(u => u.isPlayer && alive(u) && !u.dying && !u.stunned && !u.weaponOf);
    const order = mine.filter(u => u.id === actorId).concat(mine.filter(u => u.id !== actorId));
    for (const u of order) {
      let list = [];
      try { list = G.skillList(u) || []; } catch (e) { list = []; }
      const aa = list.find(s => s.id === u.kit + "_aa") || list.find(s => /_aa$/.test(s.id || ""));
      if (!aa) continue;
      const r = (typeof G.skillRangeFor === "function" && G.skillRangeFor(u, aa.id)) || (typeof G.parseSkillRange === "function" && G.parseSkillRange(aa.hint)) || { min: 0, max: 1 };
      const dist = (f) => G.zoneDist(Number(u.zone), Number(f.zone), Number(state.zoneMode));
      const ok = foes.filter(f => dist(f) >= r.min && dist(f) <= r.max).sort((a, b) => dist(a) - dist(b));
      if (ok.length) return { actor: u, skill: aa, target: ok[(Math.max(0, Number(pick) || 0)) % ok.length], dist: dist(ok[0]) };
    }
    return null;
  }

  /** 照 game.js · strikePlan 挑攻击演出：主攻击的几段伤害、碰到的单位、属性、隔几个区 → AttackFx.resolve 的招式 */
  function strikePlan(env, plan, pops) {
    const { actor: u, target: t, skill } = plan;
    const dmgOf = (e) => e.kind === "dmg" && Number(e.value) > 0;
    let mains = pops.filter(e => dmgOf(e) && e.main);
    if (!mains.length) mains = pops.filter(dmgOf);
    const word = pops.find(e => (e.kind === "fxword" || e.kind === "status") && e.unitId === t.id);
    const element = (mains[0] && mains[0].element) || (word && word.element) || "physical";
    const dist = env.G.zoneDist(Number(u.zone), Number(t.zone), Number(env.state.zoneMode));
    const move = env.AttackFx.resolve({
      kit: u.kit || "", skillId: skill.id, skillName: skill.name || "", isPlayer: !!u.isPlayer, element, dist,
      dmg: mains.length > 0, touched: pops.some(e => e.unitId === t.id), ally: false,
      targets: new Set(mains.map(e => e.unitId)).size, hits: mains.length, mode: null, range: u.range, big: false
    });
    const script = env.AttackFx.scriptOf(skill.id);
    if ((!move || move.kind === "none") && !script) return null;
    return {
      actor: u.id, target: t.id, move: move && move.kind !== "none" ? move : { kind: "hex", el: element, melee: false },
      script: script || null, data: { ally: false, dist, zoneOf: Number(t.zone) }, assist: false, blocker: null, parried: false
    };
  }

  /** 房主结算一次出招，返回联机玩家收到的那一份（投影过的包）；谁都够不着返回 null */
  function strike(env, opts) {
    opts = opts || {};
    const G = env.G, state = env.state;
    // 先开战（和 BattleSim.run 一样）：开场效果结算完再挑目标（例：伏咬沙鱼开场就潜进沙里，选不了）
    if (!state.combatStarted && typeof G.startCombat === "function") G.startCombat();
    const plan = pickStrike(env, opts.actorId, opts.pick);
    if (!plan) return null;
    const u = plan.actor, cost = (typeof G.skillCost === "function" && G.skillCost(plan.skill.id)) || {};
    // 演示：行动点不够就补上（只为了能反复按着看），别的全照规则
    if ((u.ap || 0) < (cost.ap || 0)) u.ap = cost.ap || 0;
    if ((u.bonus || 0) < (cost.bonus || 0)) u.bonus = cost.bonus || 0;
    const tape = [], orig = G.spawnPopup;
    // 照 game.js：规则弹的每一个字记成演出带的一条（type: "pop"），连同那一刻的单位（snap）
    G.spawnPopup = function (unit, spec) {
      if (!unit) return;
      spec = spec || {};
      tape.push({
        type: "pop", unitId: unit.id, kind: spec.kind || "dmg", value: spec.value, text: spec.text, fx: spec.fx || null,
        element: spec.element || "physical", main: !!spec.main, targetId: spec.targetId || null, snap: snapUnits(state)
      });
    };
    try {
      state.attackerId = u.id; state.targetId = plan.target.id;
      G.runSkill(plan.skill.id);
      env.BattleSim.resolveQueues(env.BattleSim.BASIC_POLICY);
    } finally { G.spawnPopup = orig; }
    const fx = strikePlan(env, plan, tape);
    const raw = {
      type: "result", seq: (Number(opts.seq) || 0) + 1, state, tape, fx,
      publicLogs: [{ kind: "action", actorName: u.name, actionName: plan.skill.name || plan.skill.id, turn: state.turnNo, at: Date.now() }]
    };
    return env.OnlineView.projectPacket(raw, { recipientId: HOST.recipient, gmId: HOST.gm, itemCatalog: env.itemCatalog || {} });
  }

  return { HOST, pickStrike, strikePlan, strike, hpOf };
});
