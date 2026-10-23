// 长线养成抽取机的抽取动画（PR #332）：单抽 / 十连，卡片按光色（金 / 紫 / 蓝 / 灰）发光，金色最强；
// 十连依次翻开（可「跳过」），最后是汇总：每一条的名字、光色、角色升级信息和奎支合计。
// 只用 CSS + 少量 JS，没有新图片；prefers-reduced-motion 时不播翻牌，直接出汇总。
// 纯函数 GachaUI.panelHtml / resultHtml / summaryHtml 给测试用；GachaUI.play(result) 在页面上弹层。
(function (global) {
  "use strict";
  const LIGHT = { gold: "金", purple: "紫", blue: "蓝", gray: "灰" };
  const KIND = { character: "角色", weapon_material: "武器升级材料", craft_material: "制作材料" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((Number(x) || 0) * 1000) / 10}%`;
  const light = (l) => (LIGHT[l] ? l : "gray");

  /** 一条结果的说明：角色写「新加入 · N 级」或「升到 N 级」 */
  function detail(r) {
    if (r.kind === "character") return r.levelUp ? `已有角色 · 升到 ${r.level} 级` : `新角色加入 · ${r.level} 级`;
    return KIND[r.kind] || "";
  }
  /** 抽取机面板：融合体数量、三种概率、单抽 / 十连按钮（不够就置灰写原因） */
  function panelHtml(d, fusionName) {
    const r = d.rates || {};
    const ten = 10 * (d.cost || 1);
    const tenWhy = !d.canDraw ? d.why : d.fusion < ten ? `${fusionName}不够十连（要 ${ten}，有 ${d.fusion}）` : "";
    return `<div class="gacha-panel">
      <p class="r-hint">每抽投入 ${d.cost} 个${esc(fusionName)}，不一定是角色：
        <span class="g-rate g-gold">角色 ${pct(r.hero)}</span>
        <span class="g-rate g-purple">武器升级材料 ${pct(r.weapon)}</span>
        <span class="g-rate g-blue">制作材料 ${pct(r.craft)}</span>（没有保底）。
        抽到新角色加入队伍（满员进候补），已有的角色 +1 级；每抽按光色附赠奎支：灰 100 · 蓝 150 · 紫 500 · 金 1000。${d.allMaxed ? "<b>所有角色都已满级，现在只出材料。</b>" : ""}</p>
      <p class="r-hint">手里有 <b class="g-fusion">${d.fusion}</b> 个${esc(fusionName)}。</p>
      <div class="gacha-btns">
        <button class="g-btn r-main" id="r-draw" ${d.canDraw ? "" : "disabled"}>${d.canDraw ? `抽一次（${d.cost}）` : esc(d.why)}</button>
        <button class="g-btn r-main" id="r-draw10" ${tenWhy ? `disabled title="${esc(tenWhy)}"` : ""}>${tenWhy ? esc(tenWhy) : `十连抽（${ten}）`}</button>
      </div>
    </div>`;
  }
  function cardHtml(r, i) {
    const l = light(r.light);
    return `<div class="g-card g-${l}" data-i="${i}" style="--i:${i}">
      <div class="g-orb"></div>
      <div class="g-face"><b>${esc(r.name)}</b><small>${esc(detail(r))}</small><span class="g-tag">${LIGHT[l]}光 · +${r.kuizhi || 0} 奎支</span></div>
    </div>`;
  }
  function summaryHtml(res) {
    const rows = res.results.map(r => `<li class="g-${light(r.light)}"><span class="g-dot"></span><b>${esc(r.name)}</b><small>${LIGHT[light(r.light)]}光 · ${esc(detail(r))}</small><span>+${r.kuizhi || 0}</span></li>`).join("");
    return `<div class="g-summary"><h3>抽取结果</h3><ol>${rows}</ol><p>共获得 <b>${res.kuizhi || 0}</b> 奎支</p></div>`;
  }
  function resultHtml(res) {
    const many = res.results.length > 1;
    return `<div class="gacha-overlay" role="dialog" aria-label="抽取结果">
      <div class="gacha-box">
        <div class="g-cards${many ? " g-grid" : ""}">${res.results.map(cardHtml).join("")}</div>
        <div class="g-actions"><button class="g-btn" data-g="skip">跳过</button><button class="g-btn r-main" data-g="close" hidden>确定</button></div>
        <div class="g-sum-slot" hidden>${summaryHtml(res)}</div>
      </div></div>`;
  }
  const reduced = () => !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  /** 播放：卡片一张一张翻开（金色多停一会），跳过 = 全部翻开并出汇总 */
  function play(res, opt) {
    const doc = global.document;
    if (!doc || !res || !res.results || !res.results.length) return null;
    const wrap = doc.createElement("div");
    wrap.innerHTML = resultHtml(res);
    const ov = wrap.firstElementChild;
    doc.body.appendChild(ov);
    const cards = Array.from(ov.querySelectorAll(".g-card"));
    const skipB = ov.querySelector('[data-g="skip"]'), closeB = ov.querySelector('[data-g="close"]');
    let timer = null, i = 0, done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      cards.forEach(c => c.classList.add("open"));
      ov.querySelector(".g-sum-slot").hidden = false;
      skipB.hidden = true; closeB.hidden = false; closeB.focus();
    };
    const step = () => {
      if (i >= cards.length) return finish();
      const c = cards[i++]; c.classList.add("open");
      timer = setTimeout(step, c.classList.contains("g-gold") ? 900 : cards.length > 1 ? 320 : 600);
    };
    skipB.onclick = finish;
    closeB.onclick = () => { ov.remove(); if (opt && opt.onClose) opt.onClose(); };
    if (reduced() || (opt && opt.instant)) finish(); else timer = setTimeout(step, 250);
    return ov;
  }
  global.GachaUI = { panelHtml, resultHtml, summaryHtml, detail, play, LIGHT };
})(typeof window !== "undefined" ? window : globalThis);
