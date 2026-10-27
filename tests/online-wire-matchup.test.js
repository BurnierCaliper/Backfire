const test = require("node:test"), assert = require("node:assert/strict");
const OnlineWire = require("../online-wire.js");
const top = { weather: "rain", chart: { fire: { water: 2, ice: 1 }, water: { fire: 0.5 } }, opt: { envX: 1, phaseStep: null }, unitId: null, unitName: null, zone: null, iceZones: [], iceLabel: "" };
const unit = (id, extra) => ({ ...JSON.parse(JSON.stringify(top)), unitId: id, unitName: id.toUpperCase(), zone: 2, ...extra });
const matchup = () => ({ ...JSON.parse(JSON.stringify(top)), units: {
  a: unit("a"), b: unit("b", { chart: { fire: { water: 4, ice: 1 }, water: { fire: 0.5 } }, opt: { envX: 2, phaseStep: null, field: { ice: true, zone: 2 } } }),
  c: (() => { const u = unit("c"); delete u.iceLabel; return u; })() } });
const packet = (seq, m, type = "result") => ({ displayOnly: true, protocol: 1, type, seq, messages: [], publicLogs: [], matchup: m });

test("matchup units are sent as diffs from the top-level table and rebuilt exactly", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), m = matchup();
  const wire = host.pack(packet(1, m));
  assert.equal(wire.matchup.units, undefined);
  assert.deepEqual(wire.matchup.unitsDiff.a, { set: { unitId: "a", unitName: "A", zone: 2 } });
  assert.deepEqual(wire.matchup.unitsDiff.b.sub.chart, { sub: { fire: { set: { water: 4 } } } });
  assert.deepEqual(wire.matchup.unitsDiff.c.unset, ["iceLabel"]);
  assert.ok(JSON.stringify(wire.matchup).length < JSON.stringify(m).length);
  assert.deepEqual(client.unpack(wire).matchup, m);
});

test("unchanged matchup is omitted; client keeps the last one; changes and resync send it again", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), m = matchup();
  assert.deepEqual(client.unpack(host.pack(packet(1, m))).matchup, m);
  const same = host.pack(packet(2, matchup()));
  assert.equal("matchup" in same, false); assert.equal(same.matchupUnchanged, true);
  const got = client.unpack(same);
  assert.deepEqual(got.matchup, m); assert.equal("matchupUnchanged" in got, false);
  const changed = matchup(); changed.weather = "snow";
  const w3 = host.pack(packet(3, changed));
  // #340 第 9 条：顶层变了也可以走 matchupDelta（比整张短），解包后仍和整包一样
  assert.ok(w3.matchup || w3.matchupDelta, "变化时要么整张要么差量");
  assert.deepEqual(client.unpack(w3).matchup, changed);
  const w4 = host.pack(packet(4, changed, "resync")); assert.ok(w4.matchup, "resync always carries the full matchup");
  assert.deepEqual(client.unpack(w4).matchup, changed);
  const w5 = host.pack(packet(5, null)); assert.equal(w5.matchup, null);
  assert.equal(client.unpack(w5).matchup, null);
});

test("an omitted matchup without a baseline is rejected (forces a resync)", () => {
  const host = OnlineWire.create(), m = matchup();
  host.pack(packet(1, m)); const w = host.pack(packet(2, m));
  assert.throws(() => OnlineWire.create().unpack(w), /baseline/);
});

test("#340 第 9 条：只有个别单位克制表变了时发 matchupDelta，解包后和整包一样", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), m = matchup();
  assert.deepEqual(client.unpack(host.pack(packet(1, m))).matchup, m);
  const changed = matchup();
  changed.units.a.zone = 3;
  const wire = host.pack(packet(2, changed));
  assert.equal(wire.matchup, undefined, "应走差量而不是整张");
  assert.ok(wire.matchupDelta, "带 matchupDelta");
  assert.ok(wire.matchupDelta.changed.a);
  assert.equal(wire.matchupDelta.changed.b, undefined, "没变的单位不发");
  assert.deepEqual(client.unpack(wire).matchup, changed);
});

test("#340 第 9 条：state.units 按 id 发 unitsDelta，解包后和整包一样", () => {
  const host = OnlineWire.create(), client = OnlineWire.create();
  const units = (zoneA) => [
    { id: "a", name: "A", zone: zoneA, isPlayer: true },
    { id: "b", name: "B", zone: 2, isPlayer: false }
  ];
  const packState = (seq, list) => host.pack({ displayOnly: true, protocol: 1, type: "result", seq, messages: [], publicLogs: [], state: { units: list, turnNo: 1 } });
  const first = packState(1, units(1));
  assert.ok(first.state.units);
  assert.deepEqual(client.unpack(first).state.units, units(1));
  const wire = packState(2, units(2));
  assert.ok(wire.unitsDelta, "第二包应走 unitsDelta");
  assert.equal(wire.state.units, undefined);
  assert.deepEqual(client.unpack(wire).state.units, units(2));
});

// （新）#340 第 9 条差量补测：增删单位、顶层和单位一起变、非对象条目、没有基线、resync、格式不对的包
test("#340 第 9 条：matchupDelta 增删单位、顶层和单位一起变、{ value } 条目都能还原", () => {
  const host = OnlineWire.create(), client = OnlineWire.create(), m = matchup();
  for (let i = 0; i < 8; i++) m.units["x" + i] = unit("x" + i);
  client.unpack(host.pack(packet(1, m)));
  const next = JSON.parse(JSON.stringify(m));
  delete next.units.b;                             // 去掉一个
  next.units.n = unit("n", { zone: 3 });           // 新增一个
  next.units.a.zone = 3; next.weather = "snow";    // 顶层和单位一起变
  next.units.x0 = null;                            // 非对象条目走 { value }
  const wire = host.pack(packet(2, next));
  assert.ok(wire.matchupDelta, "应走差量");
  assert.deepEqual(wire.matchupDelta.removed, ["b"]);
  assert.ok(wire.matchupDelta.top && wire.matchupDelta.changed.n && wire.matchupDelta.changed.a);
  assert.deepEqual(wire.matchupDelta.changed.x0, { value: null });
  assert.equal("order" in wire.matchupDelta, false, "不发单位顺序");
  assert.deepEqual(client.unpack(wire).matchup, next);
});

test("#340 第 9 条：没有基线时 matchupDelta / unitsDelta 都报 baseline（玩家端去要 resync）；resync 一律整份", () => {
  const host = OnlineWire.create(), m = matchup();
  const units = zone => [{ id: "a", name: "A", zone, isPlayer: true }, { id: "b", name: "B", zone: 2, isPlayer: false }];
  const full = (seq, mm, list, type = "result") => ({ ...packet(seq, mm, type), state: { units: list, turnNo: 1 } });
  host.pack(full(1, m, units(1)));
  const changed = matchup(); changed.units.a.zone = 3;
  const wire = host.pack(full(2, changed, units(2)));
  assert.ok(wire.matchupDelta && wire.unitsDelta);
  assert.throws(() => OnlineWire.create().unpack(wire), /baseline/);
  const noMatchup = { ...wire }; delete noMatchup.matchupDelta;
  assert.throws(() => OnlineWire.create().unpack(noMatchup), /baseline/);
  const rs = host.pack(full(3, changed, units(3), "resync"));
  assert.ok(rs.matchup && Array.isArray(rs.state.units), "resync 带整张克制表和整份 state.units");
  assert.equal("matchupDelta" in rs || "unitsDelta" in rs, false);
  assert.deepEqual(OnlineWire.create().unpack(rs).state.units, units(3));
});

test("#340 第 9 条：格式不对的 matchupDelta 不收（去掉不存在的单位、带 order、和 matchupUnchanged 同时出现）", () => {
  const host = OnlineWire.create(), m = matchup();
  const base = host.pack(packet(1, m));
  const changed = matchup(); changed.units.a.zone = 3;
  const wire = host.pack(packet(2, changed));
  assert.ok(wire.matchupDelta);
  const bad = patch => { const client = OnlineWire.create(); client.unpack(base); return () => client.unpack({ ...wire, ...patch(JSON.parse(JSON.stringify(wire))) }); };
  assert.throws(bad(w => ({ matchupDelta: { ...w.matchupDelta, removed: ["nobody"] } })), /invalid matchup/);
  assert.throws(bad(w => ({ matchupDelta: { ...w.matchupDelta, order: ["a", "b", "c"] } })), /invalid matchup/);
  assert.throws(bad(() => ({ matchupUnchanged: true })), /invalid matchup/);
  const ok = OnlineWire.create(); ok.unpack(base);
  assert.deepEqual(ok.unpack(wire).matchup, changed);
});
