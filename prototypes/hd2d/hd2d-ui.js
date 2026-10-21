/* Antlerscale: Backfire · HD-2D 战场原型 · 界面数据（纯函数，#238）
 *
 * 界面外壳（index.html 的队伍栏 / 技能栏、hd2d-scene.js 的铭牌）要画的东西，在这里整理成数据和 HTML 片段：
 *   econHtml(econ, big)            铭牌上的行动点 / 附赠动作（plateData 的 econ；画法照正式画面的单位卡 unit-card.js）
 *   effectsOf(u, icons) / effectsHtml(list, icons)   队伍栏名字右边身上的效果（状态图标用 hud-icons.js，没有图标的写短标签；多了写 +n，悬停看全部）
 *   heroLooks(cards, eleByCn) / avatarOf(look) / avatarHtml(av)   按主职责的头像：职责图标 + 主属性到副属性的渐变底
 * 不碰 three.js，也不碰 DOM，Node 里可以直接 require 来测（tests/hd2d-ui.test.js）。
 * 单位数据只读联机投影过的（online-view.js · projectUnit 的白名单）；坚毅生命（shp）压根不读。
 * 数值和对应表都在下面的 UI 里。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HD2DUI = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 配置（数值、对应表都在这里，逻辑里不写死）---------- */
  const UI = {
    /* 行动点 / 附赠：和 unit-card.js 一样画 max(上限, 现有) 个——行动点是圆点、附赠是三角，还有的实心、用掉的空心 / 灰；
     * 超过 maxPips 个就不画了，改写数字（训练木桩之类的） */
    econ: { maxPips: 4 },
    /* 队伍栏名字右边的效果：最多摆 show 个，多的写 +n（悬停 / 键盘停上去看全部）。
     * 有图标的用 hud-icons.js 的徽章（和正式画面的单位卡同一套）；没有图标的（濒死、失衡、嘲讽、掩护……）写短标签。
     * 状态文字（投影里的 display.status）里那几个是角色自己的仪表读数（刀头、能量 %……），不算身上的效果，不摆 */
    effects: {
      show: 3,
      flags: [{ key: "dying", name: "濒死", tone: "bad" }, { key: "stunned", name: "失衡", tone: "warn" }],
      skip: [/^(电钻|酸液炮|已探测|扳机解锁|友军|无状态)$/, /^能量\d+%$/, /^光能\d+$/]
    },
    /* 属性 → 代表色：和 attack-fx.js 的 COL 一样（原型的伤害数字、铭牌的状态色也是这一套）；名字和 icons.js 的 NAME 一样 */
    elements: { fire: "#ff5b2e", acid: "#9be03a", electric: "#ffd32e", ice: "#7ccfe8", energy: "#35e0c0", physical: "#ff9a3c", harmonic: "#c07cf0" },
    elementNames: { fire: "火", acid: "酸", electric: "电", ice: "冰", energy: "能量", physical: "物理", harmonic: "谐波" },
    /* 主职责 → 头像图标（职责名用游戏里现成的 growth.js · ROLE_LIST 九种，角色卡上的 roles.primary）。
     * 画法照美术定稿的贴纸图标（art/style-guide.html）：48×48 的格子里一层白边（.rim），上面一层墨线（.ink）；
     * class="thin" 细一点、"bold" 粗一点、"solid" 实心 */
    roles: {
      "直伤": `<circle cx="24" cy="24" r="13"/><path d="M24 5 V15 M24 33 V43 M5 24 H15 M33 24 H43"/><circle class="solid" cx="24" cy="24" r="3.4"/>`,   // 准星
      "异常": `<path d="M18 6 H30 M20 6 V18 L9 37 A4 4 0 0 0 12.5 43 H35.5 A4 4 0 0 0 39 37 L28 18 V6"/><path class="thin" d="M14 31 H34"/><circle class="solid" cx="21" cy="37" r="2.4"/><circle class="solid" cx="28.5" cy="35.5" r="1.7"/>`,   // 冒泡的药瓶
      "击破": `<path d="M24 4 L42 24 L24 44 L6 24 Z"/><path d="M27 9 L20.5 21 L28 26 L21.5 39"/>`,   // 裂开的架势菱形
      "坦克": `<path d="M24 4 L40 9.5 V22 C40 33 33 40 24 44 C15 40 8 33 8 22 V9.5 Z"/><path class="thin" d="M24 11 L34 14.5 V22.5 C34 29.5 30 34 24 37 C18 34 14 29.5 14 22.5 V14.5 Z"/>`,   // 厚盾
      "护卫": `<circle cx="15" cy="13" r="5.5"/><path d="M5 36 C5 27 9 22.5 15 22.5 C17.5 22.5 19.5 23.3 21 24.6"/><path d="M33 17 L44 21 V28.5 C44 35.5 39.5 39.5 33 43 C26.5 39.5 22 35.5 22 28.5 V21 Z"/>`,   // 盾挡在人前面
      "生存": `<path d="M24 42 C11 33.5 5 26.5 5 18 A9.5 9.5 0 0 1 24 13.5 A9.5 9.5 0 0 1 43 18 C43 26.5 37 33.5 24 42 Z"/><path class="bold" d="M24 19 V33 M17 26 H31"/>`,   // 心 + 十字
      "环境手": `<path d="M12 29 A7 7 0 0 1 12.5 15 A10.5 10.5 0 0 1 32 12.5 A8.5 8.5 0 0 1 36 29 Z"/><path class="thin" d="M7 36 H29 M14 42 H39 M33 36 H40"/>`,   // 云 + 风
      "控场": `<path d="M24 6 V42 M6 24 H42"/><path d="M18 12 L24 6 L30 12 M18 36 L24 42 L30 36 M12 18 L6 24 L12 30 M36 18 L42 24 L36 30"/>`,   // 四向箭头（挪动单位）
      "辅助": `<path d="M7 19 V29 H13 L30 38 V10 L13 19 Z"/><path d="M14 29 L17 39 H22.5 L20.5 30.5"/><path class="thin" d="M35 18.5 Q38.5 24 35 29.5 M39.5 14 Q45.5 24 39.5 34"/>`   // 喇叭（助威）
    },
    /* 头像：渐变从左上到右下（主属性 → 副属性，只有一种属性就是纯色）；认不得的角色（没有角色卡 / 职责）用人形图标 + 灰色底 */
    avatar: {
      direction: "to bottom right",
      fallback: "#a8977b",
      glyph: `<circle cx="24" cy="15" r="7"/><path d="M10 42 C10 31 16 26 24 26 C32 26 38 31 38 42"/>`
    }
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- 铭牌上的行动点 / 附赠 ---------- */
  /** 「行动点 1/1 · 附赠 0/1」（悬停说明、读屏用） */
  function econText(econ) {
    if (!econ) return "";
    return `行动点 ${econ.ap.cur}/${econ.ap.max} · 附赠 ${econ.bonus.cur}/${econ.bonus.max}`;
  }
  /** 一种（行动点 ap / 附赠 bn）的小标记：画 max(上限, 现有) 个，前 cur 个是满的；太多就写数字 */
  function pipsOf(kind, v, label) {
    const n = Math.max(v.max, v.cur);
    if (!n) return "";
    if (n > UI.econ.maxPips) return `<b class="${kind}">${label}${v.cur}/${v.max}</b>`;
    let s = "";
    for (let i = 0; i < n; i++) s += `<i class="${kind}${i < v.cur ? " on" : ""}"></i>`;
    return s;
  }
  /** 铭牌上的行动点 / 附赠（plateData 的 econ：投影里的 ap / apMax / bonus / bonusMax）。
   *  紧凑铭牌：贴在卡片右上角的一小块（不占名字和血条的地方）；近景放大的铭牌（big）：写在名字那一行。econ 是 null（配置物等）时不画 */
  function econHtml(econ, big) {
    if (!econ) return "";
    const body = pipsOf("ap", econ.ap, "行") + pipsOf("bn", econ.bonus, "附");
    if (!body) return "";
    const t = esc(econText(econ));
    return `<span class="pl-econ${big ? " in" : ""}" title="${t}" role="img" aria-label="${t}">${body}</span>`;
  }

  /* ---------- 队伍栏：名字右边身上的效果 ---------- */
  /**
   * 一个单位身上的效果（u 是联机投影过的单位：online-view.js · projectUnit）。icons = hud-icons.js（HudIcons），没有就只写短标签。
   * 返回 [{ key, name, stack, icon（有没有 hud-icons 的图标）, tone（bad / warn / ""）, title }]，顺序：濒死 / 失衡 → 有图标的 → 状态文字里没图标的
   */
  function effectsOf(u, icons) {
    if (!u) return [];
    const out = [], seen = new Set();
    const put = (e) => { if (!seen.has(e.key)) { seen.add(e.key); out.push(e); } };
    UI.effects.flags.forEach(f => { if (u[f.key]) put({ key: f.key, name: f.name, stack: "", icon: false, tone: f.tone, title: f.name }); });
    // 有图标的：属性状态、通用状态、即时效果、自我效果、挂着的攻击效果、下陷 / 下潜 / 休眠、晕眩标记、别人挂上的刺入 / 牵挂（hud-icons.js · unitBadges，正式画面同一套）
    if (icons && typeof icons.unitBadges === "function") {
      icons.unitBadges(u, u.marks).forEach(b => {
        const ic = icons.ICONS && icons.ICONS[b.key];
        if (!ic) return;
        const stack = b.stack != null && b.stack !== "" && b.stack !== true ? String(b.stack) : "";
        put({ key: b.key, name: ic.name, stack, icon: true, tone: "", title: b.title || ic.name + (stack ? " " + stack : "") });
      });
    }
    // 状态文字（主机算好、白名单一段一段过滤过的 display.status）里没有图标的那几样：嘲讽、掩护、聚焦、禁足……
    const line = u.display && typeof u.display.status === "string" ? u.display.status : "";
    line.split(" · ").map(t => t.trim()).filter(Boolean).forEach(t => {
      if (UI.effects.skip.some(re => re.test(t))) return;
      if (icons && typeof icons.covered === "function" && icons.covered(t)) return;
      if (UI.effects.flags.some(f => f.name === t)) return;
      put({ key: "t:" + t, name: t, stack: "", icon: false, tone: "", title: t });
    });
    return out;
  }
  const effectName = (e) => e.name + (e.stack ? " " + e.stack : "");
  /** 一个效果的小标记：有图标的用 hud-icons.js 的徽章，没有的写短标签 */
  function effectChip(e, icons) {
    if (e.icon && icons && typeof icons.badge === "function") return icons.badge(e.key, e.stack, e.title);
    return `<em class="fx-t${e.tone ? " " + e.tone : ""}" title="${esc(e.title)}">${esc(e.name)}</em>`;
  }
  /** 名字右边的效果：最多 UI.effects.show 个，多的写 +n；悬停 / 键盘停上去展开全部（带名字和层数）。没有效果就什么都不画 */
  function effectsHtml(list, icons, show) {
    if (!list || !list.length) return "";
    const n = show == null ? UI.effects.show : show;
    const head = list.slice(0, n).map(e => effectChip(e, icons)).join("");
    const more = list.length > n ? `<em class="fx-more">+${list.length - n}</em>` : "";
    const all = list.map(e => `<span class="fx-row">${effectChip(e, icons)}<b>${esc(effectName(e))}</b></span>`).join("");
    const label = esc("身上的效果：" + list.map(effectName).join("、"));
    return `<span class="pm-fx hi-badges" tabindex="0" aria-label="${label}">${head}${more}<span class="pm-fx-all" role="tooltip">${all}</span></span>`;
  }

  /* ---------- 按主职责的头像 ---------- */
  /**
   * 角色卡 → 头像要的东西：主职责（roles.primary）、主属性 / 副属性（note 里「人类黑客 · 能量/电 · 直伤专精」中间那段，斜杠前主、后副；
   * 和 game.js · mainElementOf、app.js · partyElements 同一个读法）。cards = party.js · livePartyCards()，eleByCn = app.js 的 ELE_BY_CN。
   * 武器人（weaponOf）不进队伍栏，不算。只拿这三样（角色卡上别的字段，例如坚毅生命，一个都不带出来）
   */
  function heroLooks(cards, eleByCn) {
    const out = {}, map = eleByCn || {};
    (cards || []).forEach(c => {
      if (!c || typeof c.kit !== "string" || c.weaponOf || !c.roles) return;
      const part = String(c.note || "").split("·").map(x => x.trim())[1] || "";
      const els = part.split("/").map(x => map[x.trim()]).filter(e => !!UI.elements[e]);
      out[c.kit] = { role: typeof c.roles.primary === "string" ? c.roles.primary : null, main: els[0] || null, sub: els[1] || els[0] || null };
    });
    return out;
  }
  /** 头像：look = heroLooks(...)[kit]（认不得的角色给 null）。渐变 = 主属性色 → 副属性色，从左上到右下 */
  function avatarOf(look) {
    const role = look && UI.roles[look.role] ? look.role : null;
    const main = look && UI.elements[look.main] ? look.main : null;
    const sub = look && UI.elements[look.sub] ? look.sub : main;
    const from = main ? UI.elements[main] : UI.avatar.fallback, to = sub ? UI.elements[sub] : from;
    return { role, main, sub, from, to, glyph: role ? UI.roles[role] : UI.avatar.glyph, background: `linear-gradient(${UI.avatar.direction}, ${from}, ${to})` };
  }
  /** 贴纸风的图标：一层白边、上面一层墨线（同一个图案画两遍） */
  const stickerSvg = (glyph, cls) => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><g class="rim">${glyph}</g><g class="ink">${glyph}</g></svg>`;
  function avatarHtml(av) {
    const els = [av.main, av.sub !== av.main ? av.sub : null].filter(Boolean).map(e => UI.elementNames[e]);
    const tip = (av.role ? "主职责 " + av.role : "职责未知") + (els.length ? " · " + els.join(" / ") : "");
    return `<span class="face av" style="background:${av.background}" title="${esc(tip)}" role="img" aria-label="${esc(tip)}">${stickerSvg(av.glyph, "av-ic")}</span>`;
  }

  return { UI, esc, econText, econHtml, effectsOf, effectsHtml, heroLooks, avatarOf, avatarHtml, stickerSvg };
});
