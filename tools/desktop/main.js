// Backfire 桌面版（Electron 壳）：打开游戏标题画面，其余和浏览器里玩一模一样
"use strict";
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: "#120f0c",
    title: "Antlerscale: Backfire",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.js") }
  });
  win.loadFile(path.join(__dirname, "game", "game.html"));
  // 页面里的 prompt() 换成主进程的小输入窗口（见 preload.js）
  win.webContents.on("dom-ready", () => {
    win.webContents.executeJavaScript("window.prompt = (m, v) => window.__backfirePrompt(m, v);").catch(() => {});
  });
  // 游戏里的外部链接（例如转发服务说明）用系统浏览器打开，不在游戏窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: "deny" }; }
    return { action: "allow" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  // F11 全屏、F12 开发者工具（排查问题用）
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === "F12") { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
}

/** 小输入窗口：标题是提示文字，确定返回输入的内容，取消 / 关掉返回 null */
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
ipcMain.on("bf-prompt", (event, message, value) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const box = new BrowserWindow({
    parent, modal: true, width: 420, height: 190, resizable: false, minimizable: false, maximizable: false,
    title: "Backfire", backgroundColor: "#1d1813", autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  let done = false;
  const finish = (v) => { if (done) return; done = true; event.returnValue = v; if (!box.isDestroyed()) box.destroy(); };
  const html = `<!doctype html><meta charset="utf-8"><title>Backfire</title>
<style>body{margin:0;padding:16px 18px;background:#1d1813;color:#f1e6cf;font:14px "Microsoft YaHei","PingFang SC",sans-serif}
p{margin:0 0 10px}input{width:100%;box-sizing:border-box;padding:7px 9px;font:inherit;background:#0d0b09;color:#f1e6cf;border:1px solid #4d4337}
div{margin-top:14px;text-align:right}button{font:inherit;margin-left:8px;padding:5px 16px;background:#2a231c;color:#f1e6cf;border:1px solid #4d4337;cursor:pointer}
button.ok{background:#c99a46;color:#1a140d;border-color:#c99a46}</style>
<p>${esc(message)}</p><input id="v" value="${esc(value)}"><div><button id="no">取消</button><button class="ok" id="ok">确定</button></div>
<script>const v=document.getElementById("v");v.focus();v.select();
const send=(x)=>{document.title="BF-DONE:"+JSON.stringify(x);};
document.getElementById("ok").onclick=()=>send(v.value);document.getElementById("no").onclick=()=>send(null);
addEventListener("keydown",e=>{if(e.key==="Enter")send(v.value);if(e.key==="Escape")send(null);});</script>`;
  // 小窗口用标题把结果传回来（沙箱里不开 node，也不用再加一个 preload）
  box.on("page-title-updated", (e, title) => {
    if (!title.startsWith("BF-DONE:")) return;
    e.preventDefault();
    try { finish(JSON.parse(title.slice(8))); } catch (err) { finish(null); }
  });
  box.on("closed", () => finish(null));
  box.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
});

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
