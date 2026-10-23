// 联机单局工匠「领图纸」：玩家自己发 claimBlueprint，房主用 rogue.js 的同一套规则校验；包里带进度 x/5；单局工匠卡摘要只放短进度
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

function setup() {
  const c = H.load(), R = c.Rogue;
  const run = R.newRun({ seed: "BP-OL-UI", party: ["kolt", "helu"] });
  run.stage = "board"; run.smiths = ["teresa"];
  c.S.state.kuizhi = 99999999;
  run.online = { owners: { kolt: "alice", helu: "bob" } };
  const ctx = {
    console, setTimeout: () => 0, Promise, JSON, Object, Array, Math, Number, String, Set, Map, Error,
    state: c.S.state, Screens: { is: () => false },
    RunFlow: { current: () => run, actRaw: cmd => cmd.action === "claimBlueprint" ? R.claimBlueprint(run, cmd.smith, cmd.blueprint) : R[cmd.action](run, cmd.kit, cmd.smith), refresh() {} },
    OnlineGame: { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "alice", online: true }, { id: "bob", online: true }] },
    Rogue: R
  };
  for (const k of Object.keys(c)) if (!(k in ctx)) ctx[k] = c[k];   // 背包 / 武器改装件这些全局函数
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "online-rogue.js"), "utf8"), ctx, { filename: "online-rogue.js" });
  ctx.OnlineRogue.enable(true, "host");
  const kit = run.party.find(h => h.kit === "kolt").weapons[0];
  const upgrade = () => {
    run.party[0].weaponLevels[kit] = 1;
    const opt = R.smithOptions(run, "teresa").find(o => o.kit === kit);
    (opt.mats || []).forEach(m => c.bagAdd(m.id, m.need));
    ctx.OnlineRogue.handle("alice", { type: "rogue.act", command: { action: "upgradeWeapon", kit, smith: "teresa" } });
  };
  return { c, R, run, ctx, upgrade };
}

test("联机：玩家发领图纸，没攒满被房主拒；攒满后领到、计数归零；不能冒用别人的角色", () => {
  const { R, run, ctx, upgrade } = setup();
  const all = R.smithInfo(run, "teresa").blueprints.map(b => b.id);
  const claim = (who, payer, bp) => ctx.OnlineRogue.handle(who, { type: "rogue.act", command: { action: "claimBlueprint", smith: "teresa", blueprint: bp, payer } });
  for (let i = 0; i < 4; i++) upgrade();
  assert.throws(() => claim("alice", "kolt", all[0]), /还要在他这里升级 1 次/);
  upgrade();
  assert.throws(() => claim("alice", "helu", all[0]), /只能动自己的角色/);
  claim("alice", "kolt", all[0]);
  assert.equal(run.smithBp.teresa, 0);
  assert.deepEqual(plain(run.smithClaimed.teresa), [all[0]]);
  assert.throws(() => claim("alice", "kolt", all[0]), /已经有了/);
});

test("联机包：工匠带图纸进度，攒满才附可选图纸；包体不超过 51200 字节", () => {
  const { ctx, upgrade } = setup();
  let v;
  v = ctx.OnlineRogue.viewFor("alice");
  assert.ok(v && v.smith, "算得出工匠包");
  assert.deepEqual(plain(v.smith.bp), { progress: 0, need: 5, done: false, canClaim: false, options: [] });
  for (let i = 0; i < 5; i++) upgrade();
  v = ctx.OnlineRogue.viewFor("alice");
  assert.equal(v.smith.bp.canClaim, true);
  assert.equal(v.smith.bp.options.length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(v)) < 51200);
});

test("界面文字：联机有领图纸按钮；单局工匠摘要用短进度「图纸 x/5」且不换行", () => {
  const ol = fs.readFileSync(path.join(__dirname, "..", "online-ui.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "rogue-ui.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "game.css"), "utf8");
  assert.match(ol, /rogueAct\("领图纸", \{ action: "claimBlueprint"/);
  assert.match(ui, /`图纸 \$\{info\.progress\}\/\$\{info\.need\}`/);
  assert.match(css, /details\.smith \.sm-prog \{[^}]*white-space: nowrap/);
});
