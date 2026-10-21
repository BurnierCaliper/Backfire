// issue #135：联机单局的投票只算有角色的人——旁观者（没分到角色的玩家）不算票，也不用等他们投
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const H = require("./headless");
const ROOT = path.resolve(__dirname, "..");

function setup(seed) {
  const c = H.load(), R = c.Rogue, run = R.newRun({ party: ["torque", "helu", "ruby"], seed });
  c.S.state.kuizhi = 0;
  const performed = [];
  c.RunFlow = { current: () => run, actRaw: () => ({}), perform: cmd => { performed.push(cmd); return Promise.resolve(); } };
  c.OnlineGame = { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "p2", online: true }, { id: "spec", online: true }] };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "online-rogue.js"), "utf8"), c, { filename: "online-rogue.js" });
  const O = c.OnlineRogue; O.enable(true, "host"); O.setOwners({ helu: "p2", ruby: "p2" });
  run.stage = "camp";
  return { O, run, performed };
}

test("旁观者不能投票，也不用等：有角色的人投齐就结算", async () => {
  const { O, run, performed } = setup("OL135-VOTE");
  const opt = O.options(run)[0];
  assert.throws(() => O.vote("spec", opt.id), /没有分到角色/);
  O.vote("host", opt.id);
  assert.equal(O.tryResolve(false), false, "p2 还没投");
  O.vote("p2", opt.id);
  assert.equal(O.tryResolve(false), true, "旁观者不在线投票也照样结算");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(performed.length, 1);
});

test("投票画面：需要投票的人数不含旁观者，旁观者自己看到旁观标记", () => {
  const { O } = setup("OL135-VIEW");
  const host = O.viewFor("host").vote, spec = O.viewFor("spec").vote;
  assert.equal(host.voters, 2); assert.equal(host.spectator, false);
  assert.equal(spec.voters, 2); assert.equal(spec.spectator, true);
});

test("房主把角色全分给别人、自己是旁观者：不算票，但照样能按现在的票数决定", async () => {
  const { O, run, performed } = setup("OL135-HOSTSPEC");
  O.setOwners({ torque: "p2", helu: "p2", ruby: "p2" });
  const opt = O.options(run)[0];
  assert.throws(() => O.vote("host", opt.id), /没有分到角色/, "房主自己是旁观者，不能投票");
  assert.throws(() => O.handle("host", { type: "rogue.force", what: "vote" }), /没有人投票/, "没人投票时强制结算被拒绝");
  O.vote("p2", opt.id);
  assert.doesNotThrow(() => O.handle("host", { type: "rogue.force", what: "vote" }), "房主强制结算成功");
  await new Promise(r => setTimeout(r, 10));
  assert.equal(performed.length, 1);
});

test("房主的「按现在的票数决定」没人投票时写明原因并灰掉", () => {
  const src = fs.readFileSync(path.join(ROOT, "rogue-ui.js"), "utf8");
  assert.ok(src.includes('v.vote.voted ? "按现在的票数决定" : "还没有人投票"'));
  assert.ok(src.includes('id="r-force-vote" ${v.vote.voted ? "" : "disabled"}'));
});
