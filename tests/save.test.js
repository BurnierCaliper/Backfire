// 存档：读写、版本升级、坏档、队伍人数、永久死亡
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("单局存档读写一致", () => {
  const { SaveStore } = H.load();
  const run = SaveStore.newRun({ party: ["kolt", "helu"], seed: "ABC" });
  assert.ok(SaveStore.saveRun(run));
  assert.deepEqual(plain(SaveStore.loadRun()), plain(run));
  SaveStore.clearRun();
  assert.equal(SaveStore.loadRun(), null);
});

test("开局队伍 2–4 人，少于 2 人或重复角色都不行", () => {
  const { SaveStore } = H.load();
  assert.throws(() => SaveStore.newRun({ party: ["kolt"] }), /2–4/);
  assert.throws(() => SaveStore.newRun({ party: ["kolt", "helu", "ras", "nora", "xia"] }), /2–4/);
  assert.throws(() => SaveStore.newRun({ party: ["kolt", "kolt"] }), /重复/);
  assert.equal(SaveStore.newRun({ party: ["kolt", "helu", "ras", "nora"] }).party.length, 4);
});

test("每名角色带着自己的专属武器人，绯秋是两把刀", () => {
  const { SaveStore } = H.load();
  const run = SaveStore.newRun({ party: ["kolt", "hiaki"] });
  const w = Object.fromEntries(run.party.map(h => [h.kit, plain(h.weapons).sort()]));
  assert.deepEqual(w.kolt, ["torque"]);
  assert.deepEqual(w.hiaki, ["naruto", "niu"]);
});

test("角色永久死亡：角色和武器人一起离开队伍，记进阵亡名单", () => {
  const { SaveStore } = H.load();
  const run = SaveStore.newRun({ party: ["kolt", "helu", "ras"] });
  SaveStore.killHero(run, "kolt");
  assert.deepEqual(run.party.map(h => h.kit), ["helu", "ras"]);
  assert.equal(run.fallen[0].kit, "kolt");
  assert.deepEqual(plain(run.fallen[0].weapons), ["torque"]);
});

test("旧版本存档读取时按 MIGRATE 一路升级", () => {
  const { SaveStore, localStorage } = H.load();
  SaveStore.CURRENT.run = 2;
  SaveStore.MIGRATE.run[1] = (d) => Object.assign({}, d, { upgraded: true });
  localStorage.setItem(SaveStore.KEYS.run, JSON.stringify({ kind: "run", version: 1, savedAt: 0, data: { act: 3 } }));
  assert.deepEqual(plain(SaveStore.loadRun()), { act: 3, upgraded: true });
});

test("更新版本的存档与坏档：读不出来返回空，坏档另存一份", () => {
  const { SaveStore, localStorage } = H.load();
  localStorage.setItem(SaveStore.KEYS.run, JSON.stringify({ kind: "run", version: 99, savedAt: 0, data: {} }));
  assert.equal(SaveStore.loadRun(), null);
  localStorage.setItem(SaveStore.KEYS.run, "{不是 JSON");
  assert.equal(SaveStore.loadRun(), null);
  assert.equal(localStorage.getItem(SaveStore.KEYS.run + ".broken"), "{不是 JSON");
});

test("没有 Meta 存档时给默认值", () => {
  const { SaveStore } = H.load();
  assert.deepEqual(plain(SaveStore.loadMeta().stats), { runs: 0, wins: 0, deaths: 0 });
});
