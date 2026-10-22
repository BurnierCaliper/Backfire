/* Antlerscale: Backfire · 新画面（HD-2D）的界面外壳：技能栏、队伍栏（#297）
 *
 * 原型页（prototypes/hd2d/index.html）里主人试玩定下来的技能栏 / 队伍栏，正式画面（单机 game.html、联机玩家的战斗画面）开了新画面以后也用这一份：
 *   · 技能栏能收起 / 展开（「技能 ▼ / ▲」）；技能按钮照旧技能栏的样子，加上左上角的属性、右上角的攻击 / 技能角标（hd2d-ui.js · skillInner）
 *   · 唤出 / 收回武器人是单独的大按钮，和「结束回合」放在一起
 *   · 队伍栏能收起（「队伍 ◀ / ▶」）：每个人前面是主职责图标头像（主属性 → 副属性的渐变），名字右边是身上的效果（hd2d-ui.js · partyInner）
 * 收起 / 展开记在这台电脑上（localStorage，读写都包 try/catch）；没记过时手机上默认收起（同原型页）。
 * 只换样子不换操作：正式画面的按钮还是 game.js / online-battle.js 自己建、自己接点击 / 悬停 / 快捷键（出手流程只有原来那一份），
 * 开着新画面时它们画按钮里面的东西改用这里给的；队伍栏的单位只用投影过的（online-view.js 的白名单），坚毅生命压根不读。
 *
 *   纯函数（Node 里能 require，tests/hd2d-shell.test.js）：
 *     SHELL                                     配置：本机记住收起 / 展开的键、按钮上的字、手机多宽、面板上的字
 *     isOpen(name, storage, dflt) / setOpen(name, open, storage) / labelOf(name, open)
 *     looks(cards, eleByCn) / lookOf(u)         头像要的公开资料（hd2d-ui.js · heroLooks，按 kit 查；武器人没有自己的就用主人的）
 *     effectElements(list)                      图鉴里带属性的效果（技能按钮的属性角标要）
 *     skillButton(row, i, unit, o)              正式画面的一个技能按钮换成新样子：{ cls, html, label }
 *     summonButton(row, unit, o)                唤出 / 收回武器人的大按钮：{ back, color, html, label }
 *     pickSummon(rows)                          技能里挑出唤出 / 收回武器人的那一个（照 game.js 的挑法）：{ summon, rest }
 *     hintsOf(unit)                             联机：本机的技能表里这个人每个技能的提示（读属性 / 攻击还是技能）
 *     member(u, o)                              队伍栏一个人里面的东西（头像按 lookOf）
 *     whoHtml(u, acting)                        技能栏上面那一行：谁在行动
 *   页面：
 *     wirePanel(panel, btn, o)                  一块面板的收起 / 展开（原型页的技能栏 / 队伍栏 / 日志、正式画面的技能栏 / 队伍栏）
 *     attach(hud, o) / detach(hud) / on(hud)    正式画面底下的 .g-hud 换上 / 拆掉新外壳（hd2d-field.js 建好 / 拆掉新画面时调）
 *     who(hud, html)                            写技能栏上面那一行 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./hd2d-ui.js"));
  else root.HD2DShell = factory(root, null);
})(typeof self !== "undefined" ? self : this, function (root, UI0) {
  "use strict";

  /** 界面数据（hd2d-ui.js）：Node 里直接 require；页面里先加载好挂在 HD2DUI 上 */
  const UIX = () => UI0 || root.HD2DUI;

  /* ---------- 配置 ----------
   *   keys      本机记住收起 / 展开的键（存 "open" / "closed"）：技能栏 dock、队伍栏 party；原型页和正式画面同一个键（同一台电脑一个习惯）
   *   labels    收起 / 展开按钮上的字（照原型页：技能栏往下收、队伍栏往左收）
   *   phone     这么窄算手机：没记过时技能栏、队伍栏默认收起（同原型页）
   *   text      面板上的字：队伍栏的胶带标签、技能栏上面那一行「行动中」、两个按钮读屏念的
   *   summonKey 唤出 / 收回武器人的快捷键（单机 game.js 本来就是 Q；联机的新外壳也用它） */
  const SHELL = {
    keys: { dock: "backfire-hd2d-dock", party: "backfire-hd2d-party" },
    labels: { dock: { open: "技能 ▼", closed: "技能 ▲" }, party: { open: "队伍 ◀", closed: "队伍 ▶" } },
    phone: "(max-width: 720px)",
    text: { party: "我方队伍", acting: "行动中", dock: "收起 / 展开技能栏", partyBtn: "收起 / 展开队伍栏" },
    summonKey: "Q"
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- 收起 / 展开（读写 localStorage 都包 try/catch）---------- */
  /** 本机记着的：name = "dock" / "party"；没记过、记了认不得的、读不了（隐私模式、被禁用）都按 dflt */
  function isOpen(name, storage, dflt) {
    try {
      const k = SHELL.keys[name];
      const v = storage && k ? storage.getItem(k) : null;
      if (v === "open") return true;
      if (v === "closed") return false;
    } catch (e) { /* 读不了就按默认 */ }
    return !!dflt;
  }
  /** 记住；存不了（隐私模式、存满了）不报错，返回 false */
  function setOpen(name, open, storage) {
    try {
      const k = SHELL.keys[name];
      if (!storage || !k) return false;
      storage.setItem(k, open ? "open" : "closed");
      return true;
    } catch (e) { return false; }
  }
  const labelOf = (name, open) => ((SHELL.labels[name] || {})[open ? "open" : "closed"]) || "";
  /** 这台电脑现在算不算手机（没有 matchMedia 就不算） */
  function phoneNow() {
    try { return !!(root.matchMedia && root.matchMedia(SHELL.phone).matches); } catch (e) { return false; }
  }
  function storageOf() { try { return root.localStorage || null; } catch (e) { return null; } }

  /**
   * 一块面板的收起 / 展开：点 btn 换；收起时 o.target（默认 panel）加 o.cls（默认 collapsed），按钮写 o.labels / SHELL.labels[name] 的字、aria-expanded 跟着。
   * o = { name 记在本机的哪一项（没有 = 不记，原型页的日志）, open 没记过时开不开, storage, labels { open, closed }, target, cls, onChange(open) }。
   * 返回 set(open)：页面自己要换时调（不记）
   */
  function wirePanel(panel, btn, o) {
    o = o || {};
    const target = o.target || panel, cls = o.cls || "collapsed";
    const labels = o.labels || SHELL.labels[o.name] || null;
    const storage = o.storage !== undefined ? o.storage : storageOf();
    const set = (open, save) => {
      target.classList.toggle(cls, !open);
      btn.setAttribute("aria-expanded", String(!!open));
      if (labels) btn.textContent = open ? labels.open : labels.closed;
      if (save && o.name) setOpen(o.name, open, storage);
      if (o.onChange) o.onChange(!!open);
    };
    btn.addEventListener("click", () => set(target.classList.contains(cls), true));
    set(o.name ? isOpen(o.name, storage, o.open) : !!o.open, false);
    return (open) => set(open, false);
  }

  /* ---------- 头像、属性（公开资料）---------- */
  let looksMemo = null, effectsMemo = null;
  /** 角色卡（party.js · livePartyCards，静态的公开资料）→ 每个 kit 的主职责、主 / 副属性（hd2d-ui.js · heroLooks：角色卡上别的字段一个都不拿）。
   *  不给参数 = 用页面里的角色卡和 app.js 的 ELE_BY_CN（算一次记下来） */
  function looks(cards, eleByCn) {
    if (cards) return UIX().heroLooks(cards, eleByCn || null);
    if (looksMemo) return looksMemo;
    let list = [];
    try { list = typeof root.livePartyCards === "function" ? root.livePartyCards() : []; } catch (e) { list = []; }
    // ELE_BY_CN 是 app.js 顶层的 const：不在 window 上，按名字取
    let map = null;
    try { map = typeof ELE_BY_CN !== "undefined" ? ELE_BY_CN : (root.ELE_BY_CN || null); } catch (e) { map = null; }
    looksMemo = UIX().heroLooks(list, map);
    return looksMemo;
  }
  /** 一个人的头像资料：自己的角色卡；武器人（没有自己的职责）用主人的 */
  function lookOf(u, table) {
    const L = table || looks();
    if (!u) return null;
    return L[u.kit] || (u.weaponOf ? L[u.weaponOf] : null) || null;
  }
  /** 图鉴里带属性的效果（codex.js · CODEX_EFFECTS：感电 = 电、熔融 = 火、雪天 = 冰……）：[[名字, 属性]]，技能按钮的属性角标看挂的是什么 */
  function effectElements(list) {
    if (list) return list.filter(e => e && e.element).map(e => [e.name, e.element]);
    if (effectsMemo) return effectsMemo;
    let src = null;
    try { src = typeof CODEX_EFFECTS !== "undefined" ? CODEX_EFFECTS : (root.CODEX_EFFECTS || null); } catch (e) { src = null; }
    effectsMemo = Array.isArray(src) ? effectElements(src) : [];
    return effectsMemo;
  }

  /* ---------- 技能栏（正式画面的按钮换成新样子）---------- */
  /**
   * 一个普通技能按钮：row = { id, name, hint, cost: { ap, bonus } }（单机：game.js 的技能；联机：主机给的选项，提示用 hintsOf 查本机的技能表），
   * i = 第几个（轮流换颜色），unit = 投影过的行动的人（绯秋的刀、夕夏的引擎跟着变属性），
   * o = { key 快捷键, cost 消耗那一行换成这段文字（联机：房主算好的消耗 / 用不了的原因）, icons, effects }。
   * 返回 { b 按钮数据, cls 加在按钮上的类, html 按钮里面, label 读屏念的 }；按钮本身、点击、悬停、灰掉照旧是页面自己的
   */
  function skillButton(row, i, unit, o) {
    o = o || {};
    const U = UIX();
    const b = U.skillButton(row, unit, o.effects || effectElements(), i);
    const icons = o.icons !== undefined ? o.icons : root.Icons;
    const cost = o.cost != null ? String(o.cost) : U.costText(b.cost);
    return {
      b, cls: `hd-sk t-${b.tint} k-${b.kind}`,
      html: U.skillInner(b, icons, { key: o.key, cost: o.cost, titles: false }),
      label: `${b.name}：${b.elementName}${b.kindName}，${cost}`
    };
  }
  /**
   * 唤出 / 收回武器人的大按钮（联机的新外壳用；单机 game.js 的 #g-summon 本来就是）：row 同上，unit = 投影过的行动的人。
   * 颜色 = 这个人（武器人跟着主人）的主属性色；返回 { b, back 是不是收回 / 取回, color, html, label }
   */
  function summonButton(row, unit, o) {
    o = o || {};
    const U = UIX();
    const b = U.skillButton(row, unit, o.effects || effectElements(), 0);
    const id = String(row && row.id || "");
    b.back = /_return$/.test(id) || id === U.UI.skill.first;
    const look = unit ? ((o.looks || looks())[unit.weaponOf || unit.kit] || null) : null;
    const color = look && U.UI.elements[look.main] ? U.UI.elements[look.main] : null;
    const cost = o.cost != null ? String(o.cost) : U.costText(b.cost);
    return { b, back: b.back, color, html: U.summonInner(b, { cost, key: o.key }), label: `${b.name}，${cost}` };
  }
  /**
   * 技能里挑出唤出 / 收回武器人的那一个（单独做成大按钮），照单机 game.js · refreshHud 的挑法：武器人倒下后先放「取回武器」，
   * 这时倒下那把的唤出（本场不能再唤出、灰掉的）不再占技能栏。rows = [{ id, disabled }]（联机：主机给的选项换成这个样子）。
   * 返回 { summon: 那一个或 null, rest: 剩下的普通技能（顺序不变）}
   */
  function pickSummon(rows) {
    const U = UIX(), first = U.UI.skill.first;
    const list = (rows || []).filter(r => r && r.id != null);
    const bio = (id) => String(id) !== first && U.isSummon(id);   // 唤出武器人 / 收回为武器（game.js · isSummonSkill）
    const retrieve = list.find(r => String(r.id) === first) || null;
    const summon = retrieve || list.find(r => bio(r.id)) || null;
    return { summon, rest: list.filter(r => r !== summon && !(retrieve && bio(r.id) && r.disabled)) };
  }
  /**
   * 联机：主机给的技能选项只有名字、消耗（online-view.js · projectActionMenu），属性 / 攻击还是技能要看技能的提示——
   * 按本机的技能表（party.js · skillList：静态的规则文字，图鉴里也写着）拿投影过的这个人（复制一份，不改收到的包）查一遍：{ 技能 id: 提示 }。
   * 读不到就是空的（按钮照样画，属性写无属性）。不碰房主的 state
   */
  function hintsOf(unit) {
    const out = {};
    if (!unit || typeof root.skillList !== "function") return out;
    try {
      const copy = JSON.parse(JSON.stringify(unit));
      (root.skillList(copy) || []).forEach(s => { if (s && s.id && s.hint) out[s.id] = String(s.hint); });
    } catch (e) { /* 规则表认不得这个人：没有提示 */ }
    return out;
  }
  /* ---------- 队伍栏（正式画面的队伍按钮换成新样子）---------- */
  /** 队伍栏一个人里面的东西（hd2d-ui.js · partyInner）：u = 投影过的单位，头像按 lookOf(u)；o = { tag 名字后面的小字, icons（默认 hud-icons.js）, looks }。
   *  正式画面一个人是一个按钮，效果的小标记不让键盘停上去（focus: false），悬停照样展开 */
  function member(u, o) {
    o = o || {};
    return UIX().partyInner(u, lookOf(u, o.looks), { icons: o.icons !== undefined ? o.icons : root.HudIcons, tag: o.tag || "", focus: false });
  }
  /** 技能栏上面那一行：谁在行动（名字、等级、行动中）。u = 投影过的单位；没有人就空着 */
  function whoHtml(u, acting) {
    if (!u) return "";
    const level = Math.max(1, Math.round(Number(u.level) || 1));
    return `${esc(u.name || u.id || "")}<small>Lv${level}${acting ? " · " + esc(SHELL.text.acting) : ""}</small>`;
  }

  /* ---------- 正式画面：.g-hud 换上 / 拆掉新外壳 ---------- */
  const STATE = "__hd2dShell";
  function toggleBtn(d, cls, aria) {
    const b = d.createElement("button");
    b.type = "button";
    b.className = "hd2d-toggle " + cls;
    b.setAttribute("aria-label", aria);
    return b;
  }
  /**
   * 正式画面底下的 .g-hud（单机 #g-app 里那一个、联机 .ol-battle 里那一个）换上新外壳（hd2d-field.js 建好新画面时调）：
   *   · .g-hud 加 hd2d-shell / hd2d-theme（样式在 hd2d.css，配色同原型页）
   *   · 最上面加一行：「技能 ▼ / ▲」收起 / 展开（收起 = .g-hud 加 dock-closed，技能那一排藏起来，提示栏照旧）、谁在行动
   *   · 旧的队伍栏（.party：game.js / online-battle.js 照旧往里画、照旧接点击，Tab 照旧按它切人）原样挪进一块浮在战场左下角的面板，
   *     面板上「队伍 ◀ / ▶」收起
   * o = { storage（默认本机的 localStorage）, phone（窄屏：没记过时默认收起；默认按 SHELL.phone 量）}。已经换上了 / 没有 .g-hud：返回 false
   */
  function attach(hud, o) {
    if (!hud || hud[STATE] || !hud.ownerDocument) return false;
    o = o || {};
    const d = hud.ownerDocument, storage = o.storage !== undefined ? o.storage : storageOf();
    const phone = o.phone !== undefined ? !!o.phone : phoneNow();
    const st = { row: null, who: null, panel: null, party: null, home: null };
    hud.classList.add("hd2d-shell", "hd2d-theme");
    // 技能栏上面那一行
    const row = d.createElement("div");
    row.className = "hd2d-dock-row";
    const dockBtn = toggleBtn(d, "hd2d-dock-toggle", SHELL.text.dock);
    const who = d.createElement("span");
    who.className = "hd2d-who";
    row.appendChild(dockBtn);
    row.appendChild(who);
    hud.insertBefore(row, hud.firstChild);
    // 队伍栏：旧的 .party 原样挪进来（记下原来的位置，拆掉时放回去）
    const party = hud.querySelector(".party");
    const panel = d.createElement("aside");
    panel.className = "hd2d-party";
    panel.setAttribute("aria-label", SHELL.text.party);
    const head = d.createElement("div");
    head.className = "hd2d-party-head";
    const partyBtn = toggleBtn(d, "hd2d-party-toggle", SHELL.text.partyBtn);
    const tape = d.createElement("span");
    tape.className = "hd2d-tape";
    tape.textContent = SHELL.text.party;
    head.appendChild(partyBtn);
    head.appendChild(tape);
    panel.appendChild(head);
    if (party) {
      st.party = party;
      st.home = { parent: party.parentNode, next: party.nextSibling || null };
      panel.appendChild(party);
    }
    hud.appendChild(panel);
    Object.assign(st, { row, who, panel });
    hud[STATE] = st;
    wirePanel(hud, dockBtn, { name: "dock", storage, open: !phone, cls: "dock-closed" });
    wirePanel(panel, partyBtn, { name: "party", storage, open: !phone });
    return true;
  }
  /** 拆掉新外壳：队伍栏放回原来的位置，加的那一行、那块面板拿掉，加的类去掉——旧画面的 .g-hud 和换上之前一模一样。没换上过：返回 false */
  function detach(hud) {
    const st = hud && hud[STATE];
    if (!st) return false;
    if (st.row && st.row.parentNode) st.row.parentNode.removeChild(st.row);
    if (st.party && st.home && st.home.parent) {
      const h = st.home;
      if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(st.party, h.next);
      else h.parent.appendChild(st.party);
    }
    if (st.panel && st.panel.parentNode) st.panel.parentNode.removeChild(st.panel);
    hud.classList.remove("hd2d-shell", "hd2d-theme", "dock-closed");
    try { delete hud[STATE]; } catch (e) { hud[STATE] = undefined; }
    return true;
  }
  /** 这块 .g-hud 换上新外壳了没有（game.js / online-battle.js 画按钮时看它） */
  function on(hud) { return !!(hud && hud[STATE]); }
  /** 技能栏上面那一行写谁在行动（没换上新外壳不管） */
  function who(hud, html) {
    const st = hud && hud[STATE];
    if (!st || !st.who) return;
    const h = String(html || "");
    if (st.who.innerHTML !== h) st.who.innerHTML = h;
  }

  return {
    SHELL, isOpen, setOpen, labelOf, phoneNow, wirePanel, looks, lookOf, effectElements,
    skillButton, summonButton, pickSummon, hintsOf, member, whoHtml, attach, detach, on, who
  };
});
