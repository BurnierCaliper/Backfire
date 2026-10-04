/* Browser-native D3 transport. No game rules or browser runtime dependencies.
 * send() acknowledges relay delivery, NOT authoritative rule acceptance.
 * Only the host may send to player IDs/all. Player commands always go to host.
 */
(function (root) {
  "use strict";
  const WIRE = 1, FRAME_MAX = 50 * 1024, MESSAGE_MAX = 2 * 1024 * 1024;
  const encoder = new TextEncoder(), bytes = text => encoder.encode(text).length;
  const copy = value => JSON.parse(JSON.stringify(value));
  function strict(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || seen.has(value)) throw new TypeError("Relay messages require JSON data");
    const proto = Object.getPrototypeOf(value);
    if (proto !== null) {
      const ctor = Object.getOwnPropertyDescriptor(proto, "constructor");
      if (!ctor || typeof ctor.value !== "function" || ctor.value.name !== (Array.isArray(value) ? "Array" : "Object") || ctor.value.prototype !== proto) throw new TypeError("Relay messages require plain JSON data");
      for (let p = proto; p; p = Object.getPrototypeOf(p)) if (Object.getOwnPropertyDescriptor(p, "toJSON")) throw new TypeError("Relay messages cannot inherit toJSON");
    }
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Relay messages cannot have symbol keys");
    seen.add(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      if (Array.isArray(value) && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d.enumerable || d.get || d.set || ["__proto__", "constructor", "prototype"].includes(key)) throw new TypeError("Relay messages require plain JSON properties");
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new TypeError("Relay arrays cannot have extra keys");
      strict(d.value, seen);
    }
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new TypeError("Relay arrays cannot contain holes");
    seen.delete(value);
  }
  function baseUrl(input) {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("转发地址必须是 HTTP(S) 服务地址，不含凭证或查询参数");
    if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("公网转发服务必须使用 HTTPS");
    return url.href.replace(/\/$/, "");
  }
  function version(options) { return { protocol: options.protocol == null ? 1 : options.protocol, build: options.build || "backfire-d3" }; }
  async function createHost(options) {
    options = options || {};
    const url = baseUrl(options.url), v = version(options);
    const response = await (options.fetch || root.fetch)(url + "/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, name: options.name || "主持人" }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "无法创建房间");
    return connect({ ...options, ...v, url, roomCode: data.roomCode, role: "host", token: data.hostToken });
  }
  function join(options) { return connect({ ...options, ...version(options || {}), role: "player", token: options?.resumeToken || options?.token || null }); }
  function resumeHost(options) { return connect({ ...options, ...version(options || {}), role: "host", token: options?.hostToken || options?.token || null }); }
  async function connect(options) {
    options = options || {};
    const url = baseUrl(options.url), roomCode = String(options.roomCode || "").trim().toUpperCase(), v = version(options);
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(roomCode)) throw new Error("房间码须为六位字母或数字");
    const role = options.role === "host" ? "host" : "player", WebSocketImpl = options.WebSocket || root.WebSocket;
    if (typeof WebSocketImpl !== "function") throw new Error("浏览器不支持 WebSocket");
    const socketUrl = url.replace(/^http/, "ws") + "/rooms/" + roomCode;
    let token = options.token || null, identity = null, ws = null, disposed = false, joined = false, attempts = 0, connecting = null;
    let reconnectTimer = null, heartbeat = null, lastPong = 0, sequence = 0;
    let status = { connected: false, hostOnline: false, paused: true, roomCode, roster: [] }, backlog = [], backlogBytes = 0;
    const messages = new Set(), statuses = new Set(), waiting = new Map(), transfers = new Map();
    const stamp = (kind, data) => ({ v: WIRE, ...v, kind, ...data });
    const notify = value => { status = { ...status, ...value }; for (const fn of [...statuses]) { try { fn(copy(status)); } catch (_) {} } };
    const packet = (value, from) => {
      if (!messages.size) { const length = bytes(JSON.stringify(value)); if (backlog.length >= 64 || backlogBytes + length > MESSAGE_MAX * 2) throw new Error("消息监听器未连接，接收缓存已满"); backlogBytes += length; backlog.push({ value, from }); }
      else for (const fn of [...messages]) { try { fn(copy(value), from); } catch (_) {} }
    };
    function cancelPending(reason) { for (const entry of waiting.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)); } waiting.clear(); transfers.clear(); }
    function reconnectLater() {
      if (disposed || reconnectTimer || !token || options.autoReconnect === false) return;
      const delay = Math.min(15000, 1000 * 2 ** Math.min(attempts++, 4));
      reconnectTimer = setTimeout(() => { reconnectTimer = null; open().catch(() => reconnectLater()); }, delay); reconnectTimer.unref?.();
    }
    function open() {
      if (connecting) return connecting;
      if (disposed) return Promise.reject(new Error("连接已关闭"));
      connecting = new Promise((resolve, reject) => {
        const current = new WebSocketImpl(socketUrl); ws = current; joined = false;
        let settled = false;
        const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("连接转发服务超时")); current.close(); } }, options.connectTimeout || 10000); timer.unref?.();
        current.addEventListener("open", () => current.send(JSON.stringify(stamp("join", { role, name: options.name || "玩家", ...(token ? { token } : {}) }))));
        current.addEventListener("message", event => {
          if (current !== ws) return;
          if (event.data === "pong") { lastPong = Date.now(); return; }
          try {
            if (typeof event.data !== "string" || bytes(event.data) > FRAME_MAX) throw new Error("无效或过大的转发帧");
            const data = JSON.parse(event.data); strict(data);
            if (data.v !== WIRE || data.protocol !== v.protocol || data.build !== v.build) throw new Error("版本不同，请刷新");
            if (data.kind === "joined") {
              if (data.identity?.role !== role || data.identity?.roomCode !== roomCode) throw new Error("转发身份无效");
              identity = copy(data.identity); token = data.resumeToken || token; joined = true; attempts = 0; lastPong = Date.now();
              clearTimeout(timer); settled = true;
              notify({ connected: true, hostOnline: data.hostOnline, paused: data.paused, roster: data.roster, expiresAt: data.expiresAt, reason: null });
              clearInterval(heartbeat); heartbeat = setInterval(() => {
                if (ws !== current || current.readyState !== 1) return;
                if (Date.now() - lastPong > 45000) current.close(); else current.send("ping");
                for (const [key, part] of transfers) if (part.deadline < Date.now()) { transfers.delete(key); notify({ reason: "重同步分片超时，请请求完整状态" }); }
              }, 15000); heartbeat.unref?.();
              resolve(endpoint); return;
            }
            if (data.kind === "status") { notify({ hostOnline: data.hostOnline, paused: data.paused, roster: data.roster, expiresAt: data.expiresAt }); return; }
            if (data.kind === "ack" || data.kind === "error") {
              const entry = waiting.get(data.id);
              if (entry) { waiting.delete(data.id); clearTimeout(entry.timer); data.kind === "ack" ? entry.resolve({ ok: true, id: data.id }) : entry.reject(Object.assign(new Error(data.error), { code: data.code })); }
              if (data.kind === "error") {
                notify({ reason: data.error });
                if (!settled) { settled = true; clearTimeout(timer); reject(Object.assign(new Error(data.error), { code: data.code })); }
              }
              return;
            }
            if (!joined || typeof data.from !== "string" || role === "player" && data.from !== "host") throw new Error("无效的转发发令者");
            if (data.kind === "data") { packet(data.payload, data.from); return; }
            if (data.kind !== "chunk" || role !== "player" || typeof data.text !== "string" || !Number.isInteger(data.count) || data.count < 2 || data.count > 512) throw new Error("无效消息类型或分片");
            const key = data.from + ":" + data.id;
            if (data.index === 0) { if (transfers.size >= 4) throw new Error("未完成的分片过多"); transfers.set(key, { count: data.count, index: 0, parts: [], bytes: 0, deadline: Date.now() + 15000 }); }
            const transfer = transfers.get(key);
            if (!transfer || transfer.index !== data.index || transfer.count !== data.count || transfer.deadline < Date.now()) throw new Error("分片丢失或次序错误，请重新同步");
            transfer.index++; transfer.bytes += bytes(data.text); transfer.parts.push(data.text);
            if (transfer.bytes > MESSAGE_MAX) throw new Error("重同步消息超过 2 MB");
            if (transfer.index === transfer.count) { transfers.delete(key); const value = JSON.parse(transfer.parts.join("")); strict(value); packet(value, data.from); }
          } catch (error) {
            notify({ reason: error.message }); cancelPending(error.message);
            if (!settled) { settled = true; clearTimeout(timer); reject(error); }
            // Browser WebSocket.close permits 1000 or application codes only.
            current.close(4002, "invalid_frame");
          }
        });
        current.addEventListener("error", () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("无法连接转发服务")); } });
        current.addEventListener("close", event => {
          if (current !== ws) return;
          clearTimeout(timer); clearInterval(heartbeat); joined = false;
          cancelPending("连接已断开；未确认指令不会自动重发");
          notify({ connected: false, hostOnline: false, paused: true, reason: event.reason || "连接已断开" });
          if (!settled) { settled = true; reject(new Error(event.reason || "加入房间失败")); }
          if ([1008, 4001, 4002].includes(event.code) || event.reason === "expired") disposed = true;
          else reconnectLater();
        });
      }).finally(() => { connecting = null; });
      return connecting;
    }
    function sendFrames(frames, id) {
      if (!joined || !ws || ws.readyState !== 1 || disposed) return Promise.reject(new Error("尚未连接转发服务"));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error("转发确认超时；指令不会自动重发")); }, 15000); timer.unref?.();
        waiting.set(id, { resolve, reject, timer });
        try { for (const frame of frames) { const text = JSON.stringify(frame); if (bytes(text) > FRAME_MAX) throw new Error("转发帧超过 50 KB"); ws.send(text); } }
        catch (error) { waiting.delete(id); clearTimeout(timer); reject(error); }
      });
    }
    const endpoint = {
      get identity() { return identity ? copy(identity) : null; },
      credentials: () => ({ url, roomCode, role, token, ...v }),
      status: () => copy(status),
      send(value, to) {
        try {
          strict(value);
          if (!joined || !ws || ws.readyState !== 1 || disposed) throw new Error("尚未连接转发服务");
          if (role !== "host" && to != null && to !== "host") throw new Error("玩家只能给主持人发送消息");
          if (role !== "host" && status.paused) throw new Error("主持人离线或正在恢复，房间已暂停");
          const id = "m_" + (++sequence) + "_" + Date.now().toString(36), text = JSON.stringify(value), frame = stamp("data", { id, to: role === "host" ? to || "all" : "host", payload: value });
          if (bytes(text) > MESSAGE_MAX) throw new Error("消息超过 2 MB");
          // Leave room for the relay's authenticated sender envelope.
          if (bytes(JSON.stringify(frame)) <= FRAME_MAX - 256) return sendFrames([frame], id);
          if (role !== "host") throw new Error("玩家指令超过 50 KB");
          const parts = [];
          // 4096 UTF-16 code units leave room for JSON escaping and metadata;
          // joining restores split surrogate pairs before JSON is parsed.
          for (let start = 0; start < text.length; start += 4096) parts.push(text.slice(start, start + 4096));
          if (parts.length > 512) throw new Error("分片数量过多");
          return sendFrames(parts.map((text, index) => stamp("chunk", { id, to: to || "all", index, count: parts.length, text })), id);
        } catch (error) { return Promise.reject(error); }
      },
      setReady(ready) { if (role !== "host" || typeof ready !== "boolean") return Promise.reject(new Error("只有主持人可以恢复房间")); const id = "ready_" + (++sequence); return sendFrames([stamp("ready", { id, ready })], id); },
      onMessage(fn) { if (typeof fn !== "function") throw new TypeError("onMessage requires function"); messages.add(fn); const pending = backlog; backlog = []; backlogBytes = 0; for (const message of pending) { try { fn(copy(message.value), message.from); } catch (_) {} } return () => messages.delete(fn); },
      onStatus(fn) { if (typeof fn !== "function") throw new TypeError("onStatus requires function"); statuses.add(fn); try { fn(copy(status)); } catch (_) {} return () => statuses.delete(fn); },
      close() { disposed = true; clearTimeout(reconnectTimer); clearInterval(heartbeat); cancelPending("连接已关闭"); if (ws) ws.close(1000, "closed"); notify({ connected: false, paused: true }); },
      reconnect() { if (disposed) return Promise.reject(new Error("连接已关闭，请使用保存的令牌恢复")); if (joined) return Promise.resolve(endpoint); clearTimeout(reconnectTimer); reconnectTimer = null; return open(); }
    };
    return open();
  }
  const RelayTransport = { createHost, join, resumeHost, connect, FRAME_MAX, MESSAGE_MAX, validate: strict };
  root.RelayTransport = RelayTransport;
  if (typeof module !== "undefined" && module.exports) module.exports = RelayTransport;
})(typeof globalThis !== "undefined" ? globalThis : window);
