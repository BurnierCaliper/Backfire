// #543（争斗：两队可以是同一个角色）和 #547（无界面战斗里新唤出的武器人当回合就轮到）合在一起：
// 两队都是夕夏，各自第 1 回合唤出柏妮尔——两只柏妮尔都要在唤出的同一个阶段轮到，而且是在自己持有者那一队的结算上下文里行动
// （点火突进点着的是自己那一队夕夏的引擎）。sim.js · playerPhase 合并两边的改动时加了这一条测试。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");

const plain = v => JSON.parse(JSON.stringify(v));

test("争斗两队都是夕夏：各自唤出的柏妮尔当回合就轮到，点火突进点着的是自己那一队夕夏的引擎", () => {
  const c = H.load();
  const tier = 1;
  const entry = kit => plain(c.brawlSimEntry(kit, tier));
  const toss = c.pvpDuelToss;
  c.pvpDuelToss = () => { const keep = c.Math.random; c.Math.random = () => 0.1; try { return toss(); } finally { c.Math.random = keep; } };   // 1 队先手
  c.brawlSetup({ tier, size: 2, teams: { "1队": [entry("xia"), entry("yuito")], "2队": [entry("xia"), entry("nora")] }, seed: "BRAWL-SUMMON" });
  const S = c.S.state;
  const teamOf = u => c.pvpDuelTeamOf(u.weaponOf ? c.unitById(u.ownerId) : u);
  const xiaOf = t => S.pvpDuel.teams[t].map(id => c.unitById(id)).find(u => u.kit === "xia");
  const x1 = xiaOf("1队"), x2 = xiaOf("2队");
  assert.ok(x1 && x2 && x1.id !== x2.id, "两队各有一个夕夏");

  const acted = [];
  const policy = {
    act(u) {
      if (S.turnNo !== 1) return null;
      if (u.kit === "xia" && !S.units.some(w => w.kit === "berniel" && w.ownerId === u.id && !w.hidden) && u.ap >= 1 && u.bonus >= 1) {
        return () => { assert.ok(c.BattleSearch.execute({ type: "skill", actor: u.id, skill: "xia_summon", target: null, picks: {} })); };
      }
      if (u.kit === "berniel" && u.ap >= 1) {
        const dest = c.skillFlowSteps("berniel_dash", u, {}).find(s => s.key === "dest").zones[0];
        return () => {
          assert.ok(c.BattleSearch.execute({ type: "skill", actor: u.id, skill: "berniel_dash", target: null, picks: { carry: null, dest } }));
          acted.push({ team: teamOf(u), phase: S.combatPhase, owner: u.ownerId });
        };
      }
      return null;
    }
  };
  c.BattleSim.run({ maxRounds: 1, policy });

  const bs = S.units.filter(u => u.kit === "berniel");
  assert.equal(bs.length, 2, "两只柏妮尔都唤出来了");
  assert.deepEqual(acted.map(a => a.team).sort(), ["1队", "2队"], "两只柏妮尔第 1 回合都行动了：" + JSON.stringify(acted));
  acted.forEach(a => assert.equal(a.phase, a.team === "1队" ? "player" : "enemy", "在自己那一队的阶段行动"));
  assert.equal(acted.find(a => a.team === "1队").owner, x1.id);
  assert.equal(acted.find(a => a.team === "2队").owner, x2.id);
  assert.ok(x1.resources.engine && x2.resources.engine, "点火突进各自点着了自己那一队夕夏的引擎");
  assert.deepEqual(plain(c.__errors), []);
});
