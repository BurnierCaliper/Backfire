/* D2 in-page authority adapter. Only the host executes rules. Client snapshots
 * are detached display data; this module does not implement a network service. */
(function (root) {
  "use strict";
  const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const messageOf = error => error && error.message ? error.message : String(error);
  function create(options) {
    options = options || {};
    const { session, execute, validate, getState } = options;
    if (!session || typeof session.snapshot !== "function" || typeof execute !== "function" || typeof validate !== "function" || typeof getState !== "function") throw new TypeError("Authority requires session, execute, validate and getState");
    const transport = root.LocalTransport || (typeof require === "function" ? require("./hotseat").LocalTransport : null);
    if (!transport) throw new Error("LocalTransport is required");
    const protocol = options.protocol == null ? 1 : options.protocol;
    const build = options.build == null ? "backfire-d2" : options.build;
    const hostId = "$hotseat-authority", hub = transport.createHub({ hostId });
    const peers = new Map();
    let sequence = 0, busy = false, closed = false;
    const stamp = data => Object.assign({ protocol, build }, data);
    const sameVersion = message => message.protocol === protocol && message.build === build;
    const errorAck = error => ({ ok: false, error: messageOf(error), seq: sequence });
    function packetFor(operatorId, seq, state, tape, view) {
      const projected = typeof options.viewFor === "function" ? options.viewFor(operatorId, copy(view)) : view;
      return stamp({ type: "result", seq, state: copy(state), tape: copy(tape), view: copy(projected) });
    }
    function packets(seq, recipients) {
      // Read the authority once, then detach every recipient's presentation.
      const state = copy(getState());
      const tape = typeof options.getTape === "function" ? copy(options.getTape()) : [];
      const view = copy(session.snapshot());
      return recipients.map(peer => ({ peer, packet: packetFor(peer.operatorId, seq, state, tape, view) }));
    }
    function deliver(list) {
      for (const { peer, packet } of list) if (peer.active && peer.joined) hub.host.send(packet, peer.operatorId);
    }
    function publish() {
      const list = packets(sequence + 1, [...peers.values()].filter(peer => peer.active && peer.joined));
      sequence += 1;
      deliver(list);
      return sequence;
    }
    function broadcast() {
      if (closed) throw new Error("热座房主已关闭");
      // Session listeners can request a broadcast while a command is settling.
      // Its final publish already contains those changes.
      if (busy) return sequence;
      busy = true;
      try { return publish(); } finally { busy = false; }
    }
    function reply(peer, requestId, response) {
      hub.host.send(stamp({ type: "ack", requestId, ...response }), peer.operatorId);
    }
    function receive(message, sender) {
      const peer = peers.get(sender);
      if (!peer || !peer.active) return;
      if (message.type === "join") {
        if (!sameVersion(message)) { hub.host.send(stamp({ type: "joinRejected", error: "版本不同，请刷新", seq: sequence }), sender); return; }
        if (peer.joined) return;
        peer.joined = true;
        hub.host.send(stamp({ type: "joined", seq: sequence }), sender);
        deliver(packets(sequence, [peer]));
        return;
      }
      const requestId = message.requestId;
      if (!peer.joined || !sameVersion(message)) { reply(peer, requestId || null, errorAck("版本不同，请刷新")); return; }
      if (message.type !== "cmd" || !Number.isSafeInteger(requestId) || requestId < 1) { reply(peer, requestId || null, errorAck("无效的客户端指令编号")); return; }
      const fingerprint = JSON.stringify(message.command);
      const previous = peer.requests.get(requestId);
      if (previous) {
        reply(peer, requestId, previous.fingerprint === fingerprint ? previous.response : errorAck("客户端指令编号已用于另一条指令"));
        return;
      }
      if (busy) { reply(peer, requestId, errorAck("房主正在结算，请稍后重试")); return; }
      busy = true;
      let response, executed = false;
      try {
        // The endpoint's sender is authoritative. Payload fields such as sender,
        // operatorId or a client-side snapshot never select the execution owner.
        if (!message.command || Array.isArray(message.command) || typeof message.command.type !== "string" || !message.command.type) throw new Error("指令必须包含类型");
        const valid = validate(message.command, sender);
        if (valid && typeof valid.then === "function") throw new Error("本机热座校验必须同步执行");
        if (valid === false || typeof valid === "string") throw new Error(typeof valid === "string" ? valid : "规则不允许这条指令");
        executed = true;
        const value = execute(message.command, sender);
        if (value && typeof value.then === "function") throw new Error("本机热座规则处理器必须同步执行");
        if (typeof options.afterCommand === "function") {
          const after = options.afterCommand(message.command, sender);
          if (after && typeof after.then === "function") throw new Error("本机热座后处理必须同步执行");
        }
        const result = value === undefined ? {} : { result: copy(value) };
        publish();
        response = { ok: true, ...result, seq: sequence };
      } catch (error) {
        // Rule errors can occur after a partial mutation. Report the error and
        // publish what the host actually holds; never invent a client rollback.
        if (executed) {
          try { publish(); } catch (_) {}
        }
        response = errorAck(error);
      } finally { busy = false; }
      peer.requests.set(requestId, { fingerprint, response: copy(response) });
      if (peer.active) reply(peer, requestId, response);
    }
    hub.host.onMessage(receive);

    function connect(operatorId, version = {}) {
      if (closed) throw new Error("热座房主已关闭");
      const operators = session.snapshot().operators || [];
      if (typeof operatorId !== "string" || !operators.some(op => (typeof op === "string" ? op : op.id) === operatorId)) throw new Error("没有这个操作者");
      if (operatorId === hostId || peers.has(operatorId)) throw new Error("操作者已经连接");
      const endpoint = hub.connect(operatorId);
      const peer = { operatorId, active: true, joined: false, requests: new Map() };
      peers.set(operatorId, peer);
      const callbacks = new Set(), acknowledgments = new Map();
      let requestNumber = 0, last = null, joinError = null;
      endpoint.onMessage((message, from) => {
        if (from !== hostId) return;
        if (message.type === "joinRejected") { joinError = message.error; return; }
        if (!sameVersion(message)) { joinError = "版本不同，请刷新"; return; }
        if (message.type === "ack") {
          const response = { ok: message.ok, seq: message.seq };
          if (Object.hasOwn(message, "result")) response.result = copy(message.result);
          if (Object.hasOwn(message, "error")) response.error = message.error;
          acknowledgments.set(message.requestId, response);
        }
        if (message.type === "result") last = copy(message);
        for (const callback of [...callbacks]) { try { callback(copy(message)); } catch (_) {} }
      });
      function close() {
        if (!peer.active) return;
        peer.active = false; callbacks.clear(); acknowledgments.clear();
        endpoint.close(); peers.delete(operatorId);
      }
      try {
        endpoint.send({ type: "join", protocol: version.protocol == null ? protocol : version.protocol, build: version.build == null ? build : version.build });
        if (joinError || !peer.joined) throw new Error(joinError || "无法加入热座会话");
      } catch (error) { close(); throw error; }
      return {
        send(command, requestOptions = {}) {
          if (closed || !peer.active) return errorAck("本机热座连接已关闭");
          const requestId = requestOptions.requestId == null ? requestNumber + 1 : requestOptions.requestId;
          if (!Number.isSafeInteger(requestId) || requestId < 1) return errorAck("无效的客户端指令编号");
          requestNumber = Math.max(requestNumber, requestId);
          acknowledgments.delete(requestId);
          try {
            // LocalTransport checks strict JSON before cloning or delivering;
            // do not stringify first and silently clean an invalid command.
            endpoint.send(stamp({ type: "cmd", requestId, command }));
            const response = acknowledgments.get(requestId);
            acknowledgments.delete(requestId);
            return response ? copy(response) : errorAck("房主没有确认这条指令");
          } catch (error) { return errorAck(error); }
        },
        onMessage(callback) {
          if (typeof callback !== "function") throw new TypeError("onMessage requires a function");
          if (!peer.active) throw new Error("本机热座连接已关闭");
          callbacks.add(callback);
          if (last) { try { callback(copy(last)); } catch (_) {} }
          return () => callbacks.delete(callback);
        },
        snapshot: () => copy(last),
        close
      };
    }
    return { connect, broadcast, get seq() { return sequence; }, close() {
      if (closed) return;
      closed = true;
      for (const peer of peers.values()) peer.active = false;
      peers.clear(); hub.close();
    } };
  }
  root.HotseatAuthority = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof globalThis !== "undefined" ? globalThis : window);
