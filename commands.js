/* D1 local command boundary. No transport, ownership enforcement or turn-order UI.
 * Commands are data; registered handlers execute against complete authority state.
 * Display projections are detached values and cannot be execution contexts. */
(function (root) {
  "use strict";
  const handlers = new Map(), reserved = new Map(), log = [];
  const displayContexts = new WeakSet();
  const interceptors = [];
  let sequence = 0;
  const LOG_LIMIT = 1000;

  function jsonValue(value, seen = new Set(), path = "command") {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") throw new TypeError(path + " must contain JSON data only");
    if (seen.has(value)) throw new TypeError(path + " contains a cycle");
    const proto = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && proto !== null) {
      const ctor = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (Object.getPrototypeOf(proto) !== null || !ctor || typeof ctor.value !== "function" || ctor.value.name !== "Object" || ctor.value.prototype !== proto) throw new TypeError(path + " must be a plain object");
    }
    if (Array.isArray(value) && proto !== null) {
      const ctor = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (!ctor || typeof ctor.value !== "function" || ctor.value.name !== "Array" || ctor.value.prototype !== proto || !Array.isArray(proto)) throw new TypeError(path + " must be a plain array");
    }
    for (let ancestor = proto; ancestor; ancestor = Object.getPrototypeOf(ancestor)) {
      if (Object.getOwnPropertyDescriptor(ancestor, "toJSON")) throw new TypeError(path + " must not inherit toJSON");
    }
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(path + " contains symbol keys");
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key === "length") continue;
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new TypeError(path + " contains a non-index array property");
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError(path + " contains a reserved key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(path + " contains an accessor");
      if (!descriptor.enumerable) throw new TypeError(path + " contains a non-JSON property");
      jsonValue(descriptor.value, seen, path + "." + key);
    }
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new TypeError(path + " contains an array hole");
    seen.delete(value);
  }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function prepare(command) {
    jsonValue(command);
    if (!command || Array.isArray(command) || typeof command.type !== "string" || !command.type.trim()) throw new TypeError("Command requires a nonempty type");
    return copy(command);
  }
  // Diagnostic summaries must never change the handler's return value or turn a
  // successful rule action into a failure (some legacy helpers return undefined).
  function resultForLog(value) {
    if (value === undefined) return null;
    try { jsonValue(value); return copy(value); }
    catch (_) { return { summary: "Non-JSON local return value omitted" }; }
  }
  function record(command) {
    const entry = { seq: ++sequence, command: copy(command), status: "pending" };
    log.push(entry);
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
    return entry;
  }
  function register(type, execute, options = {}) {
    if (typeof type !== "string" || !type || typeof execute !== "function") throw new TypeError("register needs a type and executor");
    if (handlers.has(type) || reserved.has(type)) throw new Error("Command already registered: " + type);
    handlers.set(type, { execute, validate: options.validate || null, domain: options.domain || type.split(".")[0] });
  }
  function dispatch(input, context = {}) {
    const command = prepare(input);
    if (!context || typeof context !== "object" || displayContexts.has(context)) throw new TypeError("A complete authority context is required; display views cannot execute commands");
    const run = index => index < interceptors.length ? interceptors[index](command, context, () => run(index + 1)) : execute(command, context);
    return run(0);
  }
  function execute(command, context) {
    const handler = handlers.get(command.type);
    if (!handler) throw new Error(reserved.has(command.type) ? command.type + " is reserved for " + reserved.get(command.type).phase : "Unknown command: " + command.type);
    const entry = record(command);
    const success = value => { entry.status = "ok"; entry.result = resultForLog(value); return value; };
    const failure = error => { entry.status = "error"; entry.error = error && error.message || String(error); throw error; };
    try {
      if (handler.validate) handler.validate(command, context);
      const value = handler.execute(command, context);
      return value && typeof value.then === "function" ? Promise.resolve(value).then(success, failure) : success(value);
    } catch (error) { return failure(error); }
  }
  function reserve(type, specification) {
    if (handlers.has(type) || reserved.has(type)) throw new Error("Command already registered: " + type);
    jsonValue(specification); reserved.set(type, copy(specification));
  }
  function activate(type, phase, executor, options) {
    if (!reserved.has(type) || reserved.get(type).phase !== phase) throw new Error("Command is not reserved for " + phase + ": " + type);
    if (typeof executor !== "function") throw new TypeError("Command requires an executor");
    reserved.delete(type); register(type, executor, options);
  }
  function intercept(fn) {
    if (typeof fn !== "function") throw new TypeError("Interceptor requires a function");
    interceptors.push(fn);
    return () => { const i = interceptors.indexOf(fn); if (i >= 0) interceptors.splice(i, 1); };
  }
  function catalog() {
    return [...handlers].map(([type, h]) => ({ type, domain: h.domain, implemented: true }))
      .concat([...reserved].map(([type, spec]) => ({ type, ...copy(spec), implemented: false })));
  }
  function projectView(authority, projector, recipient = null) {
    if (typeof projector !== "function") throw new TypeError("View projection requires an explicit projector");
    // Projection never receives references to the live authority. D3 must provide
    // a recipient-specific projector for result/tape/log/resync/private history.
    const detached = copy(authority);
    const view = projector(detached, recipient);
    jsonValue(view, new Set(), "view");
    const projected = copy(view);
    if (projected && typeof projected === "object") displayContexts.add(projected);
    return projected;
  }
  function unitRoster(units, assignments = {}, previousUnitIds = []) {
    const byId = new Map(units.map(u => [u.id, u]));
    // Existing cards store weaponOf as the owner's kit, while future callers may
    // already have a concrete unit id. Resolve both without changing save data.
    const byKit = new Map();
    for (const u of units) if (!u.weaponOf && !u.hidden && !u._removed && !byKit.has(u.kit)) byKit.set(u.kit, u);
    function owner(unit, seen = new Set()) {
      if (!unit || seen.has(unit.id)) return null;
      seen.add(unit.id);
      if (unit.weaponOf) return owner(byId.get(unit.weaponOf) || byKit.get(unit.weaponOf), seen);
      return Object.hasOwn(assignments, unit.id) ? assignments[unit.id] : null;
    }
    // This is an ephemeral interface, not a new field in state/run/save files.
    // Rebuild after summon/recall: every present controlled unit has its own row.
    const roster = units.filter(u => !u.hidden && !u._removed && !u.dead).map(u => ({
      unitId: u.id, operatorId: owner(u), weaponOf: u.weaponOf || null
    })).filter(u => u.operatorId !== null);
    const present = new Map(roster.map(slot => [slot.unitId, slot]));
    // D2 can retain unit slots across a roster change: absent units disappear,
    // newly present weapons append. D1 does not activate ordering in gameplay.
    return [...new Set([...previousUnitIds, ...present.keys()])].filter(id => present.has(id)).map(id => present.get(id));
  }
  function exportLog() {
    return JSON.stringify({ schema: "backfire-command-log-v1", scope: "local-authority-debug", retained: log.length, lastSequence: sequence, limit: LOG_LIMIT, entries: log }, null, 2);
  }
  function downloadLog() {
    if (typeof document === "undefined" || typeof Blob === "undefined" || !root.URL || !root.URL.createObjectURL) throw new Error("Command log download requires a browser");
    const url = root.URL.createObjectURL(new Blob([exportLog()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "backfire-commands.json";
    document.body.appendChild(a); a.click(); a.remove();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
  }
  reserve("orderMove", { phase: "D2", identity: "actor is a unit id; operator may own multiple units" });
  reserve("orderSwapAccept", { phase: "D2", identity: "swap request identifies unit ids, not player seats" });
  root.Commands = { register, dispatch, reserve, activate, intercept, catalog, projectView, unitRoster, exportLog, downloadLog,
    history: () => copy(log), clearLog: () => { log.length = 0; }, validate: prepare };
  root.dispatch = dispatch;
})(globalThis);
