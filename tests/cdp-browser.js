// 没装 Playwright 时的备用浏览器（#298 的画面测试用）：直接用 Chrome 的调试协议（CDP）开一个无界面的 Chrome，
// 只实现测试里用到的那几个 Playwright 接口：
//   browser.newContext({ viewport, isMobile, hasTouch }) / context.newPage() / context.close() / browser.close()
//   page.goto / setContent / addScriptTag / addStyleTag / evaluate / click / focus / fill / keyboard.press /
//   waitForFunction / waitForSelector / waitForTimeout / isVisible / locator(sel).count / innerText / evaluate / click / on("pageerror")
// 只在 Linux（GitHub 上跑测试的机器自带 Chrome）或者用环境变量 CHROME_PATH 指定了 Chrome 时才用；
// 别的情况（Windows / Mac 没装 Playwright）返回 null，测试照旧跳过。要 Node 22 自带的 WebSocket。
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const LINUX_CHROME = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
function chromePath() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  if (process.platform !== "linux") return null;
  return LINUX_CHROME.find(p => fs.existsSync(p)) || null;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0;
    const pending = new Map(), listeners = new Set();
    const conn = {
      send(method, params = {}, sessionId) {
        const msg = { id: ++seq, method, params };
        if (sessionId) msg.sessionId = sessionId;
        return new Promise((res, rej) => { pending.set(msg.id, { res, rej, method }); ws.send(JSON.stringify(msg)); });
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { try { ws.close(); } catch (_) { /* 已经断了 */ } }
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.rej(new Error(p.method + "：" + msg.error.message)); else p.res(msg.result || {});
      } else listeners.forEach(fn => fn(msg));
    };
    ws.onopen = () => resolve(conn);
    ws.onerror = e => reject(new Error("连不上 Chrome：" + (e && e.message || "WebSocket error")));
    ws.onclose = () => { for (const p of pending.values()) p.rej(new Error(p.method + "：Chrome 已关闭")); pending.clear(); };
  });
}

const KEYS = { Escape: ["Escape", 27], Enter: ["Enter", 13, "\r"], Tab: ["Tab", 9], " ": ["Space", 32, " "], Space: ["Space", 32, " ", " "] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Page {
  constructor(conn, sessionId) {
    this.conn = conn; this.sessionId = sessionId; this.handlers = {}; this.onLoad = null;
    this.keyboard = { press: key => this.press(key) };
    this.off = conn.on(msg => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails || {}, ex = d.exception || {};
        const text = String(ex.description || ex.value || d.text || "error").split("\n")[0].replace(/^Uncaught\s+/, "");
        (this.handlers.pageerror || []).forEach(fn => fn(new Error(text.replace(/^\w*Error:\s*/, ""))));
      } else if (msg.method === "Page.loadEventFired" && this.onLoad) this.onLoad();
      else if (msg.method === "Page.javascriptDialogOpening") this.send("Page.handleJavaScriptDialog", { accept: true, promptText: "" }).catch(() => {});
    });
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  async init(opt) {
    await this.send("Page.enable"); await this.send("Runtime.enable");
    const vp = opt.viewport || { width: 1280, height: 720 };
    await this.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: !!opt.isMobile });
    if (opt.hasTouch) await this.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
  async goto(url) {
    const loaded = new Promise(r => { this.onLoad = r; });
    await this.send("Page.navigate", { url });
    await loaded; this.onLoad = null;
  }
  async setContent(html) {
    const { frameTree } = await this.send("Page.getFrameTree");
    await this.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
  }
  async evaluate(fn, arg) {
    const expression = typeof fn === "function" ? `(${fn})(${arg === undefined ? "" : JSON.stringify(arg)})` : String(fn);
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails.exception || {};
      throw new Error("page.evaluate: " + String(ex.description || ex.value || r.exceptionDetails.text).split("\n")[0]);
    }
    return r.result ? r.result.value : undefined;
  }
  async addScriptTag({ path: file }) {
    await this.evaluate(src => { const el = document.createElement("script"); el.textContent = src; document.head.appendChild(el); }, fs.readFileSync(file, "utf8"));
  }
  async addStyleTag({ path: file }) {
    await this.evaluate(css => { const el = document.createElement("style"); el.textContent = css; document.head.appendChild(el); }, fs.readFileSync(file, "utf8"));
  }
  /** 元素中心点（滚进画面）；hit = 点下去真的点到它（没被别的东西盖住） */
  point(selector) {
    return this.evaluate(sel => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect(), st = getComputedStyle(el);
      if (!r.width || !r.height || st.visibility === "hidden") return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, hit: !!hit && (hit === el || el.contains(hit)) };
    }, selector);
  }
  async click(selector, opt = {}) {
    const end = Date.now() + (opt.timeout || 5000);
    let p = null;
    for (;;) {
      p = await this.point(selector);
      if (p && p.hit) break;
      if (Date.now() > end) throw new Error(`click：${selector} ${p ? "被别的东西盖住了" : "不存在或看不见"}`);
      await sleep(50);
    }
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", buttons: 1, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", buttons: 0, clickCount: 1 });
  }
  async press(key) {
    let k = KEYS[key];
    if (!k && /^[0-9]$/.test(key)) k = ["Digit" + key, key.charCodeAt(0), key];
    else if (!k && /^[a-z]$/i.test(key)) k = ["Key" + key.toUpperCase(), key.toUpperCase().charCodeAt(0), key];
    if (!k) throw new Error("不支持的按键：" + key);
    const [code, keyCode, text, name] = k;
    const base = { key: name || key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send("Input.dispatchKeyEvent", Object.assign({ type: text ? "keyDown" : "rawKeyDown" }, text ? { text } : {}, base));
    await this.send("Input.dispatchKeyEvent", Object.assign({ type: "keyUp" }, base));
  }
  focus(selector) { return this.evaluate(sel => { const el = document.querySelector(sel); if (!el) throw new Error("找不到 " + sel); el.focus(); }, selector); }
  async fill(selector, value) {
    await this.focus(selector);
    await this.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); }, [selector, value]);
  }
  isVisible(selector) {
    return this.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; }, selector);
  }
  async waitForFunction(fn, arg, opt = {}) {
    const end = Date.now() + (opt && opt.timeout || 5000);
    for (;;) {
      const v = await this.evaluate(fn, arg === null ? undefined : arg);
      if (v) return v;
      if (Date.now() > end) throw new Error("waitForFunction 超时：" + String(fn).slice(0, 120));
      await sleep(30);
    }
  }
  async waitForSelector(selector, opt = {}) {
    const state = opt.state || "visible", end = Date.now() + (opt.timeout || 5000);
    for (;;) {
      const s = await this.evaluate(sel => { const el = document.querySelector(sel); if (!el) return "detached"; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" ? "visible" : "hidden"; }, selector);
      if (s === state || (state === "attached" && s !== "detached") || (state === "hidden" && s === "detached")) return;
      if (Date.now() > end) throw new Error(`waitForSelector 超时：${selector}（${state}，现在 ${s}）`);
      await sleep(30);
    }
  }
  waitForTimeout(ms) { return sleep(ms); }
  locator(selector) {
    const page = this;
    return {
      count: () => page.evaluate(sel => document.querySelectorAll(sel).length, selector),
      isVisible: () => page.isVisible(selector),
      click: opt => page.click(selector, opt),
      async innerText() { await page.waitForSelector(selector, { state: "attached" }); return page.evaluate(sel => document.querySelector(sel).innerText, selector); },
      async evaluate(fn, arg) {
        await page.waitForSelector(selector, { state: "attached" });
        return page.evaluate(`(${fn})(document.querySelector(${JSON.stringify(selector)}), ${arg === undefined ? "undefined" : JSON.stringify(arg)})`);
      }
    };
  }
}

class Context {
  constructor(conn, id, opt) { this.conn = conn; this.id = id; this.opt = opt || {}; this.pages = []; }
  async newPage() {
    const { targetId } = await this.conn.send("Target.createTarget", { url: "about:blank", browserContextId: this.id });
    const { sessionId } = await this.conn.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this.conn, sessionId);
    await page.init(this.opt);
    this.pages.push(page);
    return page;
  }
  async close() {
    this.pages.forEach(p => p.off());
    await this.conn.send("Target.disposeBrowserContext", { browserContextId: this.id }).catch(() => {});
  }
}

class Browser {
  constructor(conn, proc, dir) { this.conn = conn; this.proc = proc; this.dir = dir; }
  async newContext(opt) {
    const { browserContextId } = await this.conn.send("Target.createBrowserContext", {});
    return new Context(this.conn, browserContextId, opt);
  }
  async close() {
    await this.conn.send("Browser.close").catch(() => {});
    this.conn.close();
    try { this.proc.kill(); } catch (_) { /* 已经退出 */ }
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch (_) { /* 临时目录删不掉就算了 */ }
  }
}

/** 开一个无界面的 Chrome；找不到 Chrome（或 Node 没有 WebSocket）返回 null */
async function launch() {
  const exe = chromePath();
  if (!exe || typeof WebSocket !== "function") return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backfire-cdp-"));
  // --no-sandbox：和 Playwright 默认一样（新版 Ubuntu 不让普通用户开沙箱）；只打开本地文件
  const proc = spawn(exe, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--disable-background-networking", "--allow-file-access-from-files", "--remote-debugging-port=0", "--user-data-dir=" + dir, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome 15 秒内没有启动")), 15000);
    proc.stderr.on("data", d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(timer); resolve(m[1]); } });
    proc.on("error", e => { clearTimeout(timer); reject(e); });
    proc.on("exit", code => { clearTimeout(timer); reject(new Error("Chrome 退出了（" + code + "）")); });
  });
  return new Browser(await connect(url), proc, dir);
}

module.exports = { launch, chromePath };
