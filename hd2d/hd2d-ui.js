/* Antlerscale: Backfire · HD-2D 战场原型 · 界面数据（纯函数，#238）
 *
 * 界面外壳（index.html 的队伍栏 / 技能栏、hd2d-scene.js 的铭牌）要画的东西，在这里整理成数据和 HTML 片段：
 *   econHtml(econ, big)            铭牌上的行动点 / 附赠动作（plateData 的 econ；画法照正式画面的单位卡 unit-card.js）
 *   mechsHtml(mechs, UnitCard) / towersHtml(towers, UnitCard)   铭牌上方的首领机制图标、地台上的踩塔（#283；画法、文字全用 unit-card.js）
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
     * 主人亲自定稿（10/22）：FF14 职业图标那种简单图形、不直白——先从职责的四个技能提炼精髓，再用几块形状暗示它。
     * 画法照美术定稿的贴纸图标（art/style-guide.html）：48×48 的格子里一层白边（.rim），上面一层墨线（.ink）；
     * class="thin" 细一点、"bold" 粗一点、"solid" 实心、"frag" 碎片（白边细，碎片之间露出缝）、"ghost" 虚线影子、
     * "hole" 实心块上挖出的洞、"cut" 实心块上的白缝（样式在 hd2d.css 的 .stk） */
    roles: {
      "直伤": `<path class="solid" d="M43 5 L22 21 L15 33 L27 26 Z"/><circle class="solid" cx="9.5" cy="38.5" r="3.6"/><path class="thin" d="M6 26 L13 29 M22 42 L19 35"/>`,   // 锋芒：一枚往前刺出的细长锋尖，尾部收成一点
      "异常": `<path d="M24 9 L37 16.5 V31.5 L24 39 L11 31.5 V16.5 Z"/><circle class="solid" cx="37" cy="16.5" r="5"/><circle class="solid" cx="24" cy="24" r="2.6"/>`,   // 催化：一个分子环，其中一个节点被点亮
      "击破": `<path class="solid" d="M30 10 A14 14 0 0 1 30 38 L29 34 L26 30 L28 26 L25 22 L29 18 L27 14 Z"/><path class="ghost" d="M30 10 A14 14 0 0 0 30 38"/><path class="solid frag" transform="translate(-4 -4) rotate(-12 26 10.5)" d="M26 10.5 L18 13.5 L24 19.5 Z"/><path class="solid frag" transform="translate(-7 0) rotate(6 23 21)" d="M23 21 L15 23.5 L22.5 27.5 Z"/><path class="solid frag" transform="translate(-4 4) rotate(14 25.5 29.5)" d="M25.5 29.5 L18.5 34 L27 37.5 Z"/><path class="solid frag" transform="translate(0 0) rotate(0 6 10)" d="M6 10 L9.5 9 L8.5 12.5 Z"/><path class="solid frag" transform="translate(0 0) rotate(0 5 36)" d="M5 36 L9 37.5 L5.5 40 Z"/>`,   // 半碎：冲击从左边打进来：右半边还保持原来的圆，左半边已经碎开飞溅（原轮廓留一道虚影）
      "坦克": `<path class="solid" d="M12 16 V7 H17.5 V11 H21.5 V7 H26.5 V11 H30.5 V7 H36 V16 L32 19.5 L34.5 44 H13.5 L16 19.5 Z"/><path class="hole" d="M21.5 31 V26 A2.5 2.5 0 0 1 26.5 26 V31 Z"/><path class="cut" d="M15.5 19.5 H32.5"/>`,   // 城塔：一座收腰的高塔，塔顶垛口往外挑，中间一扇拱窗
      "护卫": `<path class="solid" d="M22 5 L7 24 L22 43 L27 38 L15 24 L27 10 Z"/><circle class="solid" cx="34" cy="24" r="6.5"/>`,   // 前锋：一枚楔形挡在一个点的前面
      "生存": `<circle class="thin" cx="24" cy="24" r="18"/><path class="bold" d="M5 25 H14 L18.5 14 L25 35 L29.5 20 L32.5 25 H43"/>`,   // 脉动：一圈里穿过一道心跳的折线
      "环境手": `<path d="M24 41 L43 31 L24 21 L5 31 Z"/><path class="thin" d="M14.5 36 L33.5 26 M14.5 26 L33.5 36"/><circle class="solid" cx="24" cy="10" r="5"/><path class="thin" d="M24 17 V21"/>`,   // 场域：一块被俯看的场地，上空悬着一个光点
      "控场": `<path class="ghost" d="M11 31.5 L20 37 L11 42.5 L2 37 Z"/><path class="thin" d="M24 21.5 L33 27 L24 32.5 L15 27 Z"/><path class="solid" d="M37 11.5 L46 17 L37 22.5 L28 17 Z"/><path d="M11 31 Q12 8 30 10.5"/><path class="solid frag" d="M28.5 6.5 L35 11 L28 14 Z"/>`,   // 跃区：三块斜排的菱形地台（区）：一个单位被提起来，沿弧线落到另一块
      "辅助": `<path class="solid" d="M24 11 L27.5 20.5 L37 24 L27.5 27.5 L24 37 L20.5 27.5 L11 24 L20.5 20.5 Z"/><path d="M8 14 A20 20 0 0 0 8 34 M40 14 A20 20 0 0 1 40 34"/>`   // 共鸣：一颗星芒向两边荡开回声
    },
    /* 头像：渐变从左上到右下（主属性 → 副属性，只有一种属性就是纯色）；认不得的角色（没有角色卡 / 职责）用人形图标 + 灰色底 */
    avatar: {
      direction: "to bottom right",
      fallback: "#a8977b",
      glyph: `<circle cx="24" cy="15" r="7"/><path d="M10 42 C10 31 16 26 24 26 C32 26 38 31 38 42"/>`
    },
    /* 队伍栏名字下面的分层血条（#297：以前写在原型页里，正式画面也用）：每层的颜色（没写的按肉体）、空掉的那一截的底色 */
    layers: { flesh: "#d8574a", armor: "#9aa7b3", shield: "#4fb8ff", sand: "#d1a85a", spirit: "#c07cf0", empty: "#2a2520" },
    /* 技能栏（照正式战斗画面 game.html / game.js 的技能栏）：
     *   summon   唤出 / 收回武器人（game.js · isSummonSkill）和武器人倒下后的「取回武器」：单独做成大按钮，放在「结束回合」旁边，不进普通技能按钮；
     *            两个都有时先放取回武器（同 game.js）
     *   tints    普通技能按钮按顺序轮流用的颜色（以前原型的做法：黄、薄荷、米白、粉）
     *   max      最多摆几个按钮
     *   kinds    右上角的角标：攻击（打伤害 / 击破的）还是技能（功能性的：加状态、治疗、移动、换架势……）；图标画法同头像（白边 + 墨线）
     * 技能的属性、攻击还是技能，从技能的提示文字（party.js · skillList 的 hint）里读，照 engine.js · parseSkillRange 的做法：
     *   按「·」分段，有 atk 又写了属性 / 伤害 / 击破、或者写着「N 击破」的那一段算打伤害（攻击）；属性先看打伤害的那段里的属性字，
     *   再看挂上的效果名（图鉴 codex.js · CODEX_EFFECTS 里带属性的：感电、熔融、过载、雪天……），再看提示里随便哪个属性字；都没有 = 无属性。
     *   读不准的在下面的例外表里写明，优先于文字：kind（攻击 / 技能）、element（属性，null = 无属性）、byState（属性跟着刀 / 引擎变，读投影里的单位） */
    skill: {
      summon: [/_summon$/, /_return$/, /^weapon_retrieve$/],
      first: "weapon_retrieve",
      tints: ["hazard", "mint", "canvas", "pink"],
      max: 12,
      kinds: {
        attack: { name: "攻击", glyph: `<path d="M13 35 L37 11"/><path d="M33 9 L39 9 L39 15"/><path d="M9 29 L19 39"/><path class="bold" d="M7 41 L12 36"/>` },   // 一把剑
        skill: { name: "技能", glyph: `<circle cx="24" cy="24" r="13" class="bold" stroke-dasharray="5.1 5.1"/><circle cx="24" cy="24" r="8.5"/><circle class="solid" cx="24" cy="24" r="2.6"/>` }   // 齿轮
      },
      words: { "火焰": "fire", "火": "fire", "冰冻": "ice", "冰": "ice", "电击": "electric", "电": "electric", "酸液": "acid", "酸": "acid", "能量": "energy", "物理": "physical", "谐波": "harmonic" },
      notWords: ["电能"],   // 川川的电能是资源，不是电属性
      kind: {
        role_halve: "attack",      // 折戟：造成当前架势一半的击破
        yuito_extract: "attack",   // 酸萃：敌人吃同样骰数的酸
        torque_boost: "attack",    // 强化输出（酸液炮）：下回合对整区酸液 AOE
        wing_relay: "skill",       // 银翼 · 收发代理：放无人机，之后每回合自己打
        hiaki_powder: "skill",     // 粉落汤气：架势，格挡成功才反击
        longge_drink: "skill",     // 饮弹：枪口对准自己
        longge_shuffle: "skill"    // 洗牌：重排子弹，顺带的一枪不算主要的
      },
      element: {
        sand_pull: null,           // 拉出流沙：「流沙」是场地名，不是属性
        role_spread: null,         // 传播：提示里举例的「灼烧」不是它的属性
        wing_boost: null           // 银翼 · 机体强化：「溅射倍率」是普攻的溅射，不是酸属性的溅射效果
      },
      byState: {
        // 绯秋：按手里的刀（投影里的 resources.blade：丹生谷 = 火、鳴門 = 冰）；粉落汤气用另一把反击
        hiaki_aa: (u) => bladeEl(u, false), hiaki_flash: (u) => bladeEl(u, false), hiaki_barrage: (u) => bladeEl(u, false), hiaki_powder: (u) => bladeEl(u, true),
        // 夕夏：引擎发动时普通攻击变成火焰（投影里的 resources.engine）
        xia_aa: (u) => (u && u.resources && u.resources.engine ? "fire" : "physical")
      },
      // 唤出 / 收回武器人的图标（照 game.js · summonIcon：一把刀被圆形箭头环绕；唤出 = 顺时针、刀上冒出生命的火花，收回 = 逆时针）
      summonIcon: (back) => `<svg class="sm-ic" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 4a16 16 0 1 1-14.3 8.8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>` +
        (back ? `<path d="M3 6v7.5h7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
              : `<path d="M20 4l-5-3M20 4l-4 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`) +
        `<path d="M13 27 25 15l2.2 2.2L15.2 29.2z" fill="currentColor"/><path d="M11 25l6 6M10.5 30.5l2.5-2.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>` +
        (back ? "" : `<path d="M28 9l1.2 2.6 2.6 1.2-2.6 1.2L28 16.6l-1.2-2.6-2.6-1.2 2.6-1.2z" fill="currentColor"/>`) + `</svg>`
    }
  };
  /** 绯秋手里那把刀的属性（other = 另一把）：投影里的 resources.blade（niu 丹生谷 = 火，naruto 鳴門 = 冰；没写就是丹生谷，同 hud-icons.js） */
  function bladeEl(u, other) {
    const naruto = !!(u && u.resources && u.resources.blade === "naruto");
    return naruto !== !!other ? "ice" : "fire";
  }

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

  /* ---------- 首领机制（#283）：铭牌上方的图标、地台上的踩塔 ----------
   * 图标、倒计时、悬停说明全用正式画面的 unit-card.js（UC = UnitCard：mechIconsHtml / towerMarkHtml，里面是 mechLeft / phaseText / markTip 那一套），
   * 这里只包一层。数据是投影里的（hd2d-layout.js · mechsOf / towersOf）。没有 UnitCard（原型页不加载）或没有机制 = "" */
  /** 铭牌上方那一排：被点名的标记、首领正在读条的机制（和旧画面单位卡的 .u-mechs 同一份 HTML） */
  function mechsHtml(mechs, UC) {
    if (!mechs || !UC || typeof UC.mechIconsHtml !== "function") return "";
    const html = UC.mechIconsHtml({ marks: mechs.marks || [], casts: mechs.casts || [] });
    return html ? `<div class="pl-mechs">${html}</div>` : "";
  }
  /** 地台前沿的踩塔：图标（数字 = 还有几回合）+ 几人 / 要几人（和旧画面区名旁边的 .ztower-mark 同一份 HTML） */
  function towersHtml(towers, UC) {
    if (!towers || !towers.length || !UC || typeof UC.towerMarkHtml !== "function") return "";
    return UC.towerMarkHtml(towers);
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
  /** 名字右边的效果：最多 UI.effects.show 个，多的写 +n；悬停 / 键盘停上去展开全部（带名字和层数）。没有效果就什么都不画。
   *  o.focus = false：不让键盘停上去（正式画面的队伍栏一个人是一个按钮，按钮里面不能再放能停上去的东西；悬停照样展开） */
  function effectsHtml(list, icons, show, o) {
    if (!list || !list.length) return "";
    const n = show == null ? UI.effects.show : show;
    const head = list.slice(0, n).map(e => effectChip(e, icons)).join("");
    const more = list.length > n ? `<em class="fx-more">+${list.length - n}</em>` : "";
    const all = list.map(e => `<span class="fx-row">${effectChip(e, icons)}<b>${esc(effectName(e))}</b></span>`).join("");
    const label = esc("身上的效果：" + list.map(effectName).join("、"));
    const focus = o && o.focus === false ? "" : ` tabindex="0"`;
    return `<span class="pm-fx hi-badges"${focus} aria-label="${label}">${head}${more}<span class="pm-fx-all" role="tooltip">${all}</span></span>`;
  }

  /* ---------- 队伍栏：一个人（原型页和正式画面共用，#297）---------- */
  /** 分层血条：每层按上限占宽度、按现在的血量涂颜色（最外层在左）。layers = 投影里的 [{ type, current, max }]（演出快照写 cur 的也认） */
  function layerBarHtml(layers) {
    const L = (Array.isArray(layers) ? layers : []).filter(l => l && typeof l === "object").map(l => ({
      type: l.type, cur: Math.max(0, Number(l.current != null ? l.current : l.cur) || 0), max: Math.max(0, Number(l.max) || 0)
    }));
    const total = L.reduce((a, l) => a + l.max, 0);
    return L.slice().reverse().map(l => {
      const w = total ? 100 * l.max / total : 0, fill = l.max ? 100 * Math.min(l.cur, l.max) / l.max : 0;
      return `<i style="width:${+w.toFixed(2)}%;background:linear-gradient(90deg,${UI.layers[l.type] || UI.layers.flesh} ${+fill.toFixed(2)}%,${UI.layers.empty} 0)"></i>`;
    }).join("");
  }
  /**
   * 队伍栏一个人里面的东西：主职责头像 + 名字 / 等级 /（o.tag 小字：联机的「你」、热座的操控者）/ 身上的效果 + 分层血条。
   * u = 投影过的单位（online-view.js · projectUnit：名字、等级、血量层、状态……；坚毅生命压根没有，这里也不读），
   * look = heroLooks(...)[kit]（武器人用主人的，认不得给 null），o = { icons（hud-icons.js）, tag, focus（见 effectsHtml）}。
   * 外面那一层（原型页的 div.pm、正式画面的队伍按钮）由页面自己做，点击照旧是页面的
   */
  function partyInner(u, look, o) {
    o = o || {};
    const name = u ? (u.name || u.id || "") : "";
    const level = Math.max(1, Math.round(Number(u && u.level) || 1));
    const tag = o.tag ? `<span class="pm-tag">${esc(o.tag)}</span>` : "";
    const fx = effectsHtml(effectsOf(u, o.icons), o.icons, null, { focus: o.focus });
    return `${avatarHtml(avatarOf(look || null))}<span class="meta"><span class="nm"><span class="nm-t">${esc(name)}</span><span class="lv">Lv${level}</span>${tag}${fx}</span>` +
      `<span class="bar">${layerBarHtml(u && u.layers)}</span></span>`;
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
  /** 贴纸风的图标：一层白边、上面一层墨线（同一个图案画两遍）；样式在 hd2d.css 的 .stk */
  const stickerSvg = (glyph, cls) => `<svg class="stk ${cls}" viewBox="0 0 48 48" aria-hidden="true"><g class="rim">${glyph}</g><g class="ink">${glyph}</g></svg>`;
  function avatarHtml(av) {
    const els = [av.main, av.sub !== av.main ? av.sub : null].filter(Boolean).map(e => UI.elementNames[e]);
    const tip = (av.role ? "主职责 " + av.role : "职责未知") + (els.length ? " · " + els.join(" / ") : "");
    return `<span class="face av" style="background:${av.background}" title="${esc(tip)}" role="img" aria-label="${esc(tip)}">${stickerSvg(av.glyph, "av-ic")}</span>`;
  }

  /* ---------- 技能栏 ---------- */
  const isSummon = (id) => UI.skill.summon.some(re => re.test(String(id || "")));
  /** 提示文字按「·」分段（「/」不拆：0.3/0.3/0.4atk、atk/2 是一个数）；川川的「电能」这类不是属性的先抹掉 */
  function segsOf(text) {
    let s = String(text || "");
    UI.skill.notWords.forEach(w => { s = s.split(w).join("□".repeat(w.length)); });
    return s.split(/[·。；]/).map(x => x.trim()).filter(Boolean);
  }
  const wordRe = () => new RegExp(Object.keys(UI.skill.words).sort((a, b) => b.length - a.length).join("|"), "g");
  /** 这一段是不是打伤害：有 atk、又写了属性 / 伤害 / 击破；或者写着「N 击破」（无属性击破、3 冰击破……） */
  const dmgSeg = (seg) => (/atk/i.test(seg) && (wordRe().test(seg) || /伤害|击破/.test(seg))) || /\d+\s*(?:无属性|[火冰电酸]|能量|物理|谐波)?\s*击破/.test(seg);
  /** 一段文字里第一个出现的属性字 → 属性 */
  function firstWord(text) {
    const m = wordRe().exec(String(text || ""));
    return m ? UI.skill.words[m[0]] : null;
  }
  /** 攻击还是技能：先看例外表，再看提示里有没有打伤害的那一段 */
  function skillKind(row) {
    const id = row && row.id;
    if (id && Object.prototype.hasOwnProperty.call(UI.skill.kind, id)) return UI.skill.kind[id];
    return segsOf(row && row.hint).some(dmgSeg) ? "attack" : "skill";
  }
  /**
   * 技能的属性（fire / ice / … 或者 null = 无属性）。unit = 投影过的单位（属性跟着刀 / 引擎变的那几个读它）；
   * effects = 图鉴里带属性的效果 [[名字, 属性]]（codex.js · CODEX_EFFECTS），没有就跳过这一步
   */
  function skillElement(row, unit, effects) {
    const id = row && row.id, S = UI.skill;
    if (id && S.byState[id]) return S.byState[id](unit);
    if (id && Object.prototype.hasOwnProperty.call(S.element, id)) return S.element[id];
    const segs = segsOf(row && row.hint), text = segs.join(" · ");
    // 打伤害的那一段：先看 atk 后面紧跟的属性字（「+20%能量 → 1atk 电」打的是电），没有再看这一段里第一个
    for (const seg of segs) if (dmgSeg(seg)) { const at = seg.search(/atk/i), e = (at >= 0 && firstWord(seg.slice(at))) || firstWord(seg); if (e) return e; }
    let best = null;
    (effects || []).forEach(([name, el]) => { const at = text.indexOf(name); if (at >= 0 && UI.elements[el] && (!best || at < best.at)) best = { at, el }; });
    if (best) return best.el;
    return firstWord(text);
  }
  /** 消耗：「行动 1」「附赠 1」「不耗行动」（同 game.js 的技能按钮） */
  function costParts(cost) {
    const c = cost || {}, out = [];
    if (c.ap) out.push({ k: "ap", t: "行动 " + c.ap });
    if (c.bonus) out.push({ k: "bn", t: "附赠 " + c.bonus });
    return out;
  }
  const costText = (cost) => costParts(cost).map(p => p.t).join(" · ") || "不耗行动";
  /** 一个按钮要的东西 */
  function buttonOf(row, unit, effects, i) {
    const kind = skillKind(row), element = skillElement(row, unit, effects);
    return {
      id: String(row.id || ""), name: String(row.name || "?"), hint: String(row.hint || ""), text: String(row.text || row.hint || ""),
      cost: { ap: Number((row.cost || {}).ap) || 0, bonus: Number((row.cost || {}).bonus) || 0 },
      kind, kindName: UI.skill.kinds[kind].name, element, elementName: element ? UI.elementNames[element] : "无属性",
      tint: UI.skill.tints[i % UI.skill.tints.length]
    };
  }
  /**
   * 技能栏：rows = 这个人的技能 [{ id, name, hint, text, cost: { ap, bonus } }]（原型的占位：房主本机规则里的技能表，同以前），
   * unit = 投影过的单位，opts.effects = 图鉴里带属性的效果。返回 { skills: 普通技能按钮, summon: 唤出 / 收回武器人的大按钮（没有就是 null） }。
   * 唤出 / 收回武器人、取回武器都不进普通技能按钮
   */
  function skillBar(rows, unit, opts) {
    const list = (rows || []).filter(r => r && r.id);
    const summonRow = list.find(r => r.id === UI.skill.first) || list.find(r => isSummon(r.id)) || null;
    const skills = list.filter(r => !isSummon(r.id)).slice(0, UI.skill.max).map((r, i) => buttonOf(r, unit, opts && opts.effects, i));
    const summon = summonRow ? Object.assign(buttonOf(summonRow, unit, opts && opts.effects, 0), { back: /_return$/.test(summonRow.id) || summonRow.id === UI.skill.first }) : null;
    return { skills, summon };
  }
  /** 属性角标：icons.js 的七种属性贴纸图标（Icons.element），颜色 = 属性色；无属性画一个灰圈。titles = false：不写悬停的小字（正式画面悬停弹完整的技能说明） */
  function elementBadge(b, icons, titles) {
    const tip = b.element ? b.elementName + "属性" : "无属性";
    const color = b.element ? UI.elements[b.element] : UI.avatar.fallback;
    const svg = b.element && icons && typeof icons.element === "function" ? icons.element(b.element)
      : `<svg class="eicon" viewBox="0 0 48 48" aria-hidden="true"><g class="o"><circle cx="24" cy="24" r="12"/></g><g class="c"><circle cx="24" cy="24" r="12"/></g></svg>`;
    return `<span class="sk-el${b.element ? "" : " none"}" style="color:${color}"${titles === false ? "" : ` title="${esc(tip)}"`}>${svg}</span>`;
  }
  /** 攻击 / 技能角标：贴纸风的小图标（剑 / 齿轮） */
  const kindBadge = (b, titles) => `<span class="sk-kind"${titles === false ? "" : ` title="${esc(b.kindName)}"`}>${stickerSvg(UI.skill.kinds[b.kind].glyph, "sk-k-ic")}</span>`;
  /** 技能按钮里面的东西（原型页的 skillHtml、正式画面的技能按钮共用，#297）：左上角属性、右上角攻击 / 技能、名字一行、消耗一行。
   *  o = { key 快捷键（正式画面的数字键，写在右下角）, cost 消耗那一行换成这段文字（联机：房主算好的消耗、用不了的原因）, titles（见 elementBadge）} */
  function skillInner(b, icons, o) {
    o = o || {};
    const cost = o.cost != null ? esc(o.cost) : (costParts(b.cost).map(p => `<span class="${p.k}">${esc(p.t)}</span>`).join(" ") || "不耗行动");
    const key = o.key != null && o.key !== "" ? `<span class="key">${esc(o.key)}</span>` : "";
    return `${elementBadge(b, icons, o.titles)}${kindBadge(b, o.titles)}${key}<span class="nm">${esc(b.name)}</span><span class="cost">${cost}</span>`;
  }
  /** 普通技能按钮（照 game.js 的 .sk：名字一行、消耗一行）：左上角属性、右上角攻击 / 技能；按顺序轮流换颜色；悬停写名字、消耗、说明 */
  function skillHtml(b, icons) {
    const tip = `${b.name}（${costText(b.cost)} · ${b.elementName} · ${b.kindName}）\n${b.text}`;
    return `<button class="sk t-${b.tint} k-${b.kind}" data-skill="${esc(b.id)}" title="${esc(tip)}" aria-label="${esc(`${b.name}：${b.elementName}${b.kindName}，${costText(b.cost)}`)}">` +
      `${skillInner(b, icons)}</button>`;
  }
  /** 唤出 / 收回武器人的大按钮里面那几样（照 game.js · #g-summon：图标、名字、消耗）；颜色（--el）由页面按这个人的主属性给。
   *  o = { cost 消耗换成这段文字（联机：房主算好的）, key 快捷键（写在消耗后面：「· Q」）} */
  const summonInner = (b, o) => {
    o = o || {};
    const cost = o.cost != null ? String(o.cost) : costText(b.cost);
    return `${UI.skill.summonIcon(b.back)}<span class="sm-nm">${esc(b.name)}</span><small>${esc(cost + (o.key ? " · " + o.key : ""))}</small>`;
  };

  return {
    UI, esc, econText, econHtml, mechsHtml, towersHtml, effectsOf, effectsHtml, heroLooks, avatarOf, avatarHtml, stickerSvg, layerBarHtml, partyInner,
    isSummon, skillKind, skillElement, costText, skillButton: buttonOf, skillBar, skillInner, skillHtml, summonInner
  };
});
