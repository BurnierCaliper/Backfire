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
  // 克制表逐单位差量：顶层（除 units）只发变了的键（top），单位只发新增 / 变了的（按新顶层 diffNode 压过）和去掉的单位 id（#340 第 9 条）。
  // 不发单位的先后顺序：玩家端（matchup-ui.js）只按 id 取 m.units[unitId]，新单位接在最后
  function matchupDelta(sentJson, m) {
    let prev; try { prev = JSON.parse(sentJson); } catch (_) { return null; }
    if (!plain(prev) || !plain(prev.units) || !plain(m) || !plain(m.units)) return null;
    const { units: pu, ...ptop } = prev, { units, ...top } = m;
    const changed = {}, removed = [];
    for (const id of Object.keys(units)) if (!own(pu, id) || !equal(pu[id], units[id])) changed[id] = plain(units[id]) ? diffNode(top, units[id]) : { value: units[id] };
    for (const id of Object.keys(pu)) if (!own(units, id)) removed.push(id);
    const out = { changed };
    if (!equal(ptop, top)) out.top = diffNode(ptop, top);
    if (removed.length) out.removed = removed;
    return out;
  }
  function applyMatchupDelta(base, d) {
    if (!plain(d) || !plain(d.changed) || own(d, "removed") && !Array.isArray(d.removed) || own(d, "order") || !plain(base.units)) fail("invalid matchup delta");
    const { units: bu, ...oldTop } = base, units = clone(bu), top = own(d, "top") ? applyNode(oldTop, d.top) : oldTop;
    // 去掉的单位必须是上一张里有的（和 applySnap 一样严）：写错了就让玩家端要 resync
    for (const id of d.removed || []) { if (typeof id !== "string" || forbidden(id) || !own(units, id) || own(d.changed, id)) fail("invalid matchup delta"); delete units[id]; }
    for (const id of Object.keys(d.changed)) { if (forbidden(id)) fail("invalid matchup delta"); units[id] = own(d.changed[id], "value") ? clone(d.changed[id].value) : applyNode(top, d.changed[id]); }
    return { ...clone(top), units };
  }
  function create() {
    let encoded = {}, decoded = {}, hasEncoded = false, hasDecoded = false;
    let sentMatchup = null, hasSentMatchup = false, gotMatchup = null, hasGotMatchup = false;
    let sentRest = null, hasSentRest = false, gotRest = null, hasGotRest = false;
    let sentLore = null, hasSentLore = false, gotLore = null, hasGotLore = false;
    let sentChat = null, hasSentChat = false, gotChat = null, hasGotChat = false;
    // 克制表逐单位（#340 第 9 条）、state.units 按 id（第 9 条）的上一份
    let sentUnits = null, gotUnits = null;
    function reset() { sentUnits = gotUnits = null; encoded = {}; decoded = {}; hasEncoded = hasDecoded = false; sentMatchup = gotMatchup = sentRest = gotRest = sentLore = gotLore = sentChat = gotChat = null; hasSentMatchup = hasGotMatchup = hasSentRest = hasGotRest = hasSentLore = hasGotLore = hasSentChat = hasGotChat = false; }
    function pack(input) {
      const packet = packetData(input);
      if (!["result", "resync"].includes(packet.type)) return packet;
      if (own(packet, "wireFormat") || own(packet, "historyFull") || own(packet, "historyLengths") || own(packet, "matchupUnchanged") || own(packet, "restUnchanged") || own(packet, "loreUnchanged") || own(packet, "loreDelta") || own(packet, "matchupDelta") || own(packet, "unitsDelta") || own(packet, "chatLength")) fail("packet is already packed");
      let full = !hasEncoded || packet.type === "resync";
      // 小队聊天（view.chat，最近 300 条；#340 第 8 条：以前每包整份带着，300 条聊天光这一项就 40 KB）：和 messages 一样只发新增的那一截，
      // 总条数写在 chatLength。不放进 historyLengths——旧版玩家页面只认 messages / publicLogs，多一个键整包解不开；单独一个字段，旧页面只是少看到前面的聊天
      const chat = object(packet.view) && own(packet.view, "chat") ? packet.view.chat : undefined;
      if (chat !== undefined && !Array.isArray(chat)) fail("view.chat must be an array");
      const chatCommon = chat !== undefined && hasSentChat ? overlap(sentChat, chat) : 0;
      if (chat !== undefined && hasSentChat && !chatCommon && sentChat.length && chat.length) full = true;
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
      if (chat !== undefined) { result.chatLength = chat.length; if (!full) result.view = { ...packet.view, chat: chat.slice(chatCommon) }; }
      if (own(packet, "tape")) result.tape = packTape(packet.tape);
      let nextMatchup = sentMatchup, nextHasMatchup = hasSentMatchup;
      if (own(packet, "matchup")) {
        const json = JSON.stringify(packet.matchup);
        if (hasSentMatchup && packet.type !== "resync" && json === sentMatchup) { delete result.matchup; result.matchupUnchanged = true; }
        else {
          // 顶层（环境）没变、只有几名单位的表变了（移动、失衡、濒死……）：只发变了的单位（matchupDelta，#340 第 9 条），比整张短才用
          const delta = hasSentMatchup && packet.type !== "resync" ? matchupDelta(sentMatchup, packet.matchup) : null;
          const packed = packMatchup(packet.matchup);
          if (delta && JSON.stringify(delta).length < JSON.stringify(packed).length) { delete result.matchup; result.matchupDelta = delta; }
          else result.matchup = packed;
        }
        nextMatchup = json; nextHasMatchup = true;
      }
      sentMatchup = nextMatchup; hasSentMatchup = nextHasMatchup;
      // 长休结算（跑团 packet.rest，issue #216）：长休过一次以后每包都带着同一份，和上一包一样就只带 restUnchanged；
      // null（还没长休）比这个标记还短，照发；resync 一律整份发
      if (own(packet, "rest")) {
        const json = JSON.stringify(packet.rest);
        if (hasSentRest && packet.type !== "resync" && packet.rest !== null && json === sentRest) { delete result.rest; result.restUnchanged = true; }
        sentRest = json; hasSentRest = true;
      }
      // 角色资料索引（packet.lore，issue #264）：每包都带着同一份，和上一包一样只带 loreUnchanged；
      // 改了（发布、编辑、撤回）且两份都是列表时只发改了的条目（loreDelta：和演出快照同一套按 id 的差异），比整份短才用。
      // null（联机单局）、resync 一律整份发
      let nextLore = sentLore, nextHasLore = hasSentLore;
      if (own(packet, "lore")) {
        const lore = packet.lore, base = hasSentLore && packet.type !== "resync" && Array.isArray(lore) && Array.isArray(sentLore) ? sentLore : null;
        if (base && equal(base, lore)) { delete result.lore; result.loreUnchanged = true; }
        else if (base) {
          // 条目 id 不唯一之类做不了差异的（投影后不会出现），照整份发，不让一包资料卡住整个发包
          let delta = null; try { delta = snapDelta(base, lore); } catch (_) { delta = null; }
          if (delta && JSON.stringify(delta).length < JSON.stringify(lore).length) { delete result.lore; result.loreDelta = delta; }
        }
        nextLore = clone(lore); nextHasLore = true;
      }
      // state.units（#340 第 9 条）：按 id 只发变了的字段（和演出快照同一套 snapDelta）；比整份短才用，resync 一律整份
      let nextUnits = sentUnits;
      if (own(packet, "state") && object(packet.state) && Array.isArray(packet.state.units)) {
        const units = packet.state.units;
        if (!full && Array.isArray(sentUnits)) {
          let delta = null; try { delta = snapDelta(sentUnits, units); } catch (_) { delta = null; }
          if (delta && JSON.stringify(delta).length < JSON.stringify(units).length) { const { units: _u, ...rest } = packet.state; result.state = rest; result.unitsDelta = delta; }
        }
        try { unitsById(units); nextUnits = clone(units); } catch (_) { nextUnits = null; }
      } else nextUnits = null;
      // Commit only after every field was checked and encoded successfully.
      sentUnits = nextUnits;
      encoded = full ? Object.fromEntries(histories.filter(key => own(packet, key)).map(key => [key, next[key]])) : next;
      sentLore = nextLore; hasSentLore = nextHasLore;
      if (chat !== undefined) { sentChat = clone(chat); hasSentChat = true; } else if (full) { sentChat = null; hasSentChat = false; }
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
      // 小队聊天：有 chatLength 就把这一截接在上一次收到的后面，取最后 chatLength 条；没有（没打包的包、旧版房主）就是整份
      let nextChat = gotChat, nextHasChat = hasGotChat;
      const chat = object(packet.view) && own(packet.view, "chat") ? packet.view.chat : undefined;
      if (chat !== undefined && !Array.isArray(chat)) fail("view.chat must be an array");
      if (own(packet, "chatLength")) {
        const length = packet.chatLength;
        if (!packed) fail("chat metadata without a format");
        if (chat === undefined) fail("missing chat history");
        if (!Number.isSafeInteger(length) || length < 0 || length > 10000) fail("invalid chat length");
        // 之前的包都没带聊天：房主那边也没有基准，这一截就是整份（下面照样核对条数）
        const rows = full ? chat : [...(hasGotChat ? gotChat : []), ...chat];
        if (length > rows.length || full && length !== rows.length) fail("chat delta cannot reconstruct the declared length");
        result.view = { ...packet.view, chat: length ? clone(rows.slice(-length)) : [] };
        nextChat = clone(result.view.chat); nextHasChat = true;
      } else if (chat !== undefined) { nextChat = clone(chat); nextHasChat = true; }
      else if (full) { nextChat = null; nextHasChat = false; }
      delete result.chatLength;
      if (own(packet, "tape")) result.tape = unpackTape(packet.tape);
      let nextGot = gotMatchup, nextHasGot = hasGotMatchup;
      if (own(packet, "matchupUnchanged")) {
        if (packet.matchupUnchanged !== true || own(packet, "matchup") || own(packet, "matchupDelta") || !packed) fail("invalid matchup metadata");
        if (!hasGotMatchup || packet.type === "resync") fail("matchup omission requires a baseline");
        result.matchup = clone(gotMatchup); delete result.matchupUnchanged;
      } else if (own(packet, "matchupDelta")) {
        if (!packed || own(packet, "matchup")) fail("invalid matchup metadata");
        if (!hasGotMatchup || !plain(gotMatchup) || packet.type === "resync") fail("matchup delta requires a baseline");
        result.matchup = applyMatchupDelta(gotMatchup, packet.matchupDelta); delete result.matchupDelta; nextGot = clone(result.matchup);
      } else if (own(packet, "matchup")) { result.matchup = unpackMatchup(packet.matchup); nextGot = clone(result.matchup); nextHasGot = true; }
      // state.units 差量：在上一包的单位上按 id 改
      let nextGotUnits = null;
      if (own(packet, "unitsDelta")) {
        if (!packed || !object(packet.state) || own(packet.state, "units")) fail("invalid units delta");
        if (!Array.isArray(gotUnits) || packet.type === "resync") fail("units delta requires a baseline");
        result.state = { ...packet.state, units: applySnap(gotUnits, packet.unitsDelta) }; delete result.unitsDelta;
        nextGotUnits = clone(result.state.units);
      } else if (object(packet.state) && Array.isArray(packet.state.units)) { try { unitsById(packet.state.units); nextGotUnits = clone(packet.state.units); } catch (_) { nextGotUnits = null; } }
      // 长休结算：restUnchanged 用上一次收到的那份还原（玩家端看到的 packet.rest 和整份发时一模一样）
      let nextRest = gotRest, nextHasRest = hasGotRest;
      if (own(packet, "restUnchanged")) {
        if (packet.restUnchanged !== true || own(packet, "rest") || !packed) fail("invalid rest metadata");
        if (!hasGotRest || packet.type === "resync") fail("rest omission requires a baseline");
        result.rest = clone(gotRest); delete result.restUnchanged;
      } else if (own(packet, "rest")) { nextRest = clone(packet.rest); nextHasRest = true; }
      // 角色资料索引：loreUnchanged 用上一次收到的那份还原，loreDelta 在上一份上按 id 改；玩家端看到的 packet.lore 和整份发时一模一样
      let nextLore = gotLore, nextHasLore = hasGotLore;
      if (own(packet, "loreUnchanged") || own(packet, "loreDelta")) {
        if (!packed || own(packet, "lore") || own(packet, "loreUnchanged") && (packet.loreUnchanged !== true || own(packet, "loreDelta"))) fail("invalid lore metadata");
        if (!hasGotLore || !Array.isArray(gotLore) || packet.type === "resync") fail("lore omission requires a baseline");
        result.lore = own(packet, "loreDelta") ? applySnap(gotLore, packet.loreDelta) : clone(gotLore);
        delete result.loreUnchanged; delete result.loreDelta;
        nextLore = clone(result.lore);
      } else if (own(packet, "lore")) { nextLore = clone(packet.lore); nextHasLore = true; }
      delete result.wireFormat; delete result.historyFull; delete result.historyLengths;
      gotUnits = nextGotUnits; decoded = next; hasDecoded = true; gotMatchup = nextGot; hasGotMatchup = nextHasGot; gotRest = nextRest; hasGotRest = nextHasRest; gotLore = nextLore; hasGotLore = nextHasLore;
      gotChat = nextChat; hasGotChat = nextHasChat; return result;
    }
    return { pack, unpack, reset };
  }
  const api = { FORMAT, create };
  root.OnlineWire = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
