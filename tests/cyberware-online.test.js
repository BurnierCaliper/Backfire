// 联机单局的义体：房主发 packet.cyberware（只有自己的角色、没有坚毅数值）；装 / 拆走房主、用对应角色的钱包
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const V = require("../online-view");
const ROOT = path.resolve(__dirname, "..");
const J = v => JSON.parse(JSON.stringify(v));

function setup() {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["kolt", "helu", "ruby"], seed: "CWON" });
  run.stage = "camp";                    // 营地诊所（rogue-data.js · campClinic）
  c.S.state.kuizhi = 0;
  c.RunFlow = { current: () => run, actRaw: cmd => c.Commands.dispatch(Object.assign({ type: "run" }, cmd), { run }) };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }] };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "online-rogue.js"), "utf8"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });
  vm.runInContext("cyberwareLoadExamples()", c);
  const d = O.data(run); d.purse = { kolt: 100, helu: 50000, ruby: 7 };
  return { c, R, run, O, d };
}
const act = (O, who, command) => O.handle(who, { type: "rogue.act", command });

test("packet.cyberware：只有自己操控的角色；经 projectPacket 后没有坚毅数值", () => {
  const { O, run } = setup();
  run.party.forEach(h => { h.shp = 13; h.shpMax = 21; });
  const raw = O.cyberwareFor("p2");
  assert.deepEqual(raw.heroes.map(h => h.kit).sort(), ["helu", "ruby"]);
  const shop = raw.heroes[0].shop.find(x => x.id === "example_t5_melee");
  assert.ok(shop && shop.price > 0);
  const pkt = V.projectPacket({ type: "result", cyberware: J(raw) }, { recipientId: "p2", gmId: "host" });
  assert.equal(pkt.cyberware.heroes.length, 2);
  assert.ok(pkt.cyberware.heroes.every(h => h.view && Array.isArray(h.shop)));
  assert.doesNotMatch(JSON.stringify(pkt.cyberware), /shp|Shp|坚毅/);
  assert.doesNotMatch(JSON.stringify(raw), /"shp|Shp"/);
  // 不在诊所：不发
  run.stage = "board";
  assert.equal(O.cyberwareFor("p2"), null);
});

test("安装 / 拆除：玩家发 rogue.act，房主结算，从这名角色自己的钱包扣", () => {
  const { O, run, d, R } = setup();
  const price = J(R.cyberwarePacketFor(run, "helu")).shop[0].price;
  assert.deepEqual({ ...act(O, "p2", { action: "installCyberware", kit: "helu", id: "example_t5_melee" }) }, { ok: true });
  assert.equal(d.purse.helu, 50000 - price);
  assert.equal(d.purse.ruby, 7); assert.equal(d.purse.kolt, 100);
  const h = run.party.find(x => x.kit === "helu");
  assert.deepEqual(J(h.cyberware), [{ id: "example_t5_melee" }]);
  assert.equal(O.cyberwareFor("p2").heroes.find(x => x.kit === "helu").view.installed[0].id, "example_t5_melee");
  const removeCost = J(R.cyberwarePacketFor(run, "helu")).view.installed[0].removeCost;
  act(O, "p2", { action: "removeCyberware", kit: "helu", id: "example_t5_melee" });
  assert.equal(d.purse.helu, 50000 - price - removeCost);
  assert.deepEqual(J(h.cyberware), []);
});

test("不能拿自己的钱装别人的角色；钱不够失败且不扣钱", () => {
  const { O, d } = setup();
  assert.throws(() => act(O, "p2", { action: "installCyberware", kit: "kolt", id: "example_t5_melee" }), /只能动自己的角色/);
  assert.throws(() => act(O, "p2", { action: "installCyberware", kit: "helu", payer: "ruby", id: "example_t5_melee" }), /只能给自己的角色装、拆义体/);
  assert.throws(() => act(O, "p2", { action: "installCyberware", kit: "ruby", id: "example_t5_melee" }), /奎支不够/);
  assert.equal(d.purse.ruby, 7);
  assert.throws(() => act(O, "p2", { action: "removeCyberware", kit: "helu", id: "example_t5_melee" }), /没有装/);
});

test("online-game.js 把 cyberware 放进发给每个人的包", () => {
  const src = fs.readFileSync(path.join(ROOT, "online-game.js"), "utf8");
  assert.match(src, /cyberware: rogue\(\) && OnlineRogue\.cyberwareFor \? OnlineRogue\.cyberwareFor\(id\) : null/);
});
