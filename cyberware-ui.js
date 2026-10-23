/* 诊所 · 义体（cyberware.js）浮层：外框和工坊 / 背包同一套（workshop.css · .ovl / .ovl-card / .ws-head），这里只放内容。
 * 数据只走一个适配层：CyberwareUI.localModel(...)（单机 / 房主，query("cyberware") / query("cyberwarePreview")）
 *   和 CyberwareUI.viewModel(view, ...)（联机玩家，online-view.js · projectCyberware 之后的 view.cyberware）
 *   都变成同一个界面模型：{ heroes:[{kit,name}], kit, packet:{kit,view,shop}, money, net, preview?(id), error, note }
 * 红线：坚毅（shp）数值永远不出现；只显示 burdenText / warning。发动的具体消耗写在图鉴「义体」里（固定的规则文字）。
 * 按钮发出的指令：{ action:"installCyberware"|"removeCyberware", kit, id }，交给打开浮层的一方的 act()。
 * 以新换旧：同系列装着另一件时，房主的预览 / 目录带 replaces（会先拆掉哪件）、replaceCost（它的拆除费）；
 *   指令还是 installCyberware，房主那边一起拆旧装新（cyberware.js · cyberwareInstall）。
 * 5 级解锁（#315）：view.locked 时目录照常能看，安装 / 拆除按钮灰掉、写「5 级解锁」；真正拦下的是房主 / 本机的规则（cyberwareLockWhy）。
 * 档位等级（#315 追加）：目录 / 预览里那一件带 needLevel 时（档位要的等级还没到），它照样列出来，安装 / 以新换旧按钮灰掉、写「需要 10 级」之类；
 *   原因是房主算好的 error（cyberware.js · cyberwareTierNeed）。拆除不看档位。 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => (typeof v === "number" && isFinite(v) ? v : 0);
  const pc = v => `${Math.round(num(v) * 10) / 10}%`;
  const cmdAttr = cmd => `data-cw-cmd="${esc(JSON.stringify(cmd))}"`;
  const ELEMENT = { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐振" };
  const RANGE = { melee: "近战", ranged: "远程" };
  const KIND = { attack: "单体伤害型" };   // 老包没有 kindName / summary 时才用
  const HEAVY = "这会给身体带来极大负担。";
  const RULE = "义体不能升级：同一系列只能装一件，换等级就以新换旧（付旧的拆除费 + 新的价格）。发动的消耗见图鉴「义体」。";

  const ui = { kit: "", confirm: "" };
  function resetUi() { ui.kit = ""; ui.confirm = ""; }

  /* ---------- 适配层 ---------- */
  /** 单机 / 房主：packetOf(kit) 返回 cyberwarePacket；previewOf(kit,id) 返回 cyberwareInstallPreview（可省） */
  function localModel(o) {
    o = o || {};
    const heroes = o.heroes || [];
    const kit = heroes.some(h => h.kit === ui.kit) ? ui.kit : (heroes[0] || {}).kit || "";
    const packet = kit && o.packetOf ? o.packetOf(kit) : null;
    return { heroes, kit, packet, money: num(packet && typeof packet.purse === "number" ? packet.purse : o.money ? o.money(kit) : 0),
      net: false, preview: o.previewOf ? id => o.previewOf(kit, id) : null, error: o.error || "", note: o.note || "" };
  }
  /** 联机玩家：读 online-view 投影后的 view.cyberware（单个 packet 或 { [kit]: packet } 都接） */
  function viewModel(view, o) {
    o = o || {};
    const cw = view && view.cyberware;
    // Burnier 5edbb78：{ heroes:[{kit,name,view,shop}] }；也认单个 packet 或 { [kit]: packet }
    const packets = !cw ? [] : Array.isArray(cw.heroes) ? cw.heroes.filter(p => p && p.view) : cw.view ? [cw] : Object.keys(cw).map(k => cw[k]).filter(p => p && p.view);
    const heroes = packets.map(p => ({ kit: p.kit, name: p.name || (o.nameOf && o.nameOf(p.kit)) || p.kit, purse: typeof p.purse === "number" ? p.purse : null }));
    const kit = heroes.some(h => h.kit === ui.kit) ? ui.kit : (heroes[0] || {}).kit || "";
    const packet = packets.find(p => p.kit === kit) || null;
    // 88eae79：每人自己的钱包 purse + 房主算好的 previews[id]（白名单 + scrubHidden）
    return { heroes, kit, packet, money: num(packet && typeof packet.purse === "number" ? packet.purse : o.money ? o.money(kit) : 0),
      net: true, preview: packet && packet.previews ? id => packet.previews[id] || null : null, error: o.error || "", note: o.note || "" };
  }
  /** 确认步骤用的预览：只用房主 / 本机算好的 cyberwareInstallPreview（本机 query("cyberwarePreview")，联机 packet.previews[id]），不在界面里猜 */
  function previewFor(model, id) {
    const p = model.preview ? model.preview(id) : null;
    if (p) return p;
    const r = ((model.packet && model.packet.shop) || []).find(x => x.id === id);
    return { ok: false, error: r ? "预览还没收到，稍后再试" : "没有这件义体", name: r ? r.name : id, cost: r ? num(r.price) + num(r.replaceCost) : 0 };
  }

  /* ---------- 渲染（纯函数） ---------- */
  function rateBar(v) {
    const cap = Math.max(1, num(v.cap)), scale = Math.max(100, num(v.rate), cap);
    const w = x => `${Math.max(0, Math.min(100, num(x) / scale * 100))}%`;
    const over = num(v.rate) > cap + 1e-9;
    return `<section class="cw-rate${over ? " over" : ""}" aria-label="改造率">
      <div class="cw-rate-top"><b>改造率</b><span class="cw-rate-num"><b>${pc(v.rate)}</b> / ${pc(v.cap)}</span>
        <span class="cw-legend"><i class="cw-sw cw"></i>义体 ${pc(v.cyberwareRate)} <i class="cw-sw ly"></i>血量层改造 ${pc(v.layerRate)}</span></div>
      <div class="cw-track" role="img" aria-label="改造率 ${pc(v.rate)}，上限 ${pc(v.cap)}">
        <span class="cw-seg ly" style="width:${w(v.layerRate)}"></span><span class="cw-seg cw" style="width:${w(v.cyberwareRate)}"></span>
        <span class="cw-cap" style="left:${w(cap)}" title="上限 ${pc(cap)}"></span></div>
      <p class="cw-burden b-${esc(v.burden || "none")}">${esc(v.burdenText || "")}${over ? "" : ` · 还能换掉约 ${esc(num(v.remainingHp))} 点生命`}</p>
    </section>`;
  }
  // 效果那一段用房主按义体种类写好的 summary（cyberware.js · CYBERWARE_KINDS），界面不认得具体是哪一种；老包没有才自己拼
  const effect = r => r.summary ? [r.summary] : [RANGE[r.range] || r.range, ELEMENT[r.element] || r.element,
    r.damageText ? `伤害 ${r.damageText}` : "", r.break ? `${r.break} 击破` : ""];
  const meta = r => [`${num(r.tier)} 级`, r.kindName || KIND[r.kind] || r.kind].concat(effect(r), [r.hpCut ? `生命上限 −${r.hpCut}` : ""])
    .filter(Boolean).map(esc).join(" · ");
  const swapText = r => `以新换旧：会先拆掉「${r.replaceName || r.replaces}」（拆除费 ${num(r.replaceCost)} 奎支）`;
  // 等级门槛（#315）：不到 5 级时装 / 拆的按钮都灰掉、写「5 级解锁」；几级由房主 / 本机的 view.unlockLevel 给（cyberware.js · CYBERWARE_UNLOCK_LEVEL）
  function lockOf(v) {
    if (!v || !v.locked) return null;
    const lv = num(v.unlockLevel);
    return lv ? { tag: `${lv} 级解锁`, why: `${lv} 级解锁义体安装 / 拆除` } : { tag: "等级不够", why: "等级不够，不能安装 / 拆除" };
  }
  function installedHtml(model) {
    const list = model.packet.view.installed || [];
    const lock = lockOf(model.packet.view);
    return `<section class="ws-group cw-installed"><h3>已安装 <small>${list.length}</small></h3>
      <ul class="ws-list">${list.map(r => {
        const no = lock ? lock.why : model.money < num(r.removeCost) ? "奎支不够" : "";
        return `<li class="cw-row on"><div class="cw-txt"><b>${esc(r.name)}</b><small>${meta(r)} · 短休前还能用 ${esc(num(r.usesLeft))} 次</small></div>
        <button type="button" class="g-btn" ${cmdAttr({ action: "removeCyberware", kit: model.kit, id: r.id })} ${no ? `disabled title="${esc(no)}"` : ""}>拆除<small>${esc(num(r.removeCost))} 奎支${lock ? ` · ${esc(lock.tag)}` : ""}</small></button></li>`;
      }).join("")
        || `<li class="ws-empty">还没有安装义体。</li>`}</ul></section>`;
  }
  function shopHtml(model) {
    const shop = model.packet.shop || [];
    const rows = shop.filter(r => !r.installed);
    const conflictText = r => r.conflict ? `<small class="cw-conf">冲突标签「${esc(r.conflict)}」：同标签的义体不能同时安装</small>` : "";
    // 以新换旧：手里的钱要够新义体的价格 + 旧义体的拆除费
    const why = r => !r.canInstall ? (r.error || "现在不能安装") : model.money < num(r.price) + num(r.replaceCost) ? "奎支不够" : "";
    // 不到 5 级：目录照常能看，按钮灰掉、写「5 级解锁」；这一档要的等级还没到（房主给的 needLevel）：写「需要 10 级」之类。原因都是房主算好的 r.error
    const lock = lockOf(model.packet.view);
    const levelTag = r => num(r.needLevel) ? `需要 ${num(r.needLevel)} 级` : lock ? lock.tag : "";
    return `<section class="ws-group cw-shop"><h3>可安装 <small>${rows.length}</small></h3>
      ${shop.length ? `<p class="ws-note cw-rule">${esc(RULE)}</p>` : ""}
      ${lock && shop.length ? `<p class="ws-note cw-lock">${esc(lock.why)}：现在可以先看目录；已经装着的义体照常生效。</p>` : ""}
      <ul class="ws-list">${rows.map(r => {
        const pv = model.preview ? model.preview(r.id) : null;   // 有预览就按 overinstall / burden 判断，不比对文字
        const heavy = pv ? !!(pv.overinstall || pv.burden === "heavy") : num(r.rateAfter) > num(model.packet.view.cap) + 1e-9;
        const no = why(r) || (lock ? lock.why : "");
        return `<li class="cw-row${no ? " miss" : " ok"}${ui.confirm === r.id ? " sel" : ""}"><div class="cw-txt"><b>${esc(r.name)}</b>
          <small>${meta(r)}</small>${r.text ? `<span class="cw-desc">${esc(r.text)}</span>` : ""}
          <small>安装后改造率 <b class="cw-after${heavy ? " over" : ""}">${pc(r.rateAfter)}</b> / ${pc(model.packet.view.cap)}${r.warning && !no ? ` · <span class="${heavy ? "cw-heavy-tag" : ""}">${esc(r.warning)}</span>` : ""}</small>
          ${conflictText(r)}${r.replaces ? `<small class="cw-swap">${esc(swapText(r))}</small>` : ""}${no ? `<small class="ws-need">${esc(no)}</small>` : ""}</div>
          <span class="s-price">${esc(num(r.price))}</span>
          <button type="button" class="g-btn r-main" data-cw-pick="${esc(r.id)}" ${no ? "disabled" : ""} ${no ? `title="${esc(no)}"` : ""}>${r.replaces ? "以新换旧" : "安装"}${levelTag(r) ? `<small>${esc(levelTag(r))}</small>` : ""}</button></li>`;
      }).join("") || `<li class="ws-empty cw-none">${shop.length ? "目录里的义体都装上了。" : "暂无可安装的义体"}</li>`}</ul></section>`;
  }
  const conflictName = (model, id) => ((((model.packet || {}).view || {}).installed || []).find(x => x.id === id) || {}).name || id;
  function confirmHtml(model) {
    if (!ui.confirm) return "";
    const p = previewFor(model, ui.confirm);
    const heavy = p.overinstall || p.burden === "heavy";
    const blocked = !p.ok || model.money < num(p.cost);
    const swap = !!p.replaces;
    return `<div class="cw-confirm${heavy ? " heavy" : ""}" role="alertdialog" aria-label="${swap ? "确认以新换旧" : "确认安装"}">
      <h3>${swap ? "以新换旧" : "确认安装"}：${esc(p.name || ui.confirm)}</h3>
      ${heavy ? `<p class="cw-heavy" role="alert">⚠ ${esc(p.warning || HEAVY)}</p>` : p.warning ? `<p class="cw-strain">${esc(p.warning)}</p>` : ""}
      <ul class="cw-pv"><li>费用 <b>${esc(num(p.cost))}</b> 奎支${swap ? `（拆除费 ${esc(num(p.replaceCost))} + 新义体 ${esc(num(p.price))}）` : ""}（手里 ${esc(model.money)}）</li>
        ${swap ? `<li class="cw-swap">先拆掉「${esc(p.replaceName || p.replaces)}」，再装上「${esc(p.name || ui.confirm)}」：义体不能升级，只能以新换旧</li>` : ""}
        <li>改造率 <b>${pc(p.rateBefore)}</b> → <b class="${heavy ? "cw-after over" : "cw-after"}">${pc(p.rateAfter)}</b> / 上限 ${pc(p.cap)}${heavy ? "（超出上限：过度安装）" : ""}</li>
        ${p.conflictWith ? `<li class="ws-need">和已安装的「${esc(conflictName(model, p.conflictWith))}」冲突，不能同时安装</li>` : ""}</ul>
      ${!p.ok ? `<p class="ws-need big">${esc(p.error || "不能安装")}</p>` : model.money < num(p.cost) ? `<p class="ws-need big">奎支不够</p>` : ""}
      <div class="cw-actions"><button type="button" class="g-btn" data-cw-cancel>取消</button>
        <button type="button" class="g-btn r-main${heavy ? " cw-danger" : ""}" ${cmdAttr({ action: "installCyberware", kit: model.kit, id: ui.confirm })} ${blocked ? "disabled" : ""}>${heavy ? "仍然安装" : swap ? "确认以新换旧" : "确认安装"}</button></div>
    </div>`;
  }
  function html(model) {
    const heroTabs = (model.heroes || []).length > 1 ? `<div class="ws-heroes" role="tablist" aria-label="给谁装">${model.heroes.map(h => `<button type="button" class="g-btn ws-hero" data-cw-kit="${esc(h.kit)}" aria-pressed="${model.kit === h.kit}">${esc(h.name)}${h.purse != null ? `<small class="cw-purse">${esc(h.purse)} 奎支</small>` : ""}</button>`).join("")}</div>` : "";
    const body = model.packet && model.packet.view
      ? `${rateBar(model.packet.view)}${confirmHtml(model)}<div class="ws-main cw-main"><div class="ws-col">${installedHtml(model)}</div><div class="ws-col">${shopHtml(model)}</div></div>`
      : `<p class="ws-empty cw-none">暂无可安装的义体</p>`;
    return `<div class="ws-card ovl-card cw-card" role="dialog" aria-label="诊所 · 义体">
      <header class="ws-head"><span class="ws-tape">诊所 · 义体</span><span class="ws-sub">${model.heroes && model.heroes.length > 1 ? esc((model.heroes.find(h => h.kit === model.kit) || {}).name || "") + " " : ""}手里有 ${esc(model.money)} 奎支 · 拆除完全可逆</span>
        <button type="button" class="g-btn ws-close" data-cw-close aria-label="关闭">关闭</button></header>
      ${model.error ? `<p class="r-warn r-error">没做成：${esc(model.error)}</p>` : model.note ? `<p class="ws-note">${esc(model.note)}</p>` : ""}
      ${heroTabs}${body}</div>`;
  }

  /* ---------- 浮层 ---------- */
  let box = null, getModel = null, onCmd = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "cw-overlay"; box.className = "ws-overlay ovl cw-overlay"; box.hidden = true;
    box.addEventListener("click", e => {
      if (e.target === box || e.target.closest("[data-cw-close]")) return close();
      const t = e.target.closest("[data-cw-cmd],[data-cw-pick],[data-cw-kit],[data-cw-cancel]");
      if (!t || t.disabled) return;
      if (t.dataset.cwCmd) { const c = JSON.parse(t.dataset.cwCmd); ui.confirm = ""; if (onCmd) onCmd(c); refresh(); return; }
      if (t.dataset.cwPick) ui.confirm = t.dataset.cwPick;
      else if (t.dataset.cwKit) { ui.kit = t.dataset.cwKit; ui.confirm = ""; }
      else if (t.hasAttribute("data-cw-cancel")) ui.confirm = "";
      refresh();
    });
    document.body.appendChild(box);
    return box;
  }
  function open(model, cmd, opt) {
    opt = opt || {};
    getModel = model; onCmd = cmd;
    if (opt.kit) ui.kit = opt.kit;
    ui.confirm = "";
    ensureBox().hidden = false;
    refresh();
  }
  function close() { if (box) box.hidden = true; getModel = null; onCmd = null; ui.confirm = ""; }
  function isOpen() { return !!(box && !box.hidden); }
  function refresh() {
    if (!isOpen() || !getModel) return;
    const m = getModel();
    if (!m) return close();
    const card = box.querySelector(".cw-card"), scroll = card ? card.scrollTop : 0;
    box.innerHTML = html(m);
    const c2 = box.querySelector(".cw-card"); if (c2) c2.scrollTop = scroll;
  }
  function button(kit, id) {
    return `<button type="button" class="g-btn cw-open" ${id ? `id="${esc(id)}"` : ""} data-cw-open="${esc(kit || "")}">义体</button>`;
  }
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
    let last = document.body.dataset.screen;
    new MutationObserver(() => { const now = document.body.dataset.screen; if (now !== last) { last = now; close(); } })
      .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  }

  root.CyberwareUI = { html, open, close, refresh, isOpen, button, localModel, viewModel, previewFor, state: ui, reset: resetUi, HEAVY };
})(typeof window !== "undefined" ? window : globalThis);
