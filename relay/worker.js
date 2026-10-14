// Optional relay: identity, room lifecycle and bounded forwarding only. No game
// rules, battle state, private-message history or save files are stored here.
const FRAME_MAX = 50 * 1024, MESSAGE_MAX = 2 * 1024 * 1024, WIRE = 1;
const SEAT_CONFIRM_MS = 20000;   // 新座位要在这么久之内确认（客户端收到 joined 后的 confirm），不然当幽灵座位清掉（env.SEAT_CONFIRM_MS 可改，测试用）
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const encoder = new TextEncoder();
const size = value => encoder.encode(value).length;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
const hash = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map(x => x.toString(16).padStart(2, "0")).join("");
function randomCode() { return [...crypto.getRandomValues(new Uint8Array(6))].map(n => alphabet[n & 31]).join(""); }
function validVersion(value) { return Number.isSafeInteger(value.protocol) && value.protocol > 0 && typeof value.build === "string" && /^[A-Za-z0-9._:-]{1,96}$/.test(value.build); }
function nameOf(value) { if (typeof value !== "string" || !value.trim() || [...value.trim()].length > 24 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("昵称须为 1–24 个可见字符"); return value.trim(); }
function plain(value) {
  if (value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object") throw new Error("消息必须是 JSON 数据");
  if (Array.isArray(value)) { for (const item of value) plain(item); return; }
  for (const [key, item] of Object.entries(value)) { if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("非法消息字段"); plain(item); }
}
function safeParse(text) { const value = JSON.parse(text); plain(value); return value; }
async function limitedBody(request, limit) {
  if (Number(request.headers.get("Content-Length")) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks = []; let total = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const joined = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(joined);
}
function origins(env) { return String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean); }
// 本机开的网页（localhost / 127.0.0.1 / [::1] 的任意端口）默认都放行，不用一个个端口写进 ALLOWED_ORIGINS；
// 部署时把 ALLOW_LOCAL_PORTS 设成 "0" 可以关掉，只认 ALLOWED_ORIGINS 里写的
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origins(env).includes(origin)) return true;
  return String(env.ALLOW_LOCAL_PORTS ?? "1") !== "0" && LOCAL_ORIGIN.test(origin);
}
function cors(request, env) {
  const origin = request.headers.get("Origin");
  return origin && originAllowed(request, env) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "POST,GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" } : {};
}
// 被拒绝的来源也带上 CORS 头：网页才读得到「这个网站来源未获许可」，不然只看得到「连不上」
function denyHeaders(request) {
  const origin = request.headers.get("Origin");
  return origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {};
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), headers = cors(request, env);
    if (!originAllowed(request, env)) return json({ error: "这个网站来源未获转发服务许可", code: "origin", origin: request.headers.get("Origin") }, 403, denyHeaders(request));
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health") return json({ ok: true, wire: WIRE }, 200, headers);
    const joining = /^\/rooms\/([A-Z2-9]{6})$/.exec(url.pathname);
    const creating = request.method === "POST" && url.pathname === "/rooms";
    const upgrading = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    // 不带 WebSocket 升级的 GET /rooms/XXXXXX：只查房间在不在（连接失败时网页用来说清楚是哪里出了问题）
    const checking = joining && request.method === "GET" && !upgrading;
    if (!creating && !(joining && request.method === "GET")) return json({ error: "不存在的转发接口" }, 404, headers);
    // Rate-limit before room lookup, including failed room-code guesses. The IP
    // is only hashed into a short-lived limiter object; never broadcast or log it.
    const admissionId = await hash(request.headers.get("CF-Connecting-IP") || "local");
    const admission = env.ADMISSION.get(env.ADMISSION.idFromName(admissionId));
    const permit = await admission.fetch("https://internal/" + (creating ? "create" : "join"));
    if (!permit.ok) return json({ error: "请求过快，请稍后重试" }, 429, { ...headers, "Retry-After": "60" });
    if (creating) {
      try {
        const text = await limitedBody(request, 4096);
        if (text === null) return json({ error: "开房请求过大" }, 413, headers);
        const input = safeParse(text);
        if (!validVersion(input)) return json({ error: "无效协议或构建版本" }, 400, headers);
        input.name = nameOf(input.name);
        for (let attempt = 0; attempt < 8; attempt++) {
          const code = randomCode(), room = env.ROOMS.get(env.ROOMS.idFromName(code));
          const result = await room.fetch("https://internal/init", { method: "POST", body: JSON.stringify({ ...input, code }) });
          if (result.status === 409) continue;
          return json(await result.json(), result.status, headers);
        }
        return json({ error: "房间码暂不可用，请重试" }, 503, headers);
      } catch (error) { return json({ error: error.message || "开房请求无效" }, 400, headers); }
    }
    const room = env.ROOMS.get(env.ROOMS.idFromName(joining[1]));
    if (checking) { const r = await room.fetch("https://internal/exists"); return json(await r.json(), r.status, headers); }
    return room.fetch(new Request("https://internal/socket", request));
  }
};

export class Admission {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const now = Date.now(), kind = new URL(request.url).pathname === "/create" ? "create" : "join";
    return this.ctx.blockConcurrencyWhile(async () => {
      const row = await this.ctx.storage.get("bucket") || { start: now, create: 0, join: 0 };
      if (now - row.start >= 60000) Object.assign(row, { start: now, create: 0, join: 0 });
      const max = kind === "create" ? 10 : 60;
      if (++row[kind] > max) return json({ ok: false }, 429);
      await this.ctx.storage.put("bucket", row); await this.ctx.storage.setAlarm(now + 120000);
      return json({ ok: true });
    });
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.meta = null; this.tail = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => { this.meta = await ctx.storage.get("room") || null; });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  confirmMs() { return Math.max(1000, Number(this.env.SEAT_CONFIRM_MS) || SEAT_CONFIRM_MS); }
  packet(kind, values = {}) { return { v: WIRE, protocol: this.meta.protocol, build: this.meta.build, kind, ...values }; }
  connections() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
  data(ws) { return ws.deserializeAttachment() || {}; }
  authenticated() { return this.connections().filter(ws => this.data(ws).id); }
  host() { return this.authenticated().find(ws => this.data(ws).role === "host"); }
  status() {
    const sockets = this.authenticated(), host = this.host();
    return { roomCode: this.meta.code, hostOnline: !!host, paused: !host || !this.data(host).ready,
      expiresAt: this.meta.expiresAt, roster: this.meta.seats.map(({ id, name, role }) => ({ id, name, role, online: sockets.some(ws => this.data(ws).id === id) })) };
  }
  send(ws, value) { try { ws.send(JSON.stringify(value)); } catch (_) {} }
  publish() { if (this.meta) { const packet = this.packet("status", this.status()); for (const ws of this.authenticated()) this.send(ws, packet); } }
  error(ws, message, id = null, code = "rejected", close = false) {
    if (this.meta) this.send(ws, this.packet("error", { error: message, id, code }));
    if (close) { try { ws.close(1008, String(code).slice(0, 80)); } catch (_) {} }
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/init") {
      return this.ctx.blockConcurrencyWhile(async () => {
        if (this.meta && this.meta.expiresAt > Date.now()) return json({ error: "房间已存在" }, 409);
        for (const peer of this.connections()) { peer.serializeAttachment({ expired: true }); peer.close(1000, "expired"); }
        const input = await request.json(), hostToken = randomHex(32), ttl = Math.min(86400, Math.max(60, Number(this.env.ROOM_TTL_SECONDS) || 86400));
        this.meta = { code: input.code, protocol: input.protocol, build: input.build, expiresAt: Date.now() + ttl * 1000,
          seats: [{ id: "host", role: "host", name: input.name, tokenHash: await hash(hostToken) }] };
        await this.ctx.storage.put("room", this.meta); await this.ctx.storage.setAlarm(Math.min(this.meta.expiresAt, Date.now() + 15000));
        return json({ roomCode: input.code, hostToken, hostId: "host", expiresAt: this.meta.expiresAt, protocol: input.protocol, build: input.build });
      });
    }
    if (!this.meta || this.meta.expiresAt <= Date.now()) return json({ error: "房间不存在或已过期", code: "no_room" }, 404);
    if (new URL(request.url).pathname === "/exists") return json({ ok: true, hostOnline: !!this.host() });
    if (this.connections().length >= 12) return json({ error: "连接过多，请稍后重试" }, 429);
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ opened: Date.now(), rateAt: Date.now(), frames: 0, bytes: 0 });
    await this.ctx.storage.setAlarm(Math.min(this.meta.expiresAt, Date.now() + 15000));
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, text) {
    const run = this.tail.then(() => this.receive(ws, text)); this.tail = run.catch(() => {}); return run;
  }
  async receive(ws, text) {
    if (!this.meta || this.meta.expiresAt <= Date.now()) { ws.close(1008, "expired"); return; }
    const connection = this.data(ws);
    if (typeof text !== "string" || size(text) > FRAME_MAX) { this.error(ws, "消息超过 50 KB 或不是文本", null, "too_large", true); return; }
    let message;
    try { message = safeParse(text); } catch (_) { this.error(ws, "无效 JSON 消息", null, "invalid_json", true); return; }
    if (!message || message.v !== WIRE || message.protocol !== this.meta.protocol || message.build !== this.meta.build) { this.error(ws, "版本不同，请刷新", message?.id, "version", true); return; }
    if (!connection.id) { await this.join(ws, message); return; }
    if (this.meta.seats.every(seat => seat.id !== connection.id)) { this.error(ws, "座位已失效", null, "identity", true); return; }
    const now = Date.now();
    if (now - connection.rateAt >= 10000) Object.assign(connection, { rateAt: now, frames: 0, bytes: 0 });
    connection.frames++; connection.bytes += size(text);
    const isHost = connection.role === "host";
    if (connection.frames > (isHost ? 2400 : 120) || connection.bytes > (isHost ? 12 * 1024 * 1024 : 256 * 1024)) { this.error(ws, "消息过快，请稍后重试", message.id, "rate_limit", true); return; }
    ws.serializeAttachment(connection);
    // 新座位的确认：客户端收到 joined（拿到恢复令牌）后马上回一句。20 秒内没确认的座位当成幽灵座位清掉（alarm）
    if (message.kind === "confirm") {
      const seat = this.meta.seats.find(p => p.id === connection.id);
      if (seat && seat.pending) { delete seat.pending; await this.ctx.storage.put("room", this.meta); }
      return;
    }
    if (message.kind === "ready") {
      if (!isHost || typeof message.ready !== "boolean" || typeof message.id !== "string" || !/^[a-zA-Z0-9:_-]{1,96}$/.test(message.id)) { this.error(ws, "只有主持人可恢复房间，且须提供有效消息编号", message.id); return; }
      connection.ready = message.ready; ws.serializeAttachment(connection); this.publish();
      this.send(ws, this.packet("ack", { id: message.id })); return;
    }
    // 主持人释放玩家座位：丢掉这个座位的恢复令牌，昵称和名额可以重新使用；该座位在线的连接被断开（4003 released）
    if (message.kind === "release") {
      if (!isHost || typeof message.id !== "string" || !/^[a-zA-Z0-9:_-]{1,96}$/.test(message.id) || typeof message.seat !== "string") { this.error(ws, "只有主持人可以释放座位", message.id || null); return; }
      const index = this.meta.seats.findIndex(seat => seat.id === message.seat && seat.role === "player");
      if (index < 0) { this.error(ws, "没有这个玩家座位", message.id); return; }
      this.meta.seats.splice(index, 1); await this.ctx.storage.put("room", this.meta);
      for (const peer of this.authenticated()) if (this.data(peer).id === message.seat) { peer.serializeAttachment({ released: true }); try { peer.close(4003, "released"); } catch (_) {} }
      this.publish(); this.send(ws, this.packet("ack", { id: message.id })); return;
    }
    if (!["data", "chunk"].includes(message.kind) || typeof message.id !== "string" || !/^[a-zA-Z0-9:_-]{1,96}$/.test(message.id)) { this.error(ws, "无效的转发消息", message.id || null); return; }
    const status = this.status();
    if (!isHost && status.paused) { this.error(ws, "主持人离线或正在恢复，房间已暂停", message.id, "paused"); return; }
    if (!isHost && (message.to != null && message.to !== "host" || message.kind === "chunk")) { this.error(ws, "玩家只能向主持人发送不超过 50 KB 的消息", message.id, "recipient"); return; }
    const to = isHost ? message.to || "all" : "host";
    const recipients = this.authenticated().filter(peer => { const p = this.data(peer); return p.id !== connection.id && (to === "all" || p.id === to); });
    if (to !== "all" && !recipients.length) { this.error(ws, "收件人已离线", message.id, "offline"); return; }
    const frame = this.packet(message.kind, { id: message.id, from: connection.id });
    if (message.kind === "chunk") {
      if (typeof message.text !== "string" || !Number.isInteger(message.index) || !Number.isInteger(message.count) || message.count < 2 || message.count > 512) { this.error(ws, "无效分片", message.id); return; }
      if (message.index === 0) connection.transfer = { id: message.id, index: 0, count: message.count, bytes: 0, to, deadline: now + 15000 };
      const t = connection.transfer;
      if (!t || t.id !== message.id || t.index !== message.index || t.count !== message.count || t.to !== to || t.deadline < now) { this.error(ws, "分片顺序错误或过期", message.id); return; }
      t.bytes += size(message.text); t.index++;
      if (t.bytes > MESSAGE_MAX) { delete connection.transfer; ws.serializeAttachment(connection); this.error(ws, "重同步消息超过 2 MB", message.id, "too_large", true); return; }
      Object.assign(frame, { index: message.index, count: message.count, text: message.text });
      if (t.index === t.count) delete connection.transfer;
      ws.serializeAttachment(connection);
    } else {
      if (!Object.hasOwn(message, "payload")) { this.error(ws, "缺少消息内容", message.id); return; }
      frame.payload = message.payload;
    }
    // The sender is solely the authenticated endpoint. No client-provided from,
    // sender or recipient data is copied into this envelope.
    if (size(JSON.stringify(frame)) > FRAME_MAX) { this.error(ws, "转发后的消息超过 50 KB", message.id, "too_large"); return; }
    for (const recipient of recipients) this.send(recipient, frame);
    if (message.kind === "data" || message.index === message.count - 1) this.send(ws, this.packet("ack", { id: message.id }));
  }
  async join(ws, message) {
    if (message.kind !== "join" || !["host", "player"].includes(message.role)) { this.error(ws, "必须先加入房间", null, "join", true); return; }
    try {
      let seat, issuedToken = null;
      if (message.token != null) {
        if (typeof message.token !== "string" || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error("恢复令牌无效");
        const digest = await hash(message.token);
        seat = this.meta.seats.find(p => p.tokenHash === digest && p.role === message.role);
        if (!seat) throw new Error("恢复令牌无效");
        if (seat.pending) { delete seat.pending; await this.ctx.storage.put("room", this.meta); }   // 拿着令牌回来 = 收到过 joined
      } else {
        if (message.role === "host") throw new Error("主持人必须提供恢复令牌");
        const name = nameOf(message.name);
        if (this.meta.seats.some(p => p.name.normalize("NFKC").toLocaleLowerCase() === name.normalize("NFKC").toLocaleLowerCase())) throw new Error("昵称已占用；返回原座位需要恢复令牌");
        if (this.meta.seats.filter(p => p.role === "player").length >= 4) throw new Error("房间已有四名玩家（离线座位保留）");
        if (!this.host()) throw new Error("主持人离线，请等待主持人回来");
        issuedToken = randomHex(32);
        seat = { id: "p_" + randomHex(12), role: "player", name, tokenHash: await hash(issuedToken) };
        // 会回确认的客户端（新版）：座位先记成待确认，20 秒内收不到确认就清掉（没收到 joined 的人不会留下幽灵座位）
        if (message.confirm === true) seat.pending = Date.now();
        this.meta.seats.push(seat); await this.ctx.storage.put("room", this.meta);
        if (seat.pending) await this.ctx.storage.setAlarm(Math.min(this.meta.expiresAt, Date.now() + this.confirmMs()));
      }
      // A valid token may replace a stale connection, but nickname alone never
      // chooses an existing seat. Old socket close events cannot evict the new one.
      for (const peer of this.authenticated()) if (this.data(peer).id === seat.id) { peer.serializeAttachment({ replaced: true }); peer.close(4001, "replaced"); }
      ws.serializeAttachment({ ...this.data(ws), id: seat.id, role: seat.role, ready: false });
      this.send(ws, this.packet("joined", { identity: { id: seat.id, name: seat.name, role: seat.role, roomCode: this.meta.code }, resumeToken: issuedToken, ...(seat.pending ? { confirmSeat: true } : {}), ...this.status() }));
      this.publish();
    } catch (error) { this.error(ws, error.message || "加入失败", null, "join", true); }
  }
  webSocketClose(ws, code, reason) {
    try { ws.close(code === 1006 ? 1011 : code, reason); } catch (_) {}
    // 还没确认就断开的新座位：直接清掉（这个人没拿到恢复令牌，回不来）
    const id = this.data(ws).id, seat = id && this.meta && this.meta.seats.find(p => p.id === id && p.pending);
    if (seat && !this.authenticated().some(peer => this.data(peer).id === id)) {
      this.meta.seats = this.meta.seats.filter(p => p !== seat);
      return this.ctx.storage.put("room", this.meta).then(() => this.publish());
    }
    this.publish();
  }
  webSocketError(ws) { try { ws.close(1011, "connection_error"); } catch (_) {} this.publish(); }
  async alarm() {
    if (!this.meta || this.meta.expiresAt <= Date.now()) {
      for (const ws of this.connections()) { this.error(ws, "房间已过期，请重新开房", null, "expired"); ws.close(1000, "expired"); }
      await this.ctx.storage.deleteAll(); this.meta = null; return;
    }
    let pending = false;
    for (const ws of this.connections()) {
      const c = this.data(ws);
      if (!c.id && Date.now() - c.opened >= 15000) ws.close(1008, "join_timeout");
      else if (!c.id) pending = true;
    }
    // 幽灵座位：20 秒内没确认的新座位清掉，在线的连接也断开（4003 released：令牌作废，可以用同一个昵称重新加入）
    const stale = this.meta.seats.filter(p => p.pending && Date.now() - p.pending >= this.confirmMs());
    if (stale.length) {
      this.meta.seats = this.meta.seats.filter(p => !stale.includes(p));
      await this.ctx.storage.put("room", this.meta);
      for (const peer of this.authenticated()) if (stale.some(p => p.id === this.data(peer).id)) { peer.serializeAttachment({ released: true }); try { peer.close(4003, "unconfirmed"); } catch (_) {} }
      this.publish();
    }
    if (this.meta.seats.some(p => p.pending)) pending = true;
    await this.ctx.storage.setAlarm(pending ? Math.min(this.meta.expiresAt, Date.now() + 15000) : this.meta.expiresAt);
  }
}
