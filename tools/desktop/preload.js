// Electron 不支持 window.prompt()（游戏里给团起名、改存档名、填任务失败原因要用）：
// 交给主进程弹一个小输入窗口，同步等结果，用起来和浏览器里一样
"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("__backfirePrompt", (message, value) => ipcRenderer.sendSync("bf-prompt", String(message == null ? "" : message), value == null ? "" : String(value)));
