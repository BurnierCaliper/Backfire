"use strict";
// #340 第 9 条：大战场一次行动发给每名玩家的结算包合计必须 < 51,200 B；一次行动只发一个完整结算包。
// （第 8 条聊天增量另见 PR #393，本测试不依赖 chatDelta。）
const test = require("node:test"), assert = require("node:assert/strict");
const { fixture, LIMIT } = require("./online-packet-budget.helper.js");
const owner = (f, actorId) => f.c.HotseatGame.getView().order.find(o => o && o.actor === actorId).owner;
const current = f => f.state.units.find(u => u.id === f.c.HotseatGame.getView().currentUnitId);
function underLimit(t, label, stats) {
  t.diagnostic(label + " " + JSON.stringify(stats));
  for (const [p, row] of Object.entries(stats)) {
    assert.ok(row.packets >= 1, label + ": " + p + " 应收到结算包");
    assert.ok(row.total < LIMIT, `${label}: ${p} 收到 ${row.total} B，超过 ${LIMIT}`);
  }
}

const BIG = [
  { id: "bandit_boss", lv: 8, zone: 3 }, { id: "ufo_boss", lv: 8, zone: 3 },
  ...Array.from({ length: 12 }, (_, i) => ({ id: ["thug_knife", "thug_hammer", "thug_gun"][i % 3], lv: 6, zone: 2 + (i % 2) }))
];
const bigField = () => fixture({ enemies: BIG, chat: 0, prepare(c, st) {
  const bosses = st.units.filter(u => !u.isPlayer && /boss/.test(u.kit));
  for (const boss of bosses) for (const type of ["execution", "share", "tower", "spread"]) { try { c.addBossMechanic(boss, { type }); } catch (_) {} }
} });

test("第 9 条：一次行动只发一个完整结算包（不再 onActionSettled + execute 各发一包）", async () => {
  const f = await fixture({ enemies: [{ id: "thug_knife", lv: 2, zone: 2 }, { id: "thug_hammer", lv: 2, zone: 2 }] });
  const actor = current(f);
  const stats = await f.measure(() => f.cmd(owner(f, actor.id), { type: "move", actor: actor.id, dest: 2 }));
  assert.equal(actor.zone, 2);
  for (const row of Object.values(stats)) assert.equal(row.packets, 1, "一次行动只发一个完整结算包，收到 " + row.packets);
  assert.deepEqual(f.errors, []);
});

test("第 9 条：4 名玩家 + 14 只敌人（两只首领挂机制）：移动 / 单体普攻 / 打出失衡 / 范围攻击，每名玩家都 < 51,200 B", async t => {
  const f = await bigField();
  assert.ok(f.state.units.filter(u => !u.isPlayer && !u.weaponOf).length >= 14);
  const runs = [];
  let actor = current(f);
  runs.push(["move", await f.measure(() => f.cmd(owner(f, actor.id), { type: "move", actor: actor.id, dest: 2 }))]);
  const foes = () => f.state.units.filter(u => !u.isPlayer && !u.dead && Number(u.zone) === 2);
  const attack = async (label, prep) => {
    f.c.HotseatGame.getView();
    const a = current(f); if (!a) return;
    a.zone = 2; a.ap = Math.max(a.ap || 0, 3);
    const skill = label === "aoe" ? (a.kit === "helu" ? "helu_storm" : a.kit + "_aa") : a.kit + "_aa";
    for (const zone of [2, 1, 3]) for (const target of foes()) {
      a.zone = zone;
      if (prep) prep(target);
      const n = f.sends.length;
      const got = await f.measure(() => f.cmd(owner(f, a.id), { type: "skill", actor: a.id, skill, target: target.id, picks: {} }));
      const ack = f.sends.slice(n).find(s => s.packet.type === "ack");
      if (ack && ack.packet.ok) { runs.push([label, got]); return; }
      t.diagnostic(label + " " + a.kit + "@" + a.zone + " -> " + target.kit + "@" + target.zone + ": " + (ack && ack.packet.error));
    }
    assert.fail(label + " 没有能打的目标");
  };
  await attack("single");
  await attack("break", u => { u.def = 1; });
  await attack("aoe");
  assert.ok(runs.length >= 3);
  for (const [label, stats] of runs) {
    underLimit(t, "big field " + label, stats);
    for (const row of Object.values(stats)) assert.equal(row.packets, 1, label + " 一次行动只发一个包");
  }
  // 至少有一包用了 matchupDelta 或 unitsDelta（第二包起）
  const results = f.sends.filter(s => s.packet.type === "result" && s.recipient === "p2");
  assert.ok(results.length >= 2);
  const later = results.slice(1);
  assert.ok(later.some(s => s.packet.matchupDelta || s.packet.matchupUnchanged || s.packet.unitsDelta),
    "后续包应走 matchup/units 差量，收到的键：" + later.map(s => Object.keys(s.packet).join(",")).join(" | "));
  assert.deepEqual(f.errors, []);
});

test("README 规则改动记录写了 #340 第 9 条", () => {
  const md = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "README.md"), "utf8");
  const sec = md.slice(md.indexOf("## 规则改动记录"));
  const end = sec.indexOf("\n## ", 5);
  const body = end > 0 ? sec.slice(0, end) : sec;
  assert.match(body, /#340 第 9 条/);
  assert.match(body, /matchupDelta|克制表|unitsDelta/);
});
