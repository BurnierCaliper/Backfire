/* Antlerscale: Backfire · 单位卡（战场上的铭牌）的画法
 * 战斗画面（game.js）和联机玩家的战斗画面（online-battle.js）共用：只管 DOM，不碰规则和战场状态。
 *   const c = UnitCard.create(snap)   → { id, wrap, unit, … }（snap 的字段见 game.js · snapUnit）
 *   UnitCard.update(c, snap, { sim })  → 按快照更新血条、架势、耐久、行动点、状态徽章、头顶的首领机制图标；sim 时不播放生效动画
 *   UnitCard.headOf(snap)              → 卡片顶上写的名字、等级、ATK（和载具合并的驾驶员按车写）
 * 首领机制（FF14 式）：被点名的人头上一个贴纸图标（角上的大数字 = 还有几回合），首领头上是它正在读条的机制，
 * 悬停 / 触屏点一下看说明；铭牌上不写机制名字、不画边框。新点名的那一下图标「啪」地弹出来、响一声（MECH_ALERT）。
 *   UnitCard.paintTowers(zone, towers, { sim })  → 踩塔：区名旁边的图标 + 地面上的一圈
 *   UnitCard.paintBanner(field, snaps)  → 战场正上方的机制横幅（红字白描边，剩余回合少的在上面），和援军倒计时摞在 topStack(field) 里 */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const sumCur = (s) => (s.layers || []).reduce((a, l) => a + l.cur, 0);
  const sumMax = (s) => (s.layers || []).reduce((a, l) => a + l.max, 0);
  const LAYER_NAME = (function () { try { if (typeof LAYER !== "undefined") return LAYER; } catch (e) {} return { flesh: "肉体", armor: "装甲", shield: "护盾", sand: "沙尘", spirit: "星灵" }; })();

  // 首领机制的图标（FF14 式的头顶标记）：每种机制一个一眼能分清的形状（色弱也认得出，不只靠颜色）。
  // 画法照 art/style-guide.html 的贴纸图标：一圈墨线 + 白边贴纸 + 机制色的底，48×48 的图形先描粗墨线、再描一层白；
  // 首领读条的那个反过来：机制色的边、深色的底、机制色的图形。
  //   color：机制色；tilt：贴歪的角度；glyph：图形（描边，fill="currentColor" 的是实心块）
  //   what：首领读条时的「会发生什么」；how(x)：「怎么应对」（x：这个机制的展示数据，踩塔有 need）
  const MECH_ICON = {
    // 死刑：破碎的盾（一道裂缝 + 崩出去的一角）
    execution: {
      color: "#e5302a", tilt: -5,
      glyph: `<path d="M24 10.5 L34.5 14.5 V22.5 C34.5 29.5 30 34.5 24 37.5 C18 34.5 13.5 29.5 13.5 22.5 V14.5 Z"/><path d="M25.5 11 L21.5 18.5 L27 23.5 L21.5 29.5 L24 37"/><path fill="currentColor" d="M31.5 9.5 L36 8 L35 12.5 Z"/>`,
      what: "锁定一个人，落下时朝他打重击（可能分好几段），每一段都能协助格挡。",
      how: () => "队友留着附赠动作，到时给他协助格挡：每一段都能挡，挡住的那一段全免。"
    },
    // 分担：四个箭头往中间汇聚（集合）
    share: {
      color: "#f2a516", tilt: 4,
      glyph: `<path fill="currentColor" d="M24 18.5 L19 11.5 H29 Z"/><path fill="currentColor" d="M24 29.5 L19 36.5 H29 Z"/><path fill="currentColor" d="M18.5 24 L11.5 19 V29 Z"/><path fill="currentColor" d="M29.5 24 L36.5 19 V29 Z"/><circle fill="currentColor" cx="24" cy="24" r="2.6"/>`,
      what: "落下时砸向被点名的人所在的区，伤害池由区里所有友方平均分担，不能格挡。",
      how: () => "大家聚到他所在的区一起扛：人越多，每人分到的越少。"
    },
    // 远离：一个圈 + 四个往外的箭头（散开）
    spread: {
      color: "#8a5cf6", tilt: -3,
      glyph: `<circle cx="24" cy="24" r="5"/><path d="M28 20 L34 14 M28.5 14 H34 V19.5"/><path d="M20 20 L14 14 M19.5 14 H14 V19.5"/><path d="M28 28 L34 34 M28.5 34 H34 V28.5"/><path d="M20 28 L14 34 M19.5 34 H14 V28.5"/>`,
      what: "被点名的每个人到时在自己所在的区爆炸一次，同区的友方每次都挨，不能格挡。",
      how: () => "被点名的人分开站，一个区只留一个标记：同一个区有几个标记就炸几次，每次区里的人都挨。"
    },
    // 踩塔：一座塔（城垛 + 塔身 + 地基）
    tower: {
      color: "#14a89a", tilt: 3,
      glyph: `<path d="M16.5 18.5 V11.5 H20 V14 H22.5 V11.5 H25.5 V14 H28 V11.5 H31.5 V18.5 Z"/><path d="M18.5 18.5 V35 H29.5 V18.5"/><path d="M14.5 35.5 H33.5"/><path d="M24 23.5 V28.5"/>`,
      what: "被标记的区要有人站进去踩住：踩住的人各挨一点伤害；人数不够，我方全员挨巨额伤害。不能格挡。",
      how: (x) => Number(x.need) > 0 ? `落下前凑够 ${x.need} 个人站进这个区踩住，别让塔空着。` : "落下前凑够人数站进被标记的区踩住，别让塔空着。"
    },
    // 齐射：三颗子弹扇形排开
    volley: {
      color: "#ff4f9a", tilt: -4,
      glyph: ["rotate(-24 24 44)", "", "rotate(24 24 44)"].map(t => `<path${t ? ` transform="${t}"` : ""} d="M24 13 C26.4 15 27 17.5 27 20 V30 H21 V20 C21 17.5 21.6 15 24 13 Z"/>`).join(""),
      what: "到时朝每个被瞄准的人各开一枪，每一枪都能协助格挡。",
      how: () => "站在一起，留着附赠动作互相协助格挡：每一枪都能挡。"
    }
  };
  // 不认识的机制（以后新加的）：感叹号
  const MECH_OTHER = { color: "#c99a46", tilt: 0, glyph: `<path d="M24 12 V27"/><circle fill="currentColor" cx="24" cy="34" r="2.6"/>`, what: "首领正在读条的机制。", how: () => "看战斗记录里的说明。" };
  // 所有机制都一样（boss-mechanics.js · bossMechPhaseStart）
  const MECH_DELAY = "落下那一刻首领要是失衡，会推迟一回合。";
  const INK = "#0b0806";
  // 点名瞬间的提示：首领机制新点名到一个人（头顶的图标第一次出现），图标从头顶「啪」地弹出来（缩放 + 回弹 + 一圈往外散的光），
  // 同时一声短促的提示音（sfx.js · Sfx.marker：音效关着就不响）。系统开了「减少动态效果」就不弹，声音照音效开关走。
  // 只在新出现那一下：倒计时减少、重画、悬停都不再弹 / 再响；落下以后马上重新点名（倒计时一下子往上跳）算新的一次。
  //   kinds：哪几种图标会弹（mark 被点名的人头上的、zone 区名旁边的塔；首领头上的读条不弹）
  //   jump：倒计时往上跳了至少几回合才算重新点名（首领失衡 / 被挟持推迟一回合只 +1，不算）；0 = 只看新出现
  //   ms：弹出动画多长（毫秒）；easing：每一段的缓动
  //   frames：关键帧（at 第几成时间、scale 缩放、y 往下偏几 px、alpha 不透明度）：从头顶下面冒出来、冲过头放大、回弹一下、落定
  //   burst：同时一圈机制色的光往外散（缩放 from → to，起始不透明度 alpha）
  const MECH_ALERT = {
    kinds: ["mark", "zone"],
    jump: 2,
    ms: 480,
    easing: "ease-out",
    frames: [{ at: 0, scale: 0.2, y: 14, alpha: 0 }, { at: 0.45, scale: 1.34, y: -2, alpha: 1 }, { at: 0.72, scale: 0.9, y: 0, alpha: 1 }, { at: 1, scale: 1, y: 0, alpha: 1 }],
    burst: { from: 0.5, to: 1.9, alpha: 0.9 }
  };

  // 首领机制的倒计时文字（头顶图标的说明、单位的悬停说明、踩塔、横幅共用）
  const when = (x) => x.left > 0 ? `${x.left} 回合后` : `这回合${x.phase === "player" ? "我方" : "敌人"}回合开始时`;
  const markTip = (x) => x.type === "volley"
    ? `${x.by} 的${x.name}：${when(x)}朝这个人开一枪（${x.shot || "atk"}、${x.brk != null ? x.brk : 2} 击破）${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。每一枪都可以协助格挡——站在一起、留着附赠动作互相挡（现在同区还有 ${x.mates || 0} 个被瞄准的队友）。`
    : x.type === "spread"
    ? `${x.by} 的${x.name}：${when(x)}在这个人所在的区爆炸，${x.blast > 0 ? `每次对同区每个友方 ${x.blast}` : "每次波及同区每个友方"}，不能格挡。同一个区有几个标记就炸几次——现在这里有 ${x.stack} 个标记${x.stack > 1 ? `，每人会挨 ${x.stack} 次，快分开站` : "，没有和别人重叠"}。${x.delayed ? "（首领失衡，会推迟一回合）" : ""}`
    : x.type === "share"
    ? `${x.by} 的${x.name}：${when(x)}落下${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。${x.pool > 0 ? `伤害池 ${x.pool}，` : ""}由这个人所在区的所有友方平均分担，不能格挡——大家聚过来一起扛（现在同区 ${x.group} 人${x.pool > 0 ? `，每人约 ${Math.ceil(x.pool / Math.max(1, x.group))}` : ""}）。`
    : `${x.by} 的${x.name}：${when(x)}落下${x.delayed ? "（首领失衡，会推迟一回合）" : ""}。每一段都可以协助格挡。`;
  const phaseText = (x) => `${Number(x.left) > 0 ? "到时" : "这回合"}在${x.phase === "player" ? "我方" : "敌人"}回合开始时落下`;
  const castTip = (x) => `${x.name} → ${x.target || "（无目标）"}：${when(x)}落下`;
  /** 首领机制还有几回合落下：「还有 2 回合」/ 到了就是「本回合落下」 */
  function mechLeft(x) { const n = Math.max(0, Number(x && x.left) || 0); return n > 0 ? `还有 ${n} 回合` : "本回合落下"; }
  /** 悬停说明里的「首领机制」几行：身上的标记 + 首领正在倒数的机制（unit-tip.js · html 的 head.mechs） */
  function mechLines(s) {
    return ((s && s.marks) || []).filter(x => x && x.type).map(x => `${x.name}（${mechLeft(x)}）：${markTip(x)}`)
      .concat(((s && s.casts) || []).filter(x => x && x.type).map(x => `${x.name} → ${x.target || "（无目标）"}（${mechLeft(x)}）：${phaseText(x)}`));
  }
  /** 踩塔的说明（game.js 和 online-battle.js 共用） */
  function towerTip(t) {
    return `${t.by || ""} 的${t.name || ""}：${when(t)}落下${t.delayed ? "（首领失衡，会推迟一回合）" : ""}。至少 ${t.need} 人站在这个区里踩住${t.soak > 0 ? `，每人挨 ${t.soak}` : ""}；没人踩住${t.fail != null ? (t.fail > 0 ? `，我方全员各挨 ${t.fail}` : "，我方全员挨巨额伤害") : "，会触发严重惩罚"}。不能格挡。`;
  }

  /* ---------- 首领机制的图标（FF14 式头顶标记） ---------- */
  /** 还有几回合（0 = 本回合落下） */
  const mechN = (x) => Math.max(0, Math.floor(Number(x && x.left) || 0));
  /** 最后一回合：落下之前我方只剩这一回合能应对（敌人回合开始时落下的：本回合；我方回合开始时落下的：还有 1 回合） */
  const mechLast = (x) => mechN(x) <= 0 || (!!x && x.phase === "player" && mechN(x) <= 1);
  /** 点名对象：「全员（3）」写成「全员」（联机投影把全角括号规范成了半角，两种都认） */
  const targetText = (x) => String((x && x.target) || "").replace(/\s*[（(]\d+[）)]$/, "");
  /** 踩塔的区：「3区、2区」写成「3 区、2 区」 */
  const zonesText = (t) => String(t || "").split(/[、,，]/).map(s => s.trim().replace(/^(\d+)\s*区$/, "$1 区")).filter(Boolean).join("、");
  /** 一个图标认人用的 key（data-mkey）：哪一种图标、什么机制、叫什么、哪个首领放的（重画以后找回同一个图标、认出新出现的点名） */
  const mkeyOf = (x, kind) => [kind, x.type, x.name || "", x.by || ""].join(":");

  /** 贴纸图标的 SVG（48×48）：墨线外圈 + 白边 + 机制色的底，图形先描粗墨线再描白；
   *  首领读条（kind "cast"）反过来：机制色的边、深色的底、机制色的图形 */
  function mechSvg(type, kind) {
    const cfg = MECH_ICON[type] || MECH_OTHER, cast = kind === "cast";
    const glyph = (color, w) => `<g color="${color}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${cfg.glyph}</g>`;
    return `<svg class="mi-svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="23" fill="${INK}"/>` +
      `<circle cx="24" cy="24" r="21" fill="${cast ? cfg.color : "#fff"}"/><circle cx="24" cy="24" r="18" fill="${cast ? "#1a1511" : cfg.color}"/>` +
      glyph(INK, 6.5) + glyph(cast ? cfg.color : "#fff", 2.8) + `</svg>`;
  }
  /** 一个图标的悬停说明（kind：mark 身上的标记 / cast 首领正在读条 / zone 区域上的塔）：
   *  { type, name 机制名字（读条的带上点名对象）, left 还有几回合, when 什么时候落下, what 会发生什么（markTip / castTip / towerTip）, how 怎么应对 } */
  function mechTip(x, kind) {
    const cfg = MECH_ICON[x.type] || MECH_OTHER;
    const t = x.type === "tower" ? zonesText(x.target) : targetText(x);
    const name = kind !== "cast" ? String(x.name || "") : x.type === "tower" ? `${x.name} · ${t || "?"}` : `${x.name} → ${t || "（无目标）"}`;
    const what = kind === "zone" ? towerTip(x) : kind === "cast" ? `${castTip(x)}。${cfg.what}` : markTip(x);
    return { type: x.type, name, left: mechLeft(x), when: phaseText(x), what, how: cfg.how(x) + MECH_DELAY };
  }
  function mechTipHtml(tip) {
    return `<div class="mt-top">${mechSvg(tip.type, "mark")}<b>${esc(tip.name)}</b><em>${esc(tip.left)}</em></div><p class="mt-when">${esc(tip.when)}</p>` +
      `<div class="mt-h">会发生什么</div><p class="mt-what">${esc(tip.what)}</p><div class="mt-h">怎么应对</div><p class="mt-how">${esc(tip.how)}</p>`;
  }
  /** 一个机制图标：贴纸 + 角上的大号数字（还有几回合；本回合落下写「!」），最后一回合脉动（.last）。
   *  机制名字只在悬停说明（data-mtip）和读屏（aria-label）里，图标上不写字。kind "bar"：横幅里的小图标，不带数字和说明 */
  function mechIcon(x, kind) {
    const cfg = MECH_ICON[x.type] || MECH_OTHER, n = mechN(x), bar = kind === "bar";
    const tip = bar ? null : mechTip(x, kind);
    return `<span class="mech-ico k-${kind} t-${esc(x.type)}${mechLast(x) ? " last" : ""}" style="--mc:${cfg.color};--tilt:${cfg.tilt}deg" data-mech="${esc(x.type)}" data-left="${n}"` +
      (bar ? ` aria-hidden="true">` : ` data-mkey="${esc(mkeyOf(x, kind))}" data-mtip="${esc(JSON.stringify(tip))}" role="img" aria-label="${esc(tip.name + "：" + tip.left)}">`) +
      mechSvg(x.type, kind) + (bar ? "" : `<b class="mi-n" aria-hidden="true">${n > 0 ? n : "!"}</b>`) + `</span>`;
  }
  /** 单位头顶的图标：被点名的标记（marks），首领正在读条的机制（casts）；倒下 / 藏起来的单位不画 */
  function mechIconsHtml(s) {
    if (!s || s.dead || s.hidden) return "";
    return ((s.marks || []).filter(x => x && x.type).map(x => mechIcon(x, "mark")).join("") +
      (s.casts || []).filter(x => x && x.type).map(x => mechIcon(x, "cast")).join(""));
  }
  /** 区名旁边的塔：图标（数字 = 还有几回合）+ 几人 / 要几人（人数不够标红） */
  function towerMarkHtml(list) {
    return (list || []).filter(t => t && t.type).map(t => {
      const have = Math.max(0, Number(t.have) || 0), need = Math.max(1, Number(t.need) || 1);
      return `<span class="zt-one">${mechIcon(t, "zone")}<span class="zt-need ${have < need ? "short" : "ok"}">${have}/${need} 人</span></span>`;
    }).join("");
  }

  /* ---------- 图标的悬停说明（触屏点一下） ---------- */
  let tipEl = null, tipFor = null, tipBound = false;
  const touchUI = () => { try { return !!(root.matchMedia && root.matchMedia("(hover: none)").matches); } catch (e) { return false; } };
  function showTip(ico) {
    if (typeof document === "undefined" || !ico || !document.body) return;
    let tip = null;
    try { tip = JSON.parse(ico.dataset.mtip || "null"); } catch (e) {}
    if (!tip) return;
    if (!tipEl) { tipEl = el("div", "mech-tip"); tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
    tipFor = ico;
    tipEl.innerHTML = mechTipHtml(tip);
    tipEl.style.setProperty("--mc", (MECH_ICON[tip.type] || MECH_OTHER).color);
    tipEl.classList.add("show");
    document.documentElement.classList.add("mech-tip-on");   // 单位的悬停说明（unit-tip.js）先让开
    // 放在图标上面，放不下放下面；左右不出屏幕
    const r = ico.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const left = Math.max(8, Math.min(root.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    let top = r.top - h - 8;
    if (top < 8) top = Math.min(root.innerHeight - h - 8, r.bottom + 8);
    tipEl.style.left = left + "px";
    tipEl.style.top = Math.max(8, top) + "px";
  }
  function hideTip() {
    tipFor = null;
    if (tipEl) tipEl.classList.remove("show");
    if (typeof document !== "undefined" && document.documentElement) document.documentElement.classList.remove("mech-tip-on");
  }
  function bindTips() {
    if (tipBound || typeof document === "undefined") return;
    tipBound = true;
    const icoOf = (t) => t && t.closest ? t.closest(".mech-ico[data-mtip]") : null;
    document.addEventListener("mouseover", e => { if (touchUI()) return; const i = icoOf(e.target); if (i && i !== tipFor) showTip(i); });
    // 触屏点一下之后浏览器会补发 mouseout：不当成鼠标离开（不然刚弹出的说明马上又收起），触屏只认点击
    document.addEventListener("mouseout", e => { if (touchUI()) return; const i = icoOf(e.target); if (i && i === tipFor && !i.contains(e.relatedTarget)) hideTip(); });
    // 触屏：点图标弹出 / 收起说明，不当成点了这张卡（免得选中目标）；点别处收起
    document.addEventListener("click", e => {
      const i = icoOf(e.target);
      if (i && touchUI()) { e.stopPropagation(); e.preventDefault(); if (tipFor === i) hideTip(); else showTip(i); return; }
      if (tipFor && !i) hideTip();
    }, true);
    // 区里滚动时收起（浮窗不跟着图标走）
    document.addEventListener("scroll", () => { if (tipFor) hideTip(); }, true);
  }
  /** 换内容（一样就不动：鼠标停着的图标不会被换掉）；悬停说明指着的图标被换掉了，就跟到新的同一个图标上 */
  function setHtml(node, html) {
    if (node._mechHtml === html) return;
    node.innerHTML = html;
    node._mechHtml = html;
    if (tipFor && !tipFor.isConnected) {
      const again = [...node.querySelectorAll(".mech-ico[data-mkey]")].find(n => n.dataset.mkey === tipFor.dataset.mkey);
      if (again) showTip(again); else hideTip();
    }
  }

  /* ---------- 点名瞬间：新出现的点名弹一下 + 提示音（MECH_ALERT） ---------- */
  const nowMs = () => (root.performance && typeof root.performance.now === "function" ? root.performance.now() : Date.now());
  const stillUI = () => { try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } };
  /** 和上次画的比，这次新出现的点名。memo._mechSeen 记着上次每个点名还有几回合（没有 = 第一次画：只记下，不算新出现——
   *  读档、刚连进来、重开画面时已经有的点名不弹）；list：这次画的标记；kind：mark / zone（不在 MECH_ALERT.kinds 里的只记不算）。
   *  新出现 = 上次没有这个点名，或者倒计时一下子往上跳了 MECH_ALERT.jump 回合以上（落下以后马上重新点名）；倒计时减少、一样的重画都不算 */
  function mechFresh(memo, list, kind) {
    if (!memo) return [];
    const marks = (list || []).filter(x => x && x.type), before = memo._mechSeen, seen = new Map();
    marks.forEach(x => seen.set(mkeyOf(x, kind), mechN(x)));
    memo._mechSeen = seen;
    if (!before || !MECH_ALERT.kinds.includes(kind)) return [];
    const jump = Math.max(0, Number(MECH_ALERT.jump) || 0);
    return marks.filter(x => {
      const was = before.get(mkeyOf(x, kind));
      return was == null || (jump > 0 && mechN(x) - was >= jump);
    });
  }
  /** 点名的提示音（sfx.js · Sfx.marker）：音效关着（静音）就不调用；几个人同一刻被点名只响一声（Sfx 里限流） */
  function ping() {
    const S = root.Sfx;
    if (!S || typeof S.marker !== "function" || (typeof S.enabled === "function" && !S.enabled())) return false;
    try { return S.marker() !== false; } catch (e) { return false; }
  }
  /** 一个图标「啪」地弹出来 + 一圈机制色的光往外散（Web Animations：卡片挪区、联机画面整块挂回去都不会重播）。
   *  elapsed：图标被重画换掉了，新的那个接着从这里演完。返回动画（id "mech-pop"） */
  function popIcon(ico, elapsed) {
    if (!ico || typeof ico.animate !== "function") return null;
    const A = MECH_ALERT, from = Math.max(0, Number(elapsed) || 0);
    const pop = ico.animate(A.frames.map(f => ({ offset: f.at, transform: `translateY(${f.y}px) scale(${f.scale})`, opacity: f.alpha, easing: A.easing })), { duration: A.ms, id: "mech-pop" });
    if (from) pop.currentTime = from;
    if (ico.classList) ico.classList.add("pop");
    pop.onfinish = pop.oncancel = () => { if (ico.classList) ico.classList.remove("pop"); };
    if (A.burst && typeof document !== "undefined" && ico.appendChild) {
      const ring = el("i", "mi-burst");
      ring.setAttribute("aria-hidden", "true");
      ico.appendChild(ring);
      const b = ring.animate([{ transform: `scale(${A.burst.from})`, opacity: A.burst.alpha }, { transform: `scale(${A.burst.to})`, opacity: 0 }], { duration: A.ms, easing: A.easing, fill: "forwards", id: "mech-pop-burst" });
      if (from) b.currentTime = from;
      b.onfinish = b.oncancel = () => ring.remove();
    }
    return pop;
  }
  /** 点名瞬间：box（头顶那一排 .u-mechs / 区名旁边的 .ztower-mark）刚按 list 画好。和上次比新出现的点名（mechFresh，
   *  记在 memo 上，默认就是 box）：图标弹一下（减少动态效果时不弹）、响一声（音效关着不响）；还没弹完的图标被重画换掉了，接着弹完。
   *  sim（预演）时什么都不做；quiet 只弹不响（新画面 HD-2D 的铭牌 / 地台：同一个点名旧画面的单位卡已经响过，#283）。返回新出现的点名 */
  function alertNew(box, list, kind, opts, memo) {
    if (opts && opts.sim) return [];
    memo = memo || box;
    if (!memo) return [];
    const fresh = mechFresh(memo, list, kind);
    const t = nowMs(), pops = memo._mechPops || (memo._mechPops = new Map());
    pops.forEach((t0, k) => { if (t - t0 >= MECH_ALERT.ms) pops.delete(k); });
    if (!stillUI()) fresh.forEach(x => pops.set(mkeyOf(x, kind), t));
    if (pops.size && box && box.querySelectorAll) [...box.querySelectorAll(".mech-ico[data-mkey]")].forEach(i => {
      const t0 = pops.get(i.dataset.mkey);
      if (t0 == null || i._mechPop) return;
      try { i._mechPop = popIcon(i, t - t0) || true; } catch (e) { i._mechPop = true; }   // 弹不出来也不能耽误画卡
    });
    if (fresh.length && !(opts && opts.quiet)) ping();
    return fresh;
  }

  /* ---------- 踩塔：区名旁边的图标 + 地面上的一圈 ---------- */
  /** z：.g-zone；list：这个区上的塔（boss-mechanics.js · bossZoneMarks / 联机的 zoneView.towers）。
   *  区名包进一行（.zhead），图标排在区名后面；地面的圈人数不够时是红色虚线，最后一回合圈和图标一起脉动。
   *  新标出来的塔和点名一样弹一下、响一声（opts.sim：预演时不算） */
  function paintTowers(z, list, opts) {
    if (!z) return;
    list = (list || []).filter(t => t && t.type);
    const on = list.length > 0;
    z.classList.toggle("tower", on);
    z.classList.toggle("tower-ready", on && list.some(mechLast));
    z.classList.toggle("tower-short", on && list.some(t => (Number(t.have) || 0) < Math.max(1, Number(t.need) || 1)));
    const lab = z.querySelector(".zlabel");
    let head = lab && lab.parentElement && lab.parentElement.classList.contains("zhead") ? lab.parentElement : null;
    if (on && lab && !head) { head = el("div", "zhead"); lab.parentNode.insertBefore(head, lab); head.appendChild(lab); }
    let mark = head ? head.querySelector(":scope > .ztower-mark") : null;
    if (!on) { if (mark) mark.remove(); mark = null; }
    else if (head) {
      if (!mark) { mark = el("span", "ztower-mark"); head.appendChild(mark); }
      setHtml(mark, towerMarkHtml(list));
    }
    // 记在区上（没有塔的时候图标那一块拿掉了，下次标出来照样认得出是新的）
    alertNew(mark, list, "zone", opts, z);
    let ring = z.querySelector(":scope > .ztower-ring");
    if (!on) { if (ring) ring.remove(); }
    else if (!ring) { ring = el("div", "ztower-ring"); ring.setAttribute("aria-hidden", "true"); z.insertBefore(ring, z.firstChild); }
  }

  /* ---------- 战场正上方：援军倒计时（chain.js）+ 首领机制横幅 ---------- */
  /** 战场正上方的一摞（game.js 把援军倒计时 #g-chain 也放进来，和机制横幅上下排开，不互相盖住） */
  function topStack(field) {
    if (!field || typeof document === "undefined") return null;
    let st = field.querySelector(":scope > .g-topstack");
    if (!st) { st = el("div", "g-topstack"); field.appendChild(st); }
    return st;
  }
  /** 横幅的条目：每个还活着的首领正在读条的机制（快照里的 casts），剩余回合少的排前面（一样多的照原来的顺序） */
  function bannerItems(units) {
    const out = [];
    (units || []).forEach(u => {
      if (!u || u.isPlayer || u.isProp || u.dead || u.hidden) return;
      (u.casts || []).forEach(x => { if (x && x.type) out.push(Object.assign({}, x, { by: u.name || "" })); });
    });
    return out.map((x, i) => ({ x, i })).sort((a, b) => (mechN(a.x) - mechN(b.x)) || (a.i - b.i)).map(o => o.x);
  }
  /** 横幅上的一条：「死刑 → 柯尔特 · 2 回合」「踩塔 · 3 区 · 1 回合」；到了写「本回合落下」 */
  function bannerParts(x) {
    const n = mechN(x), t = x.type === "tower" ? zonesText(x.target) : targetText(x);
    return { head: x.type === "tower" ? `${x.name} · ${t || "?"}` : t ? `${x.name} → ${t}` : String(x.name || ""), n };
  }
  function bannerText(x) { const p = bannerParts(x); return `${p.head} · ${p.n > 0 ? p.n + " 回合" : "本回合落下"}`; }
  function bannerRowHtml(x) {
    const p = bannerParts(x);
    return `<div class="mb-row t-${esc(x.type)}${mechLast(x) ? " last" : ""}" data-mech="${esc(x.type)}" data-left="${p.n}">${mechIcon(x, "bar")}` +
      `<span class="mb-txt">${esc(p.head)} · ${p.n > 0 ? `<b class="mb-n">${p.n}</b> 回合` : "本回合落下"}</span></div>`;
  }
  /** 画横幅（field：战场 .g-field；units：单位快照，game.js · snapUnit / online-battle.js · snapUnit）。返回横幅上的条目 */
  function paintBanner(field, units) {
    if (tipFor && !tipFor.isConnected) hideTip();   // 指着的单位卡已经拿掉了
    const st = topStack(field);
    if (!st) return [];
    let bar = st.querySelector(":scope > .mech-bar");
    if (!bar) { bar = el("div", "mech-bar"); bar.setAttribute("role", "status"); bar.setAttribute("aria-label", "首领机制倒计时"); st.appendChild(bar); }
    const items = bannerItems(units);
    setHtml(bar, items.map(bannerRowHtml).join(""));
    bar.hidden = !items.length;
    fitTop(field);
    return items;
  }
  /** 有机制横幅时，战场顶上留出这一摞的高度（不盖住区名、区里的卡）；没有就照样式表原来的边距。
   *  和上次一样（横幅高度、战场样式、窗口大小都没变，边距也还在）就不动，免得每画一帧都重排 */
  function fitTop(field) {
    if (!field || typeof getComputedStyle !== "function") return;
    const st = field.querySelector(":scope > .g-topstack"), bar = st && st.querySelector(":scope > .mech-bar");
    const want = bar && !bar.hidden ? Math.ceil(st.offsetTop + st.offsetHeight + 6) : 0;
    const key = `${want}|${field.className}|${root.innerWidth}x${root.innerHeight}`;
    if (field._topKey === key && field.style.paddingTop === (field._topPad || "")) return;
    field.style.paddingTop = "";
    let pad = "";
    if (want) { const base = parseFloat(getComputedStyle(field).paddingTop) || 0; if (want > base) pad = want + "px"; }
    field.style.paddingTop = pad;
    field._topKey = key;
    field._topPad = pad;
  }

  function create(s) {
    const wrap = el("div", "unit-wrap");
    wrap.dataset.id = s.id;
    const unit = el("div", "unit " + (s.isProp ? "prop " : "") + (s.isDevice ? "device " : "") + (s.neutral ? "mini neutral " : "") + (s.isPlayer ? "player" : "foe"),
      `<div class="u-head"><span class="u-name"></span><span class="u-lv"></span><span class="u-atk"></span></div>
       <div class="u-hp"></div>
       <div class="u-hpline"><span class="hpn"></span><span class="shpn"></span></div>
       <div class="u-def"></div>
       <div class="u-dur"><div class="u-durbar"></div><div class="u-durline"><span class="durn"></span><span class="durlbl"></span></div></div>
       <div class="u-foot"><div class="u-econ"></div><div class="u-status"></div></div>
       <div class="u-res"></div>
       <span class="u-flag stun">失衡</span><span class="u-flag dying">濒死</span><span class="u-flag downed">倒下</span>`);
    const flash = el("div", "flash");
    const tag = el("div", "pvtag");
    const intents = el("div", "u-intents");   // 名牌上方的行动提示（连击……）：红底白字
    const mechs = el("div", "u-mechs");       // 再上面：首领机制的图标（FF14 式头顶标记）
    wrap.append(mechs, intents, unit, flash, tag);
    bindTips();
    const c = { id: s.id, wrap, unit, flash, tag, intents, mechs, segs: [], pips: [], layersKey: "", prev: null };
    return c;
  }

  /** 卡片顶上写的名字、等级、ATK、种族、个体值。和载具合并的驾驶员（s.vehicle，vehicle.js · vehicleCardOf）画成车：
   *  名字、等级、ATK 按车，不写驾驶员的种族 / 个体值；快照里的 name 等字段照旧是驾驶员自己的 */
  function headOf(s) {
    const v = s && s.vehicle;
    if (v) return { name: v.name || s.name, level: v.level || s.level, atk: v.atk != null ? v.atk : s.atk, race: "", iv: null };
    return { name: s.name, level: s.level, atk: s.atk, race: s.race || "", iv: s.iv || null };
  }

  function update(c, s, opts) {
    const q = (sel) => c.unit.querySelector(sel);
    const head = headOf(s);
    q(".u-name").textContent = head.name;
    // 种族被动（enemies.js · RACE_PERKS）：画成车的驾驶员不写
    const perks = s.vehicle ? [] : (s.racePerks || []);
    q(".u-name").title = head.race ? [`${head.name} · ${head.race}`].concat(perks).join("\n") : "";
    if (c.intents) {
      const list = Array.isArray(s.intents) ? s.intents : [];
      const key = list.join("|");
      if (c.intents.dataset.key !== key) {
        c.intents.dataset.key = key;
        c.intents.innerHTML = list.map(x => `<span class="u-intent">${esc(x)}</span>`).join("");
      }
      c.wrap.classList.toggle("has-intent", list.length > 0);
    }
    // 首领机制：被点名的人头上浮一个图标（死刑 / 分担 / 远离 / 齐射），首领头上是它正在读条的机制；
    // 铭牌上不写机制名字、不画边框，悬停 / 触屏点一下图标才看说明。新点名的那一下弹出来、响一声（第一次画、预演时不算）
    if (c.mechs) {
      setHtml(c.mechs, mechIconsHtml(s));
      c.wrap.classList.toggle("has-mech", !!c.mechs._mechHtml);
      alertNew(c.mechs, s.dead || s.hidden ? [] : s.marks, "mark", opts);
    }
    q(".u-lv").textContent = "Lv" + head.level;
    // 个体值（杂兵、精英）：铭牌上停一下就能看到血量 / ATK 水平
    const ivSign = (n) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n) + "%";
    // 种族（敌人）：和个体值一起放在等级的悬停里，例如「红皮人 · 个体值：血量 +3% · ATK −2%」
    q(".u-lv").title = [head.race, head.iv ? `个体值：血量 ${ivSign(head.iv.hp)} · ATK ${ivSign(head.iv.atk)}` : ""].filter(Boolean).join(" · ") +
      (perks.length ? "\n" + perks.join("\n") : "");   // 种族被动：每条一行
    c.unit.dataset.race = head.race;
    c.unit.dataset.iv = head.iv ? `${head.iv.hp},${head.iv.atk}` : "";
    // 载具（vehicle.js）：和车合并的驾驶员画成车的卡片（外观见 game.css · .unit.vehicle）；下车 / 换人后变回原样
    c.unit.classList.toggle("vehicle", !!s.vehicle);
    c.unit.dataset.vehicle = s.vehicle ? String(s.vehicle.kind || "") : "";
    q(".u-atk").textContent = "ATK " + head.atk;

    // 分层血条：数组 0 是最外层，显示在最右
    const key = s.layers.map(l => l.type + ":" + l.max).join("|");
    const hp = q(".u-hp");
    if (key !== c.layersKey) {
      hp.innerHTML = "";
      c.segs = [];
      c.highBar = null;
      for (let i = s.layers.length - 1; i >= 0; i--) {
        const l = s.layers[i];
        const seg = el("div", "seg t-" + l.type, `<div class="ghost"></div><div class="fill"></div><div class="pv maybe"></div><div class="pv sure"></div><div class="pv heal"></div>`);
        seg.style.flex = `${Math.max(1, l.max)} 1 0`;
        seg.style.minWidth = "10px";
        seg.title = (LAYER_NAME[l.type] || l.type);
        hp.appendChild(seg);
        c.segs[i] = {
          el: seg, fill: seg.querySelector(".fill"), ghost: seg.querySelector(".ghost"),
          sure: seg.querySelector(".pv.sure"), maybe: seg.querySelector(".pv.maybe"), heal: seg.querySelector(".pv.heal")
        };
      }
      c.layersKey = key;
      c.prev = null;
    }
    s.layers.forEach((l, i) => {
      const sg = c.segs[i];
      if (!sg) return;
      const pct = l.max > 0 ? (l.cur / l.max) * 100 : 0;
      sg.fill.style.width = pct + "%";
      sg.ghost.style.width = pct + "%";
      const was = c.prev && c.prev.layers[i] ? c.prev.layers[i].cur : l.cur;
      if (was > 0 && l.cur === 0) { sg.el.classList.remove("crack"); void sg.el.offsetWidth; sg.el.classList.add("crack"); }
    });
    if (!c.highBar || c.highBar.parentElement !== hp) {
      c.highBar = el("div", "u-high");
      hp.appendChild(c.highBar);
    }
    {
      const tot = Math.max(1, sumMax(s));
      const he = Math.max(0, Number(s.highEnergy) || 0);
      c.highBar.style.width = (he > 0 ? Math.min(100, (he / tot) * 100) : 0) + "%";
      c.highBar.style.display = he > 0 ? "" : "none";
      c.highBar.title = he > 0 ? ("高能 " + he + "（血量低于高能值时自爆）") : "";
      c.highBar.classList.toggle("danger", he > 0 && he >= sumCur(s) * 0.75);
    }
    // 被打死的敌人：溢出的伤害显示成负血量（纯画面，给一击的分量感）
    q(".hpn").innerHTML = s.overkill > 0 ? `<b class="neg">−${s.overkill}</b>/${sumMax(s)}` : `<b>${sumCur(s)}</b>/${sumMax(s)}`;
    c.wrap.classList.toggle("overkill", s.overkill > 0);
    q(".shpn").textContent = s.upOnShp ? "起身" : "";

    // 架势
    const defBox = q(".u-def");
    const n = Math.max(s.defMax, s.def);
    // 架势特别高（训练场的木桩等）：一格一个菱形画不下，改写数字
    if (n > 40) {
      defBox.textContent = n >= 100000 ? "架势 ∞" : `架势 ${s.def}/${s.defMax}`;
      c.pips = [];
    } else if (c.pips.length !== n) {
      defBox.innerHTML = "";
      c.pips = [];
      for (let i = 0; i < n; i++) { const p = el("i", "pip"); defBox.appendChild(p); c.pips.push(p); }
    }
    const prevDef = c.prev ? c.prev.def : s.def;
    c.pips.forEach((p, i) => {
      p.classList.toggle("on", i < s.def);
      if (i >= s.def && i < prevDef) { p.classList.remove("shatter"); void p.offsetWidth; p.classList.add("shatter"); }
    });

    // 武器耐久（黄色条）
    const durBox = q(".u-dur");
    if (durBox) {
      const d = s.dur;
      durBox.style.display = d ? "" : "none";
      if (d) {
        // 和血条一样：每点耐久一格，掉了的格子变空；下面一行写数字
        const bar = durBox.querySelector(".u-durbar");
        if (bar.children.length !== d.max) {
          bar.innerHTML = "";
          for (let i = 0; i < d.max; i++) { const g = el("div", "dseg"); g.appendChild(el("div", "fill")); bar.appendChild(g); }
        }
        [...bar.children].forEach((g, i) => g.classList.toggle("on", i < d.cur));
        durBox.querySelector(".durn").innerHTML = `<b>${d.cur}</b>/${d.max}`;
        durBox.querySelector(".durlbl").textContent = "耐久";
        durBox.title = `${d.name} 耐久 ${d.cur}/${d.max}`;
        durBox.classList.toggle("broken", d.cur <= 0);
      }
    }

    // 行动点 / 附赠
    const econ = q(".u-econ");
    {
      let h = "";
      for (let i = 0; i < Math.max(s.apMax, s.ap); i++) h += `<i class="econ-ap${i < s.ap ? " on" : ""}"></i>`;
      for (let i = 0; i < Math.max(s.bonusMax, s.bonus); i++) h += `<i class="econ-bonus${i < s.bonus ? " on" : ""}"></i>`;
      if (s.flying) h += `<span class="chip">飞</span>`;
      if (!window.HudIcons) (s.hung || []).forEach(n => { h += `<span class="chip">${esc(n)}</span>`; });
      econ.innerHTML = h;
      econ.title = `行动点 ${s.ap}/${s.apMax} · 附赠 ${s.bonus}/${s.bonusMax}`;
    }

    // 高能和其他状态放在同一行、同一种样式（之前放在行动点那一行，字体大小不一样）
    const icons = !!window.HudIcons;
    // #52：高能只看高能状态（状态文字里的「高能」）；没有高能状态的高能值显示成蓄能
    const isHigh = !!(s.status && /(^| )高能( |$)/.test(s.status));
    const highChip = icons ? "" : isHigh ? `<span class="chip">高能${s.highEnergy > 0 ? " " + s.highEnergy : ""}</span>`
      : s.highEnergy > 0 ? `<span class="chip">蓄能 ${s.highEnergy}</span>` : "";
    // 有图标的状态画成徽章（hud-icons.js），没有图标的（聚焦、掩护、首领阶段……）还是写字
    // （首领机制不在这一行：画成头顶的图标，见上面的 c.mechs）
    const badges = icons ? (s.badges || []) : [];
    const badgeKey = badges.map(b => b.key + ":" + b.stack).join("|");
    q(".u-status").innerHTML = highChip + (badges.length ? `<span class="hi-badges">${badges.map(b => HudIcons.badge(b.key, b.stack, b.title)).join("")}</span>` : "") + (s.status
      ? s.status.split(" · ").filter(t => t && t !== "无状态" && !/^高能/.test(t) && !(icons && HudIcons.covered(t))).map(t => `<span class="chip">${esc(t)}</span>`).join("")
      : "");
    // 新挂上的、层数变了的徽章：生效一下（放大 + 发光）
    if (icons && c.prev && c.prevBadges !== badgeKey && !(opts && opts.sim)) {
      const before = {};
      (c.prev.badges || []).forEach(b => { before[b.key] = String(b.stack); });
      badges.forEach(b => { if (before[b.key] !== String(b.stack)) HudIcons.procIn(q(".u-status"), b.key); });
    }
    c.prevBadges = badgeKey;
    // 中立生物的迷你名牌：只挂几个小标签（失衡 / 摊平 / 已发现）
    if (s.neutral) q(".u-status").innerHTML = (s.neutralTags || []).map(t => `<span class="chip m-${esc(t.key)}">${esc(t.text)}</span>`).join("");
    // 有耐久条时，资源文字里的「耐久 N」就不重复写了
    const resText = s.dur ? String(s.res || "").split(" · ").filter(t => !/^耐久 /.test(t)).join(" · ") : (s.res || "");
    q(".u-res").textContent = resText;
    q(".u-res").style.display = resText ? "" : "none";

    c.wrap.classList.toggle("stunned", s.stunned && !s.dead);
    c.wrap.classList.toggle("dying", s.dying && !s.dead);
    c.wrap.classList.toggle("dead", s.dead && !s.isPlayer);
    c.wrap.classList.toggle("dead-slow", s.dead && !s.isPlayer && s.killBig);   // 一记重击打死：多停一会儿再慢慢消失
    c.wrap.classList.toggle("downed", s.dead && s.isPlayer);
    c.prev = s;
  }

  const api = {
    create, update, headOf, sumCur, sumMax, mechLeft, mechLines, towerTip,
    MECH_ICON, mechN, mechLast, mechTip, mechTipHtml, mechIcon, mechIconsHtml, towerMarkHtml, paintTowers,
    MECH_ALERT, mechFresh, alertNew,
    topStack, paintBanner, fitTop, bannerItems, bannerText, hideTip
  };
  root.UnitCard = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
