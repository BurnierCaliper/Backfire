/* D3 display-only wire deltas. Use one instance per recipient on the host and
 * one on each client, AFTER privacy projection and BEFORE display playback.
 * Sequence/order checks belong to the coordinator, before calling unpack(). */
(function (root) {
  "use strict";
  const FORMAT = "backfire-display-delta-v1", histories = ["messages", "publicLogs"];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const forbidden = key => ["__proto__", "constructor", "prototype"].includes(key);
  function fail(message) { throw new TypeError("OnlineWire: " + message); }
  // Never run toJSON/getters, tolerate cross-realm ordinary JSON objects, and
  // return fresh containers. A wire codec must not touch host authority refs.
  function clone(value, ancestors = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || ancestors.has(value)) fail("requires finite, acyclic JSON data");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (proto) {
      const ctor = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (!ctor || typeof ctor.value !== "function" || ctor.value.name !== (array ? "Array" : "Object") || ctor.value.prototype !== proto) fail("requires plain JSON containers");
      for (let p = proto; p; p = Object.getPrototypeOf(p)) if (own(p, "toJSON")) fail("inherited toJSON is not allowed");
    }
    if (Object.getOwnPropertySymbols(value).length) fail("symbol keys are not allowed");
    ancestors.add(value);
    const result = array ? [] : {};
    for (const key of Object.getOwnPropertyNames(value)) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d.enumerable || !own(d, "value") || forbidden(key)) fail("requires plain enumerable data properties");
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) fail("invalid array property");
      result[key] = clone(d.value, ancestors);
    }
    if (array) for (let i = 0; i < value.length; i++) if (!own(value, i)) fail("array holes are not allowed");
    ancestors.delete(value); return result;
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function packetData(input) {
    const packet = clone(input);
    if (!object(packet) || packet.displayOnly !== true) fail("only projected displayOnly packets are allowed");
    return packet;
  }
  function unitsById(units) {
    if (!Array.isArray(units)) fail("snapshot must be an array");
    const map = new Map();
    for (const unit of units) {
      if (!object(unit) || typeof unit.id !== "string" || !unit.id || map.has(unit.id)) fail("snapshot unit IDs must be unique strings");
      map.set(unit.id, unit);
    }
    return map;
  }
  function snapDelta(before, after) {
    const old = unitsById(before), next = unitsById(after), changed = [], removedUnitIds = [];
    for (const unit of after) {
      const prev = old.get(unit.id), set = {}, unset = [];
      for (const key of Object.keys(unit)) if (key !== "id" && (!prev || !own(prev, key) || !equal(prev[key], unit[key]))) set[key] = unit[key];
      if (prev) for (const key of Object.keys(prev)) if (key !== "id" && !own(unit, key)) unset.push(key);
      if (!prev || Object.keys(set).length || unset.length) changed.push({ id: unit.id, set, ...(unset.length ? { unset } : {}) });
    }
    for (const unit of before) if (!next.has(unit.id)) removedUnitIds.push(unit.id);
    const out = {};
    if (changed.length) out.changed = changed;
    if (removedUnitIds.length) out.removedUnitIds = removedUnitIds;
    if (!equal(before.map(u => u.id), after.map(u => u.id))) out.order = after.map(u => u.id);
    return out;
  }
  function applySnap(before, delta) {
    if (!object(delta) || Object.keys(delta).some(k => !["changed", "removedUnitIds", "order"].includes(k))) fail("invalid snapshot delta");
    const map = unitsById(clone(before)), removed = delta.removedUnitIds || [], changed = delta.changed || [];
    if (!Array.isArray(removed) || !Array.isArray(changed) || new Set(removed).size !== removed.length || removed.some(id => typeof id !== "string" || !map.has(id))) fail("invalid removed unit IDs");
    for (const id of removed) map.delete(id);
    const seen = new Set();
    for (const row of changed) {
      if (!object(row) || Object.keys(row).some(k => !["id", "set", "unset"].includes(k)) || typeof row.id !== "string" || !row.id || seen.has(row.id) || removed.includes(row.id) || !object(row.set)) fail("invalid changed unit");
      seen.add(row.id);
      if (own(row.set, "id")) fail("delta cannot overwrite unit identity");
      const unit = map.get(row.id) || { id: row.id }, unset = row.unset || [];
      if (!Array.isArray(unset) || new Set(unset).size !== unset.length || unset.some(k => typeof k !== "string" || k === "id" || forbidden(k) || own(row.set, k))) fail("invalid removed unit fields");
      for (const key of unset) delete unit[key];
      Object.assign(unit, clone(row.set)); map.set(row.id, unit);
    }
    const order = own(delta, "order") ? delta.order : [...map.keys()];
    if (!Array.isArray(order) || order.length !== map.size || new Set(order).size !== order.length || order.some(id => typeof id !== "string" || !map.has(id))) fail("invalid snapshot order");
    return order.map(id => map.get(id));
  }
  function packTape(tape) {
    if (!Array.isArray(tape)) fail("tape must be an array");
    let previous = null;
    return tape.map(event => {
      if (!object(event)) fail("tape event must be an object");
      if (own(event, "snapDelta")) fail("packet is already packed");
      if (!own(event, "snap")) return event;
      unitsById(event.snap);
      const result = { ...event }, next = event.snap;
      if (previous !== null) {
        const delta = snapDelta(previous, next);
        // A wholly replaced snapshot may be smaller as a full frame. Either
        // representation establishes the base for the next event in this tape.
        if (JSON.stringify(delta).length < JSON.stringify(next).length) { delete result.snap; result.snapDelta = delta; }
      }
      previous = next; return result;
    });
  }
  function unpackTape(tape) {
    if (!Array.isArray(tape)) fail("tape must be an array");
    let previous = null;
    return tape.map(event => {
      if (!object(event) || own(event, "snap") && own(event, "snapDelta")) fail("invalid tape event");
      const result = { ...event };
      if (own(event, "snap")) { unitsById(event.snap); previous = clone(event.snap); result.snap = clone(previous); }
      else if (own(event, "snapDelta")) {
        if (previous === null) fail("snapshot delta has no full base in this packet");
        previous = applySnap(previous, event.snapDelta); delete result.snapDelta; result.snap = clone(previous);
      }
      return result;
    });
  }
  function overlap(before, after) {
    for (let length = Math.min(before.length, after.length); length > 0; length--) {
      if (equal(before.slice(-length), after.slice(0, length))) return length;
    }
    return 0;
  }
  // 克制表（packet.matchup）：units[id] 只发和顶层表不同的部分（diffNode），整张表没变就不发（matchupUnchanged）
  const plain = v => object(v) && !Array.isArray(v);
  function diffNode(base, value) {
    const set = {}, sub = {}, unset = [];
    for (const key of Object.keys(value)) {
      if (own(base, key) && equal(base[key], value[key])) continue;
      if (own(base, key) && plain(base[key]) && plain(value[key])) sub[key] = diffNode(base[key], value[key]);
      else set[key] = value[key];
    }
    for (const key of Object.keys(base)) if (!own(value, key)) unset.push(key);
    const out = {};
    if (Object.keys(set).length) out.set = set;
    if (Object.keys(sub).length) out.sub = sub;
    if (unset.length) out.unset = unset;
    return out;
  }
  function applyNode(base, node) {
    if (!plain(base) || !plain(node)) fail("invalid matchup diff");
    const out = clone(base);
    if (own(node, "unset")) { if (!Array.isArray(node.unset)) fail("invalid matchup diff"); for (const key of node.unset) delete out[key]; }
    if (own(node, "set")) { if (!plain(node.set)) fail("invalid matchup diff"); for (const key of Object.keys(node.set)) out[key] = clone(node.set[key]); }
    if (own(node, "sub")) { if (!plain(node.sub)) fail("invalid matchup diff"); for (const key of Object.keys(node.sub)) out[key] = applyNode(own(out, key) ? out[key] : {}, node.sub[key]); }
    return out;
  }
  function packMatchup(m) {
    if (!plain(m) || !plain(m.units)) return m;
    const { units, ...top } = m, out = { ...top, unitsDiff: {} };
    for (const id of Object.keys(units)) out.unitsDiff[id] = plain(units[id]) ? diffNode(top, units[id]) : { value: units[id] };
    return out;
  }
  function unpackMatchup(m) {
    if (!plain(m) || !own(m, "unitsDiff")) return m;
    if (own(m, "units") || !plain(m.unitsDiff)) fail("invalid matchup diff");
    const { unitsDiff, ...top } = m, units = {};
    for (const id of Object.keys(unitsDiff)) units[id] = own(unitsDiff[id], "value") ? unitsDiff[id].value : applyNode(top, unitsDiff[id]);
    return { ...top, units };
  }
  function create() {
    let encoded = {}, decoded = {}, hasEncoded = false, hasDecoded = false;
    let sentMatchup = null, hasSentMatchup = false, gotMatchup = null, hasGotMatchup = false;
    function reset() { encoded = {}; decoded = {}; hasEncoded = hasDecoded = false; sentMatchup = gotMatchup = null; hasSentMatchup = hasGotMatchup = false; }
    function pack(input) {
      const packet = packetData(input);
      if (!["result", "resync"].includes(packet.type)) return packet;
      if (own(packet, "wireFormat") || own(packet, "historyFull") || own(packet, "historyLengths") || own(packet, "matchupUnchanged")) fail("packet is already packed");
      let full = !hasEncoded || packet.type === "resync";
      const lengths = {}, deltas = {}, next = { ...encoded };
      for (const key of histories) if (own(packet, key)) {
        if (!Array.isArray(packet[key])) fail(key + " must be an array");
        const old = encoded[key] || [], current = packet[key], common = overlap(old, current);
        lengths[key] = current.length; next[key] = clone(current);
        if (!common && old.length && current.length) full = true;
        deltas[key] = current.slice(common);
      }
      const result = { ...packet, wireFormat: FORMAT, historyFull: full, historyLengths: lengths };
      for (const key of histories) if (own(packet, key)) result[key] = full ? packet[key] : deltas[key];
      if (own(packet, "tape")) result.tape = packTape(packet.tape);
      let nextMatchup = sentMatchup, nextHasMatchup = hasSentMatchup;
      if (own(packet, "matchup")) {
        const json = JSON.stringify(packet.matchup);
        if (hasSentMatchup && packet.type !== "resync" && json === sentMatchup) { delete result.matchup; result.matchupUnchanged = true; }
        else result.matchup = packMatchup(packet.matchup);
        nextMatchup = json; nextHasMatchup = true;
      }
      sentMatchup = nextMatchup; hasSentMatchup = nextHasMatchup;
      // Commit only after every field was checked and encoded successfully.
      encoded = full ? Object.fromEntries(histories.filter(key => own(packet, key)).map(key => [key, next[key]])) : next;
      hasEncoded = true; return result;
    }
    function unpack(input) {
      const packet = packetData(input);
      if (!["result", "resync"].includes(packet.type)) return packet;
      const packed = own(packet, "wireFormat");
      if (packed && packet.wireFormat !== FORMAT) fail("unknown wire format");
      if (!packed && (own(packet, "historyFull") || own(packet, "historyLengths"))) fail("wire metadata without a format");
      const full = !packed || packet.historyFull;
      if (packed && (typeof packet.historyFull !== "boolean" || !object(packet.historyLengths) || Object.keys(packet.historyLengths).some(k => !histories.includes(k)))) fail("invalid history metadata");
      if (!full && (!hasDecoded || packet.type === "resync")) fail("history delta requires a full baseline");
      const next = full ? {} : { ...decoded }, result = { ...packet };
      for (const key of histories) {
        if (!own(packet, key)) { if (packed && own(packet.historyLengths, key)) fail("missing history field"); continue; }
        if (!Array.isArray(packet[key])) fail(key + " must be an array");
        const length = packed ? packet.historyLengths[key] : packet[key].length;
        if (!Number.isSafeInteger(length) || length < 0 || length > 10000) fail("invalid history length");
        const rows = full ? packet[key] : [...(decoded[key] || []), ...packet[key]];
        if (length > rows.length || full && length !== rows.length) fail("history delta cannot reconstruct the declared length");
        result[key] = length ? clone(rows.slice(-length)) : []; next[key] = clone(result[key]);
      }
      if (own(packet, "tape")) result.tape = unpackTape(packet.tape);
      let nextGot = gotMatchup, nextHasGot = hasGotMatchup;
      if (own(packet, "matchupUnchanged")) {
        if (packet.matchupUnchanged !== true || own(packet, "matchup") || !packed) fail("invalid matchup metadata");
        if (!hasGotMatchup || packet.type === "resync") fail("matchup omission requires a baseline");
        result.matchup = clone(gotMatchup); delete result.matchupUnchanged;
      } else if (own(packet, "matchup")) { result.matchup = unpackMatchup(packet.matchup); nextGot = clone(result.matchup); nextHasGot = true; }
      delete result.wireFormat; delete result.historyFull; delete result.historyLengths;
      decoded = next; hasDecoded = true; gotMatchup = nextGot; hasGotMatchup = nextHasGot; return result;
    }
    return { pack, unpack, reset };
  }
  const api = { FORMAT, create };
  root.OnlineWire = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
