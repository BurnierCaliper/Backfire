// 跑团诊所：义体改造（规则同单局）、由谁付、伤势带着、跟着存档走、联机玩家申请 → 主持人同意 / 拒绝
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function field() {
  const c = H.load();
  c.BattleSim.setup({ party: ["kolt", "helu"], enemies: [{ id: "thug_knife", lv: 3, zone: 2 }], seed: "CLINIC" });
  c.S.TRPG.active = true;
  c.S.TRPG.clinicOpen = false;
  c.S.TRPG.cyberRequests = [];
  c.S.state.kuizhi = 0;
  c.LEDGER.purse = { kolt: 5000 };
  return c;
}
const send = (c, cmd) => c.Commands.dispatch(plain(Object.assign({ type: "trpg" }, cmd)));
const layers = (u) => plain(u.layers.map(l => [l.type, l.current, l.max]));

test("改造：照方案重建血量层、按动了多少点收钱、从选的钱包扣；伤势带着（先扣外层）", () => {
  const c = field();
  const kolt = c.findKit("kolt", c.S.state.units);
  const info = c.trpgCyberInfo("kolt");
  assert.ok(info.limit > 0 && info.limit < info.fleshMax);
  kolt.layers[kolt.layers.length - 1].current -= 2;
  const out = send(c, { action: "modifyHero", kit: "kolt", plan: { armor: 4 }, payer: "kolt" });
  assert.match(out[0], /^义体改造：/);
  assert.equal(c.trpgPurse("kolt"), 5000 - 4 * 200);
  assert.equal(c.S.state.kuizhi, 0, "公账没动");
  assert.deepEqual(layers(kolt), [["armor", 1, 3], ["flesh", info.fleshMax - 4, info.fleshMax - 4]], "缺的 2 点先从装甲扣");
  // 换回去也要钱（加减都算）
  send(c, { action: "modifyHero", kit: "kolt", plan: {}, payer: "kolt" });
  assert.equal(c.trpgPurse("kolt"), 5000 - 8 * 200);
  assert.equal(kolt.layers.length, 1);
  assert.equal(kolt.cyberPlan, null);
});

test("不合规则的方案拦下：超过上限、最多 3 种血量、没变化、钱不够", () => {
  const c = field();
  const info = c.trpgCyberInfo("kolt");
  assert.match(send(c, { action: "modifyHero", kit: "kolt", plan: { armor: info.limit + 1 }, payer: "kolt" })[0], /最多只能改造/);
  assert.match(send(c, { action: "modifyHero", kit: "kolt", plan: { armor: 1, shield: 1, sand: 1 }, payer: "kolt" })[0], /最多 3 种血量/);
  assert.match(send(c, { action: "modifyHero", kit: "kolt", plan: {}, payer: "kolt" })[0], /没有变化/);
  assert.match(send(c, { action: "modifyHero", kit: "helu", plan: { armor: 2 }, payer: "helu" })[0], /奎支不够/);
  assert.match(send(c, { action: "modifyHero", kit: "helu", plan: { armor: 2 }, free: true })[0], /主持人免费安排/);
});

test("联机申请：诊所没开不收；申请 → 主持人同意（从那名角色的钱包扣）/ 拒绝；同一个角色只留最新一条待处理", () => {
  const c = field();
  assert.match(c.trpgCyberRequest("kolt", { armor: 2 }, "p1", "Alice").error, /诊所现在没开/);
  send(c, { action: "clinicOpen", on: true });
  assert.match(c.trpgCyberRequest("helu", { armor: 2 }, "p2", "Bob").error, /钱包里的钱不够/);
  const a = c.trpgCyberRequest("kolt", { armor: 2 }, "p1", "Alice").request;
  const b = c.trpgCyberRequest("kolt", { armor: 3 }, "p1", "Alice").request;
  assert.equal(c.S.TRPG.cyberRequests.filter(r => r.status === "pending").length, 1);
  assert.match(send(c, { action: "cyberDecide", id: a.id, ok: true })[0], /没有这条申请/, "被新申请顶掉的那条没了");
  const out = send(c, { action: "cyberDecide", id: b.id, ok: true });
  assert.match(out[0], /^义体改造：/);
  assert.equal(c.trpgPurse("kolt"), 5000 - 600);
  assert.equal(b.status, "done");
  const d = c.trpgCyberRequest("kolt", { armor: 0 }, "p1", "Alice").request;
  send(c, { action: "cyberDecide", id: d.id, ok: false });
  assert.equal(d.status, "denied");
  assert.equal(c.findKit("kolt", c.S.state.units).cyberPlan.armor, 3, "拒绝不改");
});

test("给玩家的诊所数据照白名单过", () => {
  const OV = require("../online-view.js");
  const out = OV.projectClinic({ heroes: [{ kit: "kolt", name: "柯尔特", purse: 500, shp: 9, cyber: { current: { armor: 2 }, limit: 14, rate: 0.7, fleshMax: 20, perHp: 200, secret: 1 }, request: { status: "pending", cost: 400, by: "x" } }] });
  assert.deepEqual(plain(out), { heroes: [{ kit: "kolt", name: "柯尔特", purse: 500,
    cyber: { current: { armor: 2, shield: 0, sand: 0, spirit: false }, limit: 14, rate: 0.7, fleshMax: 20, perHp: 200 },
    request: { status: "pending", cost: 400, note: "" } }] });
});
