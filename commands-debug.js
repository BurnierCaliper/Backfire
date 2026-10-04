// Opt-in local debug menu. No changes to player state or save schemas.
(function () {
  "use strict";
  function boot() {
    if (new URLSearchParams(location.search).get("debug") !== "1") return;
    const panel = document.createElement("details");
    panel.id = "command-debug";
    panel.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:10000;background:#eee4d2;color:#171512;border:2px solid #49423b;padding:8px;max-width:calc(100vw - 20px);font:14px system-ui";
    const title = document.createElement("summary");
    title.textContent = "本机调试";
    const button = document.createElement("button");
    button.id = "command-log-export";
    button.className = "g-btn";
    button.textContent = "导出指令日志";
    button.addEventListener("click", () => Commands.downloadLog());
    const note = document.createElement("p");
    note.textContent = "导出最近 1,000 条本机指令与结果，不上传，也不写入游戏存档。";
    panel.append(title, button, note);
    document.body.appendChild(panel);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
