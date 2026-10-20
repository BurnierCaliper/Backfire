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
  const w3 = host.pack(packet(3, changed)); assert.ok(w3.matchup);
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
