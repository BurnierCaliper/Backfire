/* 长休结算画面（issue #52）：单局休息点 / 任务间休整、跑团长休、联机玩家共用。
 *   RestReport.html(report, { gm })   画面内容（report 来自 ledger.js · restReport）
 *   RestReport.show(report, { gm })   弹出（点「好」或按 Esc 关）
 * 坚毅生命：gm 为真（跑团主持人）才写数值；否则只写按比例抽的那一句（report.heroes[].mood）。
 * 守夜的人标红：这次长休没恢复。 */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = m => { m = ((Math.floor(Number(m) || 0) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const EXHAUST = ["没有力竭", "力竭 1", "力竭 2", "力竭 3", "力竭致死"];
  const arrow = (a, b) => (a === b ? `${esc(b)}` : `${esc(a)} → <b>${esc(b)}</b>`);
  function heroRow(h, gm) {
    const ws = (h.weapons || []).map(w => `<span class="rr-w">${esc(w.name)} 耐久 ${arrow(w.dur[0], w.dur[1])}/${esc(w.max)}</span>`).join("");
    const shp = gm && h.shp ? `<span class="rr-gm">坚毅 ${arrow(h.shp[0], h.shp[1])}/${esc(h.shpMax)}（仅主持人）</span>` : "";
    return `<li class="rr-hero${h.watch ? " rr-watch" : ""}${h.dead ? " rr-dead" : ""}">
      <div class="rr-head"><span class="rr-ava" aria-hidden="true">${esc(String(h.name || "?").slice(0, 1))}</span><b>${esc(h.name)}</b>${h.watch ? '<span class="rr-tag">守夜 · 没有恢复</span>' : ""}${h.dead ? '<span class="rr-tag">已阵亡</span>' : ""}</div>
      ${h.dead ? "" : `<div class="rr-nums"><span>血量 ${arrow(h.hp[0], h.hp[1])}/${esc(h.hpMax)}</span>${ws}${shp}</div>`}
      ${h.mood ? `<p class="rr-mood">「${esc(h.mood)}」</p>` : ""}
    </li>`;
  }
  function html(r, opt) {
    if (!r) return "";
    const gm = !!(opt && opt.gm);
    const day = r.to.day !== r.from.day ? `第 ${esc(r.from.day)} 天 ${clock(r.from.clock)} → 第 ${esc(r.to.day)} 天 ${clock(r.to.clock)}` : `${clock(r.from.clock)} → ${clock(r.to.clock)}`;
    const supply = r.ok ? (r.forced ? "主持人安排的休息，不扣补给" : `消耗 ${esc(r.water)} ml 水、${esc(r.food)} 份食物`) : "补给不够，只能硬撑着消磨时间：没有恢复";
    const ex = r.exhaust && r.exhaust[0] !== r.exhaust[1] ? `${EXHAUST[r.exhaust[0]] || ""} → ${EXHAUST[r.exhaust[1]] || ""}` : (EXHAUST[(r.exhaust || [0])[1]] || "");
    const ambush = r.ambush ? `<p class="rr-line rr-bad">${esc(r.ambush.text || "休息前被偷袭了")}</p>` : "";
    return `<div class="rr-card" role="document">
      <header><h2>${r.ok ? "长休结束" : "没能好好休息"}</h2><span class="rr-time">${day} · ${esc(r.hours)} 小时</span></header>
      ${ambush}
      <p class="rr-line">${supply} · ${esc(ex)}${r.watch ? ` · <span class="rr-bad">${esc(r.watch)} 守夜</span>` : ""}</p>
      <ul class="rr-list">${(r.heroes || []).map(h => heroRow(h, gm)).join("")}</ul>
      <footer><button type="button" class="g-btn r-main" data-rr="close">好</button></footer>
    </div>`;
  }
  /* ---------- 营地画面（长休前）---------- */
  const EX_SHORT = ["精神还好", "力竭 1：起不来了", "力竭 2：atk −3 def −1", "力竭 3：倒下即死", "力竭致死"];
  function campHtml(c, opt) {
    opt = opt || {};
    const gm = !!opt.gm;
    const ok = (n, h) => (h >= n ? `<b class="rr-ok">${esc(h)}</b>/${esc(n)}` : `<b class="rr-bad">${esc(h)}</b>/${esc(n)}`);
    const heroes = (c.heroes || []).map(h => `<li class="rr-hero${h.dead ? " rr-dead" : ""}">
        <div class="rr-head"><span class="rr-ava" aria-hidden="true">${esc(String(h.name || "?").slice(0, 1))}</span><b>${esc(h.name)}</b>${h.dead ? '<span class="rr-tag">已阵亡</span>' : h.dying ? '<span class="rr-tag">濒死</span>' : ""}${h.mood ? `<span class="rr-mood-tag">${esc(h.mood)}</span>` : ""}</div>
        ${h.dead ? "" : `<div class="rr-nums"><span>血量 ${esc(h.hp)}/${esc(h.hpMax)}</span>${(h.weapons || []).map(w => `<span class="rr-w">${esc(w.name)} 耐久 ${esc(w.dur)}/${esc(w.max)}</span>`).join("")}${gm && h.shpMax ? `<span class="rr-gm">坚毅 ${esc(h.shp)}/${esc(h.shpMax)}（仅主持人）</span>` : ""}</div>`}
      </li>`).join("");
    const btns = opt.host
      ? `<button type="button" class="g-btn" data-rr="cancel">先不休息</button><button type="button" class="g-btn r-main" data-rr="start">${c.ok || opt.force ? "开始长休" : "硬撑着过夜"}</button>`
      : `<span class="rr-line">等${opt.hostName ? esc(opt.hostName) : "主持人"}开始长休。可以在小队频道里聊聊。</span>`;
    return `<div class="rr-card rr-camp" role="document">
      <header><h2>营地</h2><span class="rr-time">${c.day ? `第 ${esc(c.day)} 天 ` : ""}${clock(c.clock)} · 距上次长休 ${esc(c.hoursAwake)} 小时 · ${esc(EX_SHORT[c.exhaust] || "")}</span></header>
      <p class="rr-line">长休需要：水 ${ok(c.water.need, c.water.have)} ml · 食物 ${ok(c.food.need, c.food.have)} 份${c.ok ? "" : ` · <span class="rr-bad">${esc((c.lack || []).join("，"))}</span>`}${opt.force ? " · 主持人安排的休息，不扣补给" : ""}</p>
      ${c.ok || opt.force ? "" : '<p class="rr-line rr-bad">补给不足，只能硬撑着过夜：不回血，力竭继续累积，时间照样过。</p>'}
      <p class="rr-line">篝火噼啪作响。趁着还没睡下，大家可以说说话。</p>
      <ul class="rr-list">${heroes}</ul>
      <footer>${btns}</footer>
    </div>`;
  }

  /* ---------- 日月动画：太阳、月亮在同一条弧线上交替，位置照游戏时钟（白天 05:00–18:00）----------
   * 太阳在规则上的白天出来：和 ledger.js · isNightClock 同一张表（daylight.js 的 DAY_LIGHT：白天开始 → 傍晚开始） */
  const dayLight = () => root.DayLight || (typeof require === "function" ? require("./daylight") : null);
  const SKY = [[0, [11, 16, 38]], [4.5, [26, 31, 61]], [5.5, [224, 144, 90]], [7, [106, 167, 216]], [16.5, [106, 167, 216]], [18, [217, 116, 74]], [19, [42, 35, 80]], [24, [11, 16, 38]]];
  function skyColor(min) {
    const h = (((min % 1440) + 1440) % 1440) / 60;
    for (let i = 1; i < SKY.length; i++) {
      if (h <= SKY[i][0]) {
        const [h0, c0] = SKY[i - 1], [h1, c1] = SKY[i], k = (h - h0) / (h1 - h0 || 1);
        return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(",")})`;
      }
    }
    return "rgb(11,16,38)";
  }
  /** 某个时刻太阳 / 月亮在弧线上的位置：{ body: sun / moon, x, y }（百分比） */
  function skyPos(min) {
    const m = ((min % 1440) + 1440) % 1440;
    const T = dayLight().DAY_LIGHT, DAY_START = T.day, DAY_END = T.dusk;
    const day = !dayLight().isNight(m);
    const t = day ? (m - DAY_START) / (DAY_END - DAY_START) : ((m - DAY_END + 1440) % 1440) / (1440 - (DAY_END - DAY_START));
    return { body: day ? "sun" : "moon", x: 8 + t * 84, y: 78 - Math.sin(Math.PI * t) * 62 };
  }
  function skyHtml() {
    return `<div class="rr-card rr-skycard" role="document">
      <div class="rr-sky"><span class="rr-body rr-sun" aria-hidden="true"></span><span class="rr-body rr-moon" aria-hidden="true"></span><div class="rr-ground"></div><div class="rr-clock"></div></div>
      <footer><button type="button" class="g-btn" data-rr="skip">跳过</button></footer></div>`;
  }
  function paintSky(el, min, startDay, showDay) {
    const sky = el.querySelector(".rr-sky"); if (!sky) return;
    sky.style.background = skyColor(min);
    const p = skyPos(min);
    const sun = sky.querySelector(".rr-sun"), moon = sky.querySelector(".rr-moon");
    const on = p.body === "sun" ? sun : moon, off = p.body === "sun" ? moon : sun;
    on.style.left = p.x + "%"; on.style.top = p.y + "%"; on.style.opacity = "1"; off.style.opacity = "0";
    const day = startDay + Math.floor(min / 1440);
    sky.querySelector(".rr-clock").textContent = `${showDay ? `第 ${day} 天 ` : ""}${clock(min)}`;
  }

  let box = null;
  function overlay() {
    if (typeof document === "undefined") return null;
    if (!box) {
      box = document.createElement("section");
      box.id = "rest-report"; box.className = "rr-overlay"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "长休结算");
      box.addEventListener("click", e => { if (e.target.closest('[data-rr="close"]') || (e.target === box && !box.querySelector(".rr-camp, .rr-skycard"))) box.hidden = true; });
      box.addEventListener("keydown", e => { if (e.key === "Escape") box.hidden = true; });
      document.body.appendChild(box);
    }
    return box;
  }
  let playing = null;
  function show(r, opt) {
    if (!r || !overlay()) return;
    if (playing) { playing(); playing = null; }
    box.innerHTML = html(r, opt);
    box.hidden = false;
    box.querySelector('[data-rr="close"]')?.focus({ preventScroll: true });
  }
  /** 先播日月动画（睡了多久就从入睡的时刻走到醒来的时刻，约 3 秒），再显示结算。可以跳过 */
  function play(r, opt) {
    if (!r || !overlay()) return;
    const total = Math.max(0, Number(r.hours) || 0) * 60;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!r.ok || !total || reduce || typeof requestAnimationFrame !== "function" || (opt && opt.instant)) return show(r, opt);
    if (playing) { playing(); playing = null; }
    box.innerHTML = skyHtml();
    box.hidden = false;
    const start = Number(r.from && r.from.clock) || 0, startDay = Number(r.from && r.from.day) || 1;
    const showDay = !!(r.to && r.from && r.to.day > r.from.day);   // 单局按任务天数记日子，长休不换天：不写天数
    const ms = Math.min(4000, 1500 + total * 3), t0 = (typeof performance !== "undefined" ? performance : Date).now();
    let done = false, raf = 0;
    const finish = () => { if (done) return; done = true; cancelAnimationFrame(raf); playing = null; show(r, opt); };
    playing = () => { done = true; cancelAnimationFrame(raf); };
    const step = now => {
      if (done) return;
      const k = Math.min(1, (now - t0) / ms);
      paintSky(box, start + total * k, startDay, showDay);
      if (k >= 1) return setTimeout(finish, 400);
      raf = requestAnimationFrame(step);
    };
    paintSky(box, start, startDay, showDay);
    box.querySelector('[data-rr="skip"]').onclick = finish;
    raf = requestAnimationFrame(step);
  }
  /** 营地画面：opt.host 有「开始长休 / 先不休息」（onStart / onCancel）；玩家只看，等主持人开始 */
  function camp(c, opt) {
    if (!c || !overlay()) return;
    opt = opt || {};
    if (playing) { playing(); playing = null; }
    box.innerHTML = campHtml(c, opt);
    box.hidden = false;
    const start = box.querySelector('[data-rr="start"]'), cancel = box.querySelector('[data-rr="cancel"]');
    if (start) start.onclick = () => { box.hidden = true; if (opt.onStart) opt.onStart(); };
    if (cancel) cancel.onclick = () => { box.hidden = true; if (opt.onCancel) opt.onCancel(); };
    (start || box.querySelector("button"))?.focus({ preventScroll: true });
  }
  function hide() { if (box) box.hidden = true; if (playing) { playing(); playing = null; } }
  function isOpen(kind) { return !!(box && !box.hidden && (!kind || box.querySelector(kind === "camp" ? ".rr-camp" : kind === "sky" ? ".rr-skycard" : ".rr-card:not(.rr-camp):not(.rr-skycard)"))); }
  root.RestReport = { html, show, play, camp, campHtml, hide, isOpen, skyPos, skyColor };
})(typeof globalThis !== "undefined" ? globalThis : window);
