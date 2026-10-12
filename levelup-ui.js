/* 升级画面：角色升级、武器升级、学到新技能时弹出来，列出这次多了什么（新技能、被动升级带完整说明）。
 * 本机（单机、跑团、单局、热座、联机房主）由这里自己弹；联机玩家的画面由 online-ui.js 用同一个 html() 画。
 * 联机房主只弹自己操控的角色的，玩家的角色发给对应的玩家（online-game.js）。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const skill = (s) => `<li><b>${esc(s.name)}</b>${s.cost ? `<small>${esc(s.cost)}</small>` : ""}<p>${esc(s.text)}</p></li>`;
  /** 一条升级事件画成 HTML（opts.more：后面还有几条） */
  function html(ev, opts) {
    opts = opts || {};
    const stats = (ev.stats || []).map(r => `<li>${esc(r.label)} <b>${esc(r.from)} → ${esc(r.to)}</b></li>`).join("");
    const passives = (ev.passives || []).map(p => `<li><b>${esc(p.kind === "plus" ? "被动升级：" : "新被动：")}${esc(p.name)}</b><p>${esc(p.text)}</p></li>`).join("");
    const weapons = (ev.weapons || []).map(w => `<li><b>${esc(w.name)}${w.from !== w.to ? ` Lv${esc(w.from)} → Lv${esc(w.to)}` : ""}</b>${w.slots ? `<p>新的改装槽 +${esc(w.slots)}</p>` : ""}${(w.skills || []).length ? `<ul class="lvu-skills">${w.skills.map(skill).join("")}</ul>` : ""}</li>`).join("");
    const sec = (title, body) => body ? `<section><h3>${title}</h3><ul>${body}</ul></section>` : "";
    return `<div class="lvu-card" role="dialog" aria-label="${esc(ev.title)}">
      <header><span class="lvu-tag">${ev.kind === "weapon" ? "武器升级" : ev.kind === "choice" ? "新能力" : "升级"}</span><h2>${esc(ev.title)}</h2>${ev.kind === "level" && ev.from !== ev.to ? `<p>Lv${esc(ev.from)} → Lv${esc(ev.to)}</p>` : ""}</header>
      ${sec("数值", stats)}
      ${(ev.skills || []).length ? `<section><h3>新技能</h3><ul class="lvu-skills">${ev.skills.map(skill).join("")}</ul></section>` : ""}
      ${sec("被动", passives)}
      ${sec("武器", weapons)}
      ${sec("还要选", (ev.pending || []).map(t => `<li>${esc(t)}</li>`).join(""))}
      <footer><button type="button" class="lvu-ok" data-lvu="ok">${opts.more ? `知道了（还有 ${esc(opts.more)} 条）` : "知道了"}</button></footer>
    </div>`;
  }
  const CSS = `
.lvu-overlay { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(8, 6, 4, .72); }
.lvu-overlay[hidden] { display: none; }
.lvu-card { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: #1f1a14; color: #f1e6d2; border: 2px solid #f5c542; box-shadow: 6px 6px #000a; padding: 16px 18px; font-size: 14px; line-height: 1.5; }
.lvu-card header { display: block; text-align: left; }
.lvu-card header h2 { margin: 4px 0; font-size: 22px; color: #f5c542; }
.lvu-card header p { margin: 0; opacity: .8; }
.lvu-tag { display: inline-block; background: #f5c542; color: #1f1a14; font-weight: 700; padding: 0 8px; font-size: 12px; }
.lvu-card section { margin-top: 12px; }
.lvu-card h3 { margin: 0 0 4px; font-size: 15px; color: #39e6b4; }
.lvu-card ul { margin: 0; padding-left: 18px; }
.lvu-card li { margin: 2px 0; }
.lvu-card li p { margin: 2px 0 6px; opacity: .9; }
.lvu-card li small { margin-left: 8px; opacity: .7; }
.lvu-card footer { margin-top: 14px; text-align: right; }
.lvu-ok { background: #f5c542; color: #1f1a14; border: 0; font-weight: 700; padding: 8px 18px; cursor: pointer; font-size: 15px; }`;
  function ensureStyle() {
    if (typeof document === "undefined" || document.getElementById("g-levelup-style")) return;
    const st = document.createElement("style"); st.id = "g-levelup-style"; st.textContent = CSS;
    document.head.appendChild(st);
  }
  let box = null, showing = null;
  /** 联机房主只看自己操控的角色；不联机全都看 */
  function mine(ev) {
    const OG = root.OnlineGame;
    if (!OG || !OG.getView().active) return true;
    if (!OG.isHost()) return false;
    return !OG.ownerOfKit || OG.ownerOfKit(ev.kit) === OG.getView().identity.id;
  }
  function tick() {
    if (typeof LevelUp === "undefined" || typeof document === "undefined" || !document.body) return;
    if (document.body.classList.contains("online-player")) return;      // 联机玩家：online-ui.js 来画
    if (root.__noLevelUpPopup) return;                                  // 测试开关（和 GAME.skip 一样，只给测试用）
    if (root.GAME && GAME.depth > 0) return;                            // 动画放完再弹
    const list = LevelUp.unseen().filter(mine);
    if (showing && list.some(e => e.id === showing)) {
      // 看的时候又来了新的：只更新「还有几条」
      if (box && box.dataset.more !== String(list.length - 1)) { box.innerHTML = html(list.find(e => e.id === showing), { more: list.length - 1 }); box.dataset.more = String(list.length - 1); }
      return;
    }
    showing = null;
    if (!list.length) { if (box) box.hidden = true; return; }
    ensureStyle();
    if (!box) {
      box = document.createElement("div"); box.id = "g-levelup"; box.className = "lvu-overlay";
      box.addEventListener("click", e => {
        if (!e.target.closest('[data-lvu="ok"]')) return;
        if (showing) LevelUp.markSeen(showing);
        showing = null; box.hidden = true;
        if (root.OnlineGame && OnlineGame.touch) OnlineGame.touch();
        tick();
      });
      document.body.appendChild(box);
    }
    showing = list[0].id;
    box.innerHTML = html(list[0], { more: list.length - 1 });
    box.dataset.more = String(list.length - 1);
    box.hidden = false;
    if (root.Sfx && list[0].kind === "level") try { Sfx.ui("levelup"); } catch (e) { /* 没有音效 */ }
  }
  root.LevelUpUI = { html, ensureStyle, tick, CSS };
  if (typeof setInterval === "function" && typeof document !== "undefined") setInterval(tick, 400);
})(typeof window !== "undefined" ? window : globalThis);
