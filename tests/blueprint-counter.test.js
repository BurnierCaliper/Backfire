// 工匠图纸：同一位工匠那里升级满 5 次领一张；领完计数归零，再满 5 次领下一张；不给重复的；都有了就不再计数
// 单局 / 单人 / 长线养成 / 每日挑战 / 联机（房主跑同一套规则、存档 / 线上都是 JSON）都走 rogue.js 这一处
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const H = require("./headless");
const plain = x => JSON.parse(JSON.stringify(x));

const MODES = {
  single: { party: ["kolt", "helu"] },
  daily: { party: ["kolt", "helu"], daily: true },
  growth: { party: ["kolt", "helu"], growth: true }
};
function atBoard(mode, seed) {
  const c = H.load();
  const R = c.Rogue;
  const run = R.newRun(Object.assign({ seed: seed || "BP-" + mode }, MODES[mode]));
  run.stage = "board";
  run.smiths = ["teresa"];
  c.S.state.kuizhi = 99999999;
  return { c, R, run, id: "teresa" };
}
/** 在这位工匠那里升级 n 次（材料不够就补，武器满级就降回 1 级） */
function up(c, R, run, id, n) {
  for (let i = 0; i < n; i++) {
    let opt = R.smithOptions(run, id).find(o => !o.max);
    if (!opt) { run.party.forEach(h => Object.keys(h.weaponLevels).forEach(k => { h.weaponLevels[k] = 1; })); opt = R.smithOptions(run, id).find(o => !o.max); }
    (opt.mats || []).forEach(m => c.bagAdd(m.id, m.need));
    c.S.state.kuizhi = 99999999;
    R.upgradeWeapon(run, opt.kit, id);
  }
}
function fullCycle(c, R, run, id) {
  const all = R.smithInfo(run, id).blueprints.map(b => b.id);
  assert.equal(all.length, 2);
  up(c, R, run, id, 4);
  assert.equal(R.smithInfo(run, id).canClaim, false);
  assert.throws(() => R.claimBlueprint(run, id, all[0]), /还要在他这里升级 1 次/);
  up(c, R, run, id, 1);
  assert.equal(R.smithInfo(run, id).canClaim, true);
  R.claimBlueprint(run, id, all[0]);                               // 5 次 → 图纸 A
  let info = R.smithInfo(run, id);
  assert.equal(info.progress, 0, "领完计数归零");
  assert.equal(info.canClaim, false);
  assert.deepEqual(plain(info.blueprints.map(b => b.id)), [all[1]], "只剩没领过的");
  assert.throws(() => R.claimBlueprint(run, id, all[0]), /已经有了/);
  up(c, R, run, id, 4);
  assert.equal(R.smithInfo(run, id).canClaim, false);
  up(c, R, run, id, 1);
  assert.equal(R.smithInfo(run, id).canClaim, true);
  assert.throws(() => R.claimBlueprint(run, id, all[0]), /已经有了/, "不给重复的");
  R.claimBlueprint(run, id, all[1]);                               // 再 5 次 → 图纸 B
  assert.deepEqual(plain(run.blueprints), plain(all));
  info = R.smithInfo(run, id);
  assert.equal(info.done, true);
  const uses = run.smithUses[id];
  up(c, R, run, id, 6);                                            // 都有了：不再计数
  info = R.smithInfo(run, id);
  assert.equal(info.progress, 0); assert.equal(run.smithBp[id], 0);
  assert.equal(info.canClaim, false); assert.equal(info.blueprints.length, 0);
  assert.equal(run.smithUses[id], uses + 6, "累计次数（关系折扣用）照常加");
  assert.throws(() => R.claimBlueprint(run, id, all[1]), /已经有了/);
  return all;
}

for (const mode of Object.keys(MODES)) {
  test(`${mode}：5 次 → 图纸 A，计数归零，再 5 次 → 图纸 B，不重复，都领完不再计数`, () => {
    const { c, R, run, id } = atBoard(mode);
    fullCycle(c, R, run, id);
  });
}

test("单人模式也一样", () => {
  const c = H.load();
  const run = c.Rogue.newRun({ party: ["ruby"], partners: ["kolt", "yuito", "tou"], role2: "生存", solo: true, seed: "BP-SOLO" });
  run.stage = "board"; run.smiths = ["teresa"]; c.S.state.kuizhi = 99999999;
  fullCycle(c, c.Rogue, run, "teresa");
});

test("计数跟着存档 / 读档走：攒到一半存档，读回来接着算；领过的图纸读回来也不会重复给", () => {
  const { c, R, run, id } = atBoard("single", "BP-SAVE");
  const all = R.smithInfo(run, id).blueprints.map(b => b.id);
  up(c, R, run, id, 5); R.claimBlueprint(run, id, all[0]); up(c, R, run, id, 3);
  R.save(run);
  const loaded = c.S.SaveStore.loadRun();
  assert.equal(loaded.smithBp[id], 3);
  assert.deepEqual(plain(loaded.smithClaimed[id]), [all[0]]);
  R.enterRunMode(loaded);
  assert.equal(R.smithInfo(loaded, id).progress, 3);
  up(c, R, loaded, id, 2);
  assert.equal(R.smithInfo(loaded, id).canClaim, true);
  assert.deepEqual(plain(R.smithInfo(loaded, id).blueprints.map(b => b.id)), [all[1]]);
});

test("长线养成走自己的存档槽，计数也一样保存", () => {
  const { c, R, run, id } = atBoard("growth", "BP-GSAVE");
  up(c, R, run, id, 2);
  R.save(run);
  const loaded = c.S.SaveStore.loadGrowth();
  assert.equal(loaded.smithBp[id], 2);
  assert.equal(R.smithInfo(loaded, id).progress, 2);
});

test("旧存档（smithClaimed 是单个 id、没有 smithBp）：领过的那张不再给，计数从 0 开始；没领过的沿用累计次数", () => {
  const { c, R, run, id } = atBoard("single", "BP-OLD");
  const all = R.smithInfo(run, id).blueprints.map(b => b.id);
  const old = plain(run);
  delete old.smithBp;
  old.smithUses = { teresa: 7, zekahr: 6 };
  old.smithClaimed = { teresa: all[0] };
  old.smiths = ["teresa", "zekahr"];
  const t = R.smithInfo(old, "teresa");
  assert.deepEqual(plain(t.claimed), [all[0]]);
  assert.equal(t.progress, 0); assert.equal(t.canClaim, false);
  assert.deepEqual(plain(t.blueprints.map(b => b.id)), [all[1]]);
  assert.equal(R.smithInfo(old, "zekahr").canClaim, true);
  up(c, R, old, "teresa", 5);
  R.claimBlueprint(old, "teresa", all[1]);
  assert.equal(R.smithInfo(old, "teresa").done, true);
});

test("指令层（rogue-commands，本地和联机房主都走这里）：升级、领图纸照新规则", () => {
  const { c, run, id } = atBoard("single", "BP-CMD");
  const session = { run };
  const act = cmd => c.dispatch(Object.assign({ type: "run" }, cmd), { session, run });
  const all = c.Rogue.smithInfo(run, id).blueprints.map(b => b.id);
  up(c, { smithOptions: c.Rogue.smithOptions, upgradeWeapon: (r, kit, sid) => act({ action: "upgradeWeapon", kit, smith: sid }) }, run, id, 5);
  act({ action: "claimBlueprint", smith: id, blueprint: all[0] });
  assert.equal(run.smithBp[id], 0);
  assert.throws(() => act({ action: "claimBlueprint", smith: id, blueprint: all[1] }), /还要在他这里升级 5 次/);
});

test("联机：玩家自己发的升级经 OnlineRogue 转给房主执行，计数照样走；联机同步（JSON）后不丢", () => {
  const { c, R, run, id } = atBoard("single", "BP-ONLINE");
  run.online = { owners: { kolt: "alice", helu: "bob" } };
  const ctx = {
    console, setTimeout: () => 0, Promise, JSON, Object, Array, Math, Number, String, Set, Map, Error,
    state: c.S.state, Screens: { is: () => false },
    RunFlow: { current: () => run, actRaw: cmd => R[cmd.action](run, cmd.kit, cmd.smith), refresh() {} },
    OnlineGame: { isHost: () => true, players: () => [{ id: "host", online: true }, { id: "alice", online: true }, { id: "bob", online: true }] },
    Rogue: R
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "online-rogue.js"), "utf8"), ctx, { filename: "online-rogue.js" });
  ctx.OnlineRogue.enable(true, "host");
  const kit = run.party.find(h => h.kit === "kolt").weapons[0];
  for (let i = 0; i < 5; i++) {
    run.party[0].weaponLevels[kit] = 1;
    const opt = R.smithOptions(run, id).find(o => o.kit === kit);
    (opt.mats || []).forEach(m => c.bagAdd(m.id, m.need));
    ctx.OnlineRogue.handle("alice", { type: "rogue.act", command: { action: "upgradeWeapon", kit, smith: id } });
  }
  const wire = plain(run);
  assert.equal(wire.smithBp[id], 5);
  assert.equal(R.smithInfo(wire, id).canClaim, true);
  const all = R.smithInfo(wire, id).blueprints.map(b => b.id);
  R.claimBlueprint(wire, id, all[1]);
  const back = plain(wire);
  assert.equal(back.smithBp[id], 0);
  assert.deepEqual(plain(R.smithInfo(back, id).blueprints.map(b => b.id)), [all[0]]);
});

test("文字：规则页、单局工匠界面说明写了新规则", () => {
  const rb = fs.readFileSync(path.join(__dirname, "..", "rulebook.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "rogue-ui.js"), "utf8");
  assert.match(rb, /领完计数归零，再升级满/);
  assert.match(rb, /不会领到已经有的图纸/);
  assert.match(ui, /领完计数归零/);
  assert.doesNotMatch(ui, /只能挑一张/);
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  const sec = readme.slice(readme.indexOf("## 规则改动记录"));
  assert.match(sec.split("\n- ")[1], /工匠图纸/);
});
