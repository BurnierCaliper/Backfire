"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function load() {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../commands.js"), "utf8"), c);
  return c.Commands;
}
const plain = x => JSON.parse(JSON.stringify(x));

test("dispatch copies JSON commands and preserves synchronous results and errors", () => {
  const C = load(), authority = { value: 0 };
  C.register("add", (cmd, context) => { context.value += cmd.amount; cmd.amount = 999; return context.value; });
  const cmd = { type: "add", amount: 3 };
  assert.equal(C.dispatch(cmd, authority), 3);
  assert.equal(cmd.amount, 3);
  assert.equal(C.dispatch(JSON.parse(JSON.stringify(cmd)), authority), 6);
  assert.equal(C.history()[0].command.amount, 3, "log keeps the submitted command, not executor edits");
  C.register("fail", () => { throw new Error("rule rejected"); });
  assert.throws(() => C.dispatch({ type: "fail" }), /rule rejected/);
  assert.equal(C.history().at(-1).status, "error");
  assert.throws(() => C.dispatch({ type: "missing" }), /Unknown command/);
});

test("non-JSON inputs are rejected before any authority mutation", () => {
  const C = load(); let calls = 0;
  C.register("op", () => { calls++; });
  const cycle = { type: "op" }; cycle.self = cycle;
  const getter = { type: "op", get value() { throw new Error("must not run"); } };
  const sparse = []; sparse.length = 1;
  const extra = [1]; extra.note = "lost on serialization";
  const customJSON = { type: "op" };
  Object.defineProperty(customJSON, "toJSON", { value() { calls++; return { type: "op" }; } });
  const hiddenGetter = { type: "op" };
  Object.defineProperty(hiddenGetter, "hidden", { get() { calls++; return 1; } });
  const inheritedJSON = Object.assign(Object.create(Object.assign(Object.create(null), { toJSON() { calls++; return { type: "op" }; } })), { type: "op" });
  const inheritedArrayJSON = [1];
  Object.setPrototypeOf(inheritedArrayJSON, Object.create({ toJSON() { calls++; return [99]; } }));
  assert.throws(() => C.dispatch({ type: "op", value: inheritedArrayJSON }));
  for (const cmd of [null, [], {}, { type: "op", fn() {} }, { type: "op", value: undefined }, { type: "op", value: Infinity }, { type: "op", value: NaN }, { type: "op", value: new Date() }, { type: "op", value: sparse }, { type: "op", value: extra }, cycle, getter, customJSON, hiddenGetter, inheritedJSON, JSON.parse('{"type":"op","__proto__":{"evil":true}}')]) {
    assert.throws(() => C.dispatch(cmd), undefined, JSON.stringify(Object.keys(cmd || {})));
  }
  assert.equal(calls, 0);
  assert.equal(C.history().length, 0);
});

test("asynchronous handlers record completion or rejection without swallowing failure", async () => {
  const C = load();
  C.register("async", async cmd => { if (cmd.fail) throw new Error("async failure"); return { value: cmd.value }; });
  assert.deepEqual(plain(await C.dispatch({ type: "async", value: 7 })), { value: 7 });
  await assert.rejects(C.dispatch({ type: "async", fail: true }), /async failure/);
  assert.deepEqual(plain(C.history().map(e => e.status)), ["ok", "error"]);
});

test("view projection is detached and does not replace complete authoritative state", () => {
  const C = load(), authority = { units: [{ id: "hero", hp: 0, shp: 12 }], logs: ["secret"] };
  const view = C.projectView(authority, data => { delete data.units[0].shp; data.logs = []; return data; }, "player");
  assert.equal(authority.units[0].shp, 12);
  assert.deepEqual(authority.logs, ["secret"]);
  assert.equal(view.units[0].shp, undefined);
  C.register("op", () => true);
  assert.throws(() => C.dispatch({ type: "op" }, view), /display views/);
  assert.equal(C.dispatch({ type: "op" }, authority), true);
});

test("unit ownership supports multiple heroes per operator and dynamic weapons without save fields", () => {
  const C = load(), heroes = [{ id: "a", kit: "ruby" }, { id: "b", kit: "hiaki" }, { id: "c", kit: "yuito" }], assignments = { a: "gm", b: "gm", c: "player" };
  const original = JSON.stringify(heroes);
  assert.deepEqual(plain(C.unitRoster(heroes, assignments)).map(x => x.operatorId), ["gm", "gm", "player"]);
  const units = [...heroes, { id: "wa", weaponOf: "ruby" }, { id: "wc", weaponOf: "c" }, { id: "wb1", weaponOf: "hiaki" }, { id: "wb2", weaponOf: "hiaki" }, { id: "absent", weaponOf: "a", hidden: true }];
  assert.deepEqual(plain(C.unitRoster(units, assignments)).map(x => [x.unitId, x.operatorId]), [["a", "gm"], ["b", "gm"], ["c", "player"], ["wa", "gm"], ["wc", "player"], ["wb1", "gm"], ["wb2", "gm"]]);
  units[3]._removed = true;
  assert.equal(C.unitRoster(units, assignments).some(x => x.unitId === "wa"), false);
  const prior = ["c", "wa", "b", "a"];
  assert.deepEqual(plain(C.unitRoster(units, assignments, prior)).map(x => x.unitId), ["c", "b", "a", "wc", "wb1", "wb2"], "existing unit slots survive; absent weapon leaves; new weapons append");
  assert.deepEqual(prior, ["c", "wa", "b", "a"], "previous order remains caller-owned");
  assert.equal(JSON.stringify(heroes), original);
  for (const type of ["orderMove", "orderSwapAccept"]) assert.throws(() => C.dispatch({ type, actor: "a" }), /reserved for D2/);
});

test("debug export is bounded JSON and does not persist command history", () => {
  const C = load(); C.register("op", cmd => cmd.n);
  for (let n = 0; n < 1003; n++) C.dispatch({ type: "op", n });
  const dump = JSON.parse(C.exportLog());
  assert.equal(dump.entries.length, 1000);
  assert.equal(dump.entries[0].seq, 4);
  assert.equal(dump.entries.at(-1).result, 1002);
  C.clearLog(); assert.equal(C.history().length, 0);
});
