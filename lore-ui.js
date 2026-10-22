/* Antlerscale: Backfire · 联机跑团「NPC 资料」界面（角色资料，规则在 lore.js，issue #264）
 *   主持人：探索 / 战斗顶栏的「NPC 资料」→ 浮层：新建、编辑（字段照 lore.js · LORE_TYPES）、发布 / 撤回为草稿、排序、删除。
 *           草稿只有主持人看得到；写入一律走 api.submit({ type: "lore", … })（房主执行、写进跑团存档、发包）。
 *           编辑表单只在打开时画一次，收到新包不重画（不打断打字）；关掉浮层再打开，没保存的内容还在。
 *   玩家：舞台标题工具栏「NPC 资料」（online-ui.js）→ 只读浮层：列表是 packet.lore（已发布条目的索引，online-view.js · projectLore），
 *         点开一条才向房主要详细内容（api.loreEntry → packet.entry），按 rev 缓存：主持人改过（rev 变大）再要一次。主持人新发布的弹一句提示。
 *   浮层带 .ol-ui（联机玩家页只放行 .ol-ui 等）；样式沿用任务日志（.ol-quest-card / .ol-q-*）和申请检定（.crq-*），按钮 44px。
 *   const ui = LoreUI.mount({ api, view: () => view, confirm(title, text, ok), toast(text) }); ui.sync(); ui.open(); ui.close(); ui.destroy() */
(function (root) {
  "use strict";
  const ENTRY = "NPC 资料";   // 入口按钮和浮层标题（工具栏上的「角色资料」是自己角色的卡，所以这里不叫这个）
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const types = () => (typeof LORE_TYPES !== "undefined" && LORE_TYPES) || {};
  const untitled = () => (typeof LORE_LIMITS !== "undefined" && LORE_LIMITS.untitled) || "（未命名）";
  const specOf = (e, T) => (e && T && Object.hasOwn(T, e.type) ? T[e.type] : null);
  const btn = (label, action, extra = "", off = false, primary = false) => `<button type="button" class="g-btn ol-button${primary ? " ol-primary" : ""}" data-lore="${action}"${extra ? " " + extra : ""}${off ? " disabled" : ""}>${esc(label)}</button>`;

  /** 列表上的标题（NPC 是姓名） */
  function titleOf(e, T) {
    const spec = specOf(e, T);
    return ((e && e.fields) || {})[spec ? spec.titleKey : "name"] || untitled();
  }
  /** 标题以外、有内容的字段：[[名字, 值]]，按表里的顺序 */
  function restOf(e, T) {
    const spec = specOf(e, T), f = (e && e.fields) || {};
    if (!spec) return [];
    return spec.fields.filter(x => x.key !== spec.titleKey && f[x.key]).map(x => [x.label, f[x.key]]);
  }
  const chips = (e, T, labels) => restOf(e, T).map(([label, value]) => `<span class="crq-chip">${labels ? esc(label) + " · " : ""}${esc(value)}</span>`).join("");
  const headHtml = title => `<header><h2>${esc(title)}</h2>${btn("关闭", "close")}</header>`;

  /** 玩家浮层：m = { types, list（packet.lore）, openId（正在看哪条）, entry（这条的详细内容，可能是旧版本）, error } */
  function playerHtml(m) {
    const T = m.types || {}, list = m.list || [];
    if (m.openId) {
      const row = list.find(e => e.id === m.openId);
      const back = `<div class="ol-attr-btns">${btn("← 返回列表", "back")}</div>`;
      if (!row) return `<div class="ol-card ol-quest-card ol-lore-card">${headHtml(ENTRY)}${back}<p class="ol-muted">这条资料现在看不到了（主持人撤回或删除了）。</p></div>`;
      const e = m.entry && m.entry.id === row.id ? m.entry : null, spec = specOf(row, T);
      const body = e && e.body ? `<p class="ol-lore-body">${esc(e.body)}</p>`
        : e || !row.more ? '<p class="ol-muted">（没有详细内容）</p>'
        : m.error ? `<p class="ol-notice" role="status">${esc(m.error)}</p><div class="ol-attr-btns">${btn("重试", "retry")}</div>`
        : '<p class="ol-muted">正在向主持人要详细内容…</p>';
      const stale = !e || e.rev >= row.rev ? "" : m.error ? `<p class="ol-muted">${esc(m.error)} · 下面是之前取到的内容</p><div class="ol-attr-btns">${btn("重试", "retry")}</div>`
        : '<p class="ol-muted">主持人改过这条，正在取新的…</p>';
      return `<div class="ol-card ol-quest-card ol-lore-card">${headHtml(ENTRY)}${back}<article class="ol-q-card" data-lore-id="${esc(row.id)}"><header><b>${esc(titleOf(row, T))}</b><span class="ol-q-tag">${esc(spec ? spec.name : "")}</span></header>${chips(row, T, true) ? `<div class="ol-q-rewards">${chips(row, T, true)}</div>` : ""}${stale}${body}</article></div>`;
    }
    const cards = list.map(e => `<article class="ol-q-card" data-lore-id="${esc(e.id)}"><header><b>${esc(titleOf(e, T))}</b>${chips(e, T, false)}</header><div class="ol-attr-btns">${btn(e.more ? "查看详细" : "查看", "view", `data-id="${esc(e.id)}"`)}</div></article>`).join("");
    return `<div class="ol-card ol-quest-card ol-lore-card">${headHtml(ENTRY)}${cards || `<p class="ol-muted">主持人还没有发布 ${esc(ENTRY)}。</p>`}<p class="ol-muted">主持人发布的人物资料，只能查看；主持人改了，这里跟着更新。</p></div>`;
  }
  /** 主持人列表：m = { types, list（全部，含草稿）, busy, error }。顺序就是玩家看到的顺序（玩家只看得到已发布的） */
  function gmHtml(m) {
    const T = m.types || {}, list = m.list || [], off = !!m.busy;
    const make = Object.keys(T).map(k => btn(`＋ 新建 ${T[k].name}`, "new", `data-type="${esc(k)}"`, off, true)).join("");
    const cards = list.map((e, i) => {
      const pub = e.status === "published", spec = specOf(e, T);
      const text = String(e.body || "").replace(/\s+/g, " ").trim();
      const tools = [btn("编辑", "edit", "", off || !spec), pub ? btn("撤回为草稿", "unpublish", "", off) : btn("发布", "publish", "", off || !spec, true),
        btn("↑", "up", 'title="往前挪"', off || i === 0), btn("↓", "down", 'title="往后挪"', off || i === list.length - 1), btn("删除", "delete", "", off)].join("");
      return `<article class="ol-q-card${pub ? " ol-q-active" : ""}" data-lore-id="${esc(e.id)}"><header><b>${esc(titleOf(e, T))}</b>${chips(e, T, false)}<span class="ol-q-st">${pub ? "已发布" : "草稿"}</span></header>${spec ? "" : '<p class="ol-muted">这个版本认不得这种资料，只能删除。</p>'}${text ? `<p class="ol-q-goal ol-muted">${esc(text.length > 80 ? text.slice(0, 80) + "…" : text)}</p>` : ""}<div class="ol-attr-btns">${tools}</div></article>`;
    }).join("");
    return `<div class="ol-card ol-quest-card ol-lore-card">${headHtml(ENTRY + " · 主持人")}<p class="ol-muted">新建的是草稿，只有你看得到；「发布」后联机玩家在「${esc(ENTRY)}」里能看（只读）。已发布的照样能改，保存后玩家看到的跟着更新；「撤回为草稿」玩家就看不到了。玩家看到的顺序和这里一样。</p>${m.error ? `<p class="ol-notice" role="status">${esc(m.error)}</p>` : ""}<div class="ol-attr-btns">${make}</div>${cards || '<p class="ol-muted">还没有资料。</p>'}</div>`;
  }
  /** 主持人编辑表单（字段、长度上限照 LORE_TYPES） */
  function editorHtml(e, T) {
    const spec = specOf(e, T); if (!spec) return "";
    const f = e.fields || {}, body = e.body || "", pub = e.status === "published";
    const inputs = spec.fields.map(x => `<label>${esc(x.label)}<input data-lore-field="${esc(x.key)}" maxlength="${Number(x.max) || 60}" value="${esc(f[x.key] || "")}" autocomplete="off"></label>`).join("");
    return `<div class="ol-card ol-quest-card ol-lore-card">${headHtml(`编辑 ${spec.name} 资料`)}<p class="ol-muted">${pub ? "这条已发布：保存后玩家看到的跟着更新。" : "这条是草稿：只有你看得到，「保存并发布」后玩家才看得到。"}</p>
      <form class="crq-form" data-lore-form="${esc(e.id)}">${inputs}<label>${esc(spec.body.label)}<textarea data-lore-body rows="10" maxlength="${Number(spec.body.max) || 2000}">${esc(body)}</textarea></label>
      <small class="ol-muted ol-lore-count" data-lore-count>${body.length} / ${Number(spec.body.max) || 2000}</small><p class="ol-notice" role="status" data-lore-error></p>
      <div class="ol-attr-btns">${btn("保存", "save", "", false, true)}${pub ? "" : btn("保存并发布", "savePublish")}${btn("取消", "cancel")}</div></form></div>`;
  }

  function mount(o) {
    const doc = root.document;
    const box = doc.createElement("section"); box.id = "online-lore"; box.className = "ol-ui ol-overlay ol-bag"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", ENTRY); box.hidden = true;
    doc.body.appendChild(box);
    let open = false, last = "", busy = false, error = "", roomKey = "";
    let editId = null, editing = null;                 // 主持人：正在编辑哪条；editing = 表单画的是哪条（画过就不重画）
    let openId = null, seen = null, loading = null, failed = null, loadError = "";
    const cache = new Map();                           // 玩家：id → 取到的详细内容（带 rev）
    const v = () => o.view() || {};
    const host = () => !!v().isHost;
    const index = () => (Array.isArray(v().packet && v().packet.lore) ? v().packet.lore : []);
    const all = () => (typeof o.api.loreAll === "function" && o.api.loreAll()) || [];
    function enabled() {
      const view = v();
      if (!view.active) return false;
      if (view.isHost) return view.mode !== "rogue";
      return !!view.packet && view.packet.mode !== "rogue" && ["exploration", "battle", "ended"].includes(view.screen);
    }
    /** 主持人：探索顶栏（图鉴旁边）和战斗顶栏（地图旁边）各一个入口；不是联机跑团的主持人就拿掉 */
    function hostButtons(on) {
      for (const [anchor, id] of [["#tr-bestiary", "tr-lore"], ["#g-map", "g-lore"]]) {
        const at = doc.querySelector(anchor);   // 用 querySelector：game.html 给 getElementById 垫了一层，找不到的 id 会凭空造一个 div
        let b = doc.querySelector("#" + id);
        if (!on || !at) { if (b) b.remove(); continue; }
        if (!b) {
          b = doc.createElement("button"); b.type = "button"; b.id = id; b.className = "g-btn"; b.textContent = ENTRY;
          b.title = "NPC 资料：新建、编辑，发布后联机玩家才看得到（只读）";
          b.addEventListener("click", () => openBox());
          at.after(b);
        }
      }
    }
    /** 玩家：主持人新发布的条目弹一句（第一次收到索引、换房间都不弹：那时已有的不算新的） */
    function observe() {
      if (!Array.isArray(v().packet && v().packet.lore)) return;
      const list = index(), ids = new Set(list.map(e => e.id));
      if (seen && typeof o.toast === "function") {
        const fresh = list.filter(e => !seen.has(e.id));
        if (fresh.length) o.toast(`👤 新的 ${ENTRY}：${fresh.slice(0, 3).map(e => "「" + titleOf(e, types()) + "」").join("、")}${fresh.length > 3 ? ` 等 ${fresh.length} 条` : ""}（点顶上的「${ENTRY}」查看）`);
      }
      seen = ids;
    }
    /** 玩家：正在看的那条，缓存里没有或者比索引旧（主持人改过）就向房主要一次；要不到就停下等「重试」，不反复要 */
    function ensureDetail() {
      const row = openId && index().find(e => e.id === openId);
      if (!row || !row.more) return;
      const c = cache.get(row.id), key = row.id + ":" + row.rev;
      if (c && c.rev >= row.rev || loading === key || failed === key) return;
      loading = key; loadError = "";
      Promise.resolve().then(() => o.api.loreEntry(row.id)).then(p => {
        const entry = p && p.entry;
        if (p && p.ok === false) throw new Error(p.error || "没取到这条资料");
        if (!entry || entry.id !== row.id) throw new Error("这条资料现在看不到了");
        cache.set(entry.id, entry);
      }).catch(err => { failed = key; loadError = (err && err.message) || "没取到这条资料"; })
        .finally(() => { if (loading === key) loading = null; last = ""; if (open) paint(); });
    }
    /** 换内容：键盘焦点原来在浮层里的，换完放回同一个按钮（没了就放到「返回列表」/「关闭」），Esc、Tab 接着能用 */
    function setHtml(html) {
      if (html === last) return;
      const active = doc.activeElement, inside = !!active && active !== box && box.contains(active);
      const key = inside && active.dataset ? [active.dataset.lore || "", active.dataset.id || ""] : null;
      last = html; box.innerHTML = html;
      if (!inside) return;
      const same = key && [...box.querySelectorAll("[data-lore]")].find(b => b.dataset.lore === key[0] && (b.dataset.id || "") === key[1] && !b.disabled);
      const next = same || box.querySelector('[data-lore="back"]') || box.querySelector('[data-lore="close"]');
      if (next) next.focus({ preventScroll: true });
    }
    function paint() {
      if (!open) return;
      if (host()) {
        const e = editId && all().find(x => x.id === editId);
        if (e && specOf(e, types())) {
          if (editing !== editId) { editing = editId; last = ""; box.innerHTML = editorHtml(e, types()); }
          return;
        }
        editId = editing = null;
        setHtml(gmHtml({ types: types(), list: all(), busy, error }));
        return;
      }
      setHtml(playerHtml({ types: types(), list: index(), openId, entry: openId ? cache.get(openId) || null : null, error: loadError }));
      ensureDetail();
    }
    function sync() {
      const key = v().active ? `${v().roomCode || ""}:${(v().identity && v().identity.id) || ""}` : "";
      if (key !== roomKey) { roomKey = key; seen = null; cache.clear(); openId = editId = editing = null; loading = failed = null; loadError = error = ""; last = ""; }
      const on = enabled();
      hostButtons(on && host());
      if (!on) { open = false; box.hidden = true; return; }
      if (!host()) observe();
      box.hidden = !open;
      paint();
    }
    function openBox() {
      if (!enabled()) return;
      open = true; last = ""; if (!host()) { openId = null; failed = null; loadError = ""; }
      sync();
      const first = box.querySelector("[data-lore-field], [data-lore=\"close\"]");
      if (first) first.focus({ preventScroll: true });
    }
    function close() { open = false; box.hidden = true; if (!host()) openId = null; }
    function readForm() {
      const fields = {};
      box.querySelectorAll("[data-lore-field]").forEach(el => { fields[el.dataset.loreField] = el.value; });
      const body = box.querySelector("[data-lore-body]");
      return { id: editId, fields, body: body ? body.value : "" };
    }
    /** 表单和存着的那份不一样（取消前问一句） */
    function dirty() {
      const e = all().find(x => x.id === editId); if (!e) return false;
      const f = readForm();
      return Object.keys(f.fields).some(k => f.fields[k].trim() !== ((e.fields || {})[k] || "")) || f.body.replace(/\s+$/, "") !== (e.body || "");
    }
    /** 主持人的写入：同时只跑一条；失败的原因写在表单 / 列表上 */
    async function gm(cmd) {
      if (busy) return null;
      busy = true; error = "";
      box.querySelectorAll("form [data-lore]").forEach(b => { b.disabled = true; });
      if (!editing) { last = ""; paint(); }
      let r;
      try { r = await o.api.submit(cmd); } catch (err) { r = { ok: false, error: (err && err.message) || String(err) }; }
      busy = false;
      box.querySelectorAll("form [data-lore]").forEach(b => { b.disabled = false; });
      if (r && r.ok === false) {
        error = r.error || "操作未生效";
        const slot = box.querySelector("[data-lore-error]"); if (slot) slot.textContent = error;
      }
      last = ""; paint();
      return r && r.ok !== false ? r : null;
    }
    const startEdit = id => {
      editId = id; editing = null; last = ""; paint();
      const first = box.querySelector("[data-lore-field]"); if (first) first.focus({ preventScroll: true });
    };
    async function onClick(ev) {
      const b = ev.target.closest && ev.target.closest("[data-lore]");
      if (!b) { if (ev.target === box) close(); return; }
      if (b.disabled) return;
      const a = b.dataset.lore, card = b.closest("[data-lore-id]"), id = card ? card.dataset.loreId : editId;
      switch (a) {
        case "close": close(); return;
        case "view": openId = b.dataset.id; failed = null; loadError = ""; last = ""; paint(); return;
        case "back": openId = null; last = ""; paint(); return;
        case "retry": failed = null; loadError = ""; last = ""; paint(); return;
        case "new": { const r = await gm({ type: "lore", action: "create", entryType: b.dataset.type || "npc" }); if (r && typeof r.id === "string") startEdit(r.id); return; }
        case "edit": startEdit(id); return;
        case "publish": case "unpublish": await gm({ type: "lore", action: "status", id, status: a === "publish" ? "published" : "draft" }); return;
        case "up": case "down": await gm({ type: "lore", action: "move", id, dir: a === "up" ? -1 : 1 }); return;
        case "delete": {
          const e = all().find(x => x.id === id); if (!e) return;
          if (typeof o.confirm === "function" && !(await o.confirm("删除资料", `删除「${titleOf(e, types())}」？删掉就找不回来了${e.status === "published" ? "，玩家那边也会消失" : ""}。`, "删除"))) return;
          await gm({ type: "lore", action: "delete", id }); return;
        }
        case "save": case "savePublish": {
          const cmd = { type: "lore", action: "save", entry: readForm() };
          if (a === "savePublish") cmd.status = "published";
          if (await gm(cmd)) { editId = editing = null; last = ""; paint(); }
          return;
        }
        case "cancel":
          if (dirty() && typeof o.confirm === "function" && !(await o.confirm("放弃修改", "没保存的修改会丢掉，确定吗？", "放弃修改"))) return;
          editId = editing = null; last = ""; paint(); return;
      }
    }
    const onInput = ev => {
      if (!ev.target.matches || !ev.target.matches("[data-lore-body]")) return;
      const c = box.querySelector("[data-lore-count]"); if (c) c.textContent = `${ev.target.value.length} / ${ev.target.maxLength}`;
    };
    // 战斗画面有快捷键（空格结束回合、数字选技能）：浮层里打字不能传出去
    const onKey = ev => { ev.stopPropagation(); if (ev.key === "Escape") close(); };
    box.addEventListener("click", onClick); box.addEventListener("input", onInput); box.addEventListener("keydown", onKey);
    box.addEventListener("submit", ev => ev.preventDefault());   // 表单里按回车不提交、不刷新页面（保存只认按钮）
    return { sync, open: openBox, close, el: box,
      destroy() { box.remove(); hostButtons(false); } };
  }

  const api = { ENTRY, mount, playerHtml, gmHtml, editorHtml, titleOf };
  root.LoreUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
