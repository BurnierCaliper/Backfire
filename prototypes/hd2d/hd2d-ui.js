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
    },
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
  /** 属性角标：icons.js 的七种属性贴纸图标（Icons.element），颜色 = 属性色；无属性画一个灰圈 */
  function elementBadge(b, icons) {
    const tip = b.element ? b.elementName + "属性" : "无属性";
    const color = b.element ? UI.elements[b.element] : UI.avatar.fallback;
    const svg = b.element && icons && typeof icons.element === "function" ? icons.element(b.element)
      : `<svg class="eicon" viewBox="0 0 48 48" aria-hidden="true"><g class="o"><circle cx="24" cy="24" r="12"/></g><g class="c"><circle cx="24" cy="24" r="12"/></g></svg>`;
    return `<span class="sk-el${b.element ? "" : " none"}" style="color:${color}" title="${esc(tip)}">${svg}</span>`;
  }
  /** 攻击 / 技能角标：贴纸风的小图标（剑 / 齿轮） */
  const kindBadge = (b) => `<span class="sk-kind" title="${esc(b.kindName)}">${stickerSvg(UI.skill.kinds[b.kind].glyph, "sk-k-ic")}</span>`;
  /** 普通技能按钮（照 game.js 的 .sk：名字一行、消耗一行）：左上角属性、右上角攻击 / 技能；按顺序轮流换颜色；悬停写名字、消耗、说明 */
  function skillHtml(b, icons) {
    const cost = costParts(b.cost).map(p => `<span class="${p.k}">${esc(p.t)}</span>`).join(" ") || "不耗行动";
    const tip = `${b.name}（${costText(b.cost)} · ${b.elementName} · ${b.kindName}）\n${b.text}`;
    return `<button class="sk t-${b.tint} k-${b.kind}" data-skill="${esc(b.id)}" title="${esc(tip)}" aria-label="${esc(`${b.name}：${b.elementName}${b.kindName}，${costText(b.cost)}`)}">` +
      `${elementBadge(b, icons)}${kindBadge(b)}<span class="nm">${esc(b.name)}</span><span class="cost">${cost}</span></button>`;
  }
  /** 唤出 / 收回武器人的大按钮里面那几样（照 game.js · #g-summon：图标、名字、消耗）；颜色（--el）由页面按这个人的主属性给 */
  const summonInner = (b) => `${UI.skill.summonIcon(b.back)}<span class="sm-nm">${esc(b.name)}</span><small>${esc(costText(b.cost))}</small>`;

  return {
    UI, esc, econText, econHtml, effectsOf, effectsHtml, heroLooks, avatarOf, avatarHtml, stickerSvg,
    isSummon, skillKind, skillElement, costText, skillBar, skillHtml, summonInner
  };
});
