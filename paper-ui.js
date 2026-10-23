/* Antlerscale: Backfire · 战斗画面的「纸片风」界面：联机和单机共用的那一份（#308 定稿，#339 抽出来；设计在 docs/ui-paper/）
 *
 * 纸纹、配色、顶栏胶带、行动顺序吊牌、热敏收据、便利贴……只有这一份，联机玩家（online-paper.js）和单机（game-paper.js）各自拿自己的配置
 * 调 make(配置) 生成一份（标题、本机记住收起的键、哪些面板贴哪种纸不一样，样子完全一样）。
 * 样子都挂在 body.ol-paper 下面（online-paper.css；单机另加 body.g-paper，单机独有的排版在 game-paper.css）。
 * 坚毅生命（shp / shpMax）这里一个字都不碰：画的东西只拿调用的人传进来的公开字段。
 *
 *   纯函数（Node 里能 require，tests/online-paper.test.js、tests/game-paper.test.js）：
 *     BASE                                  共用的配置：文字、配色、天气、纸片美术、收据、便利贴、手机……
 *     make(cfg)                             一份界面：{ PAPER（BASE + cfg 合起来的配置）, isOpen, setOpen, shellHtml, topHtml, tagsHtml, receiptHtml, dress, …下面的共用函数 }
 *     dockAuto(o) / phoneVars()             手机竖屏（#311）：技能栏这一刻该开着还是收着 / 技能栏最多多高
 *     themeOf({ light, night, weather }) / themeVars(theme)          白天 / 夜晚 / 天气 → 面板的配色（CSS 变量）
 *     toolsHtml(items)                      「工具 ▾」下拉里的按钮
 *     texture / grit / roughPath / facetCount / nearest2 / rng / mix   程序生成的纸纹（照 mock.html）
 *     receiptLine / receiptGroups / noteColor                       收据、便利贴
 *   页面：
 *     readMoves(root) / pressMove(root, index, n)   热座栏里每一格现在的按钮 / 点原来那一个
 *     readCam(root) / pressCam(root, i)             新画面的镜头按钮（远 / 中 / 近）现在哪个亮着 / 点第 i 个
 *     coverRects(doc, selectors) / make(…).cover(doc)   浮在战场上、3D 白卡要让开的面板这一刻的矩形（#339；交给 hd2d-field.js · cover） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.PaperUI = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  /* ---------- 共用的配置 ----------
   *   paperClass  纸片画面开着时 body 上的类（联机和单机都加：样子都挂在它下面）
   *   text        顶栏、吊牌、下拉上的字（各家的标题、按钮说明在 make 的配置里补）
   *   cam         镜头按钮读屏念的
   *   tilt        吊牌轮流歪的角度（度；主人：纸片都稍微歪一点 ±0.5～3°）*/
  const BASE = {
    paperClass: "ol-paper",
    text: {
      turn: "第 {0} 回合", day: "第 {0} 天", nightPrefix: "夜 · ",
      tools: "工具", toolsArrow: "▾", toolsHead: "工具（点了就收起）",
      menu: "菜单", menuKey: "Esc",
      order: "行动顺序", swap: "⇅", swapTitle: "延后 / 换位", empty: "空位", vacated: "已挪走",
      party: "我方队伍", you: "你", yourTurn: "轮到你了"
    },
    cam: { label: "镜头：远景 / 中景 / 近景" },
    /* 手机竖屏（#311，让战场更大；电脑上不用）：
     *   media     这么窄算手机竖屏（要和 online-paper.css 里手机那一段的 @media (max-width: 760px) 一样）
     *   dockMax   技能栏展开时最多占屏幕高度的百分之几（写成 --olp-dock-max，online-paper.css 手机上的技能栏用；放不下的是提示栏自己滚）
     * 手机上技能栏没手动点过「技能 ▼ / ▲」时：轮到你（演出播完）展开、不是你就收起（dockAuto）；手动点过的照本机记着的（hd2d-shell.js · SHELL.keys.dock） */
    phone: { media: "(max-width: 760px)", dockMax: 35 },
    /* 战斗记录 = 一长条热敏收据（审查：照 shot-day.jpg 右边那张）：顶上「BACKFIRE / 战斗记录 · 房间码」、一排等号，每个回合「*** 第 N 回合 ***」开头、
     * 每条之间虚线、伤害数字靠右、回合末尾「本回合合计」，底下是锯齿撕口（纸纹 receipt 那一种的 zig）。
     * 每条记录都是 online-view.js · projectLogs 投影过的那一句（谁 · 用了什么 → 目标：N 伤害，击破 M，弹字），这里只是拆开排版，不多给一个数：
     * 合计只把这一回合收据上已经写着的伤害 / 击破 / 治疗加起来（打在坚毅生命上的那几下投影本来就不给数）。
     *   rule / cut  一排等号、合计上面那一排虚线（放不下的截掉）
     *   parts       投影那一句里的几种数：伤害、击破、治疗（认这几种写法；别的弹字原样写在小字里）
     *   phases      「我方回合 / 敌人回合 / 战斗结束……」这种一句话的，写成居中的一行 */
    receipt: {
      brand: "BACKFIRE", head: "战斗记录 · {0}", round: "*** 第 {0} 回合 ***", total: "* 本回合合计 {0} *", empty: "还没有公开记录。",
      rule: "=".repeat(60), cut: "- ".repeat(40).trim(), arrow: " → ", sep: " · ", gm: "主持人",
      parts: { dmg: { re: /^(\d+) 伤害$/, label: "伤害 {0}" }, brk: { re: /^击破 (\d+)$/, label: "击破 {0}" }, heal: { re: /^治疗 (\d+)$/, label: "治疗 {0}" } },
      phases: ["phase", "victory", "defeat", "retreat"]
    },
    /* 小队聊天 = 贴在纸上的便利贴（样稿 shot-night.jpg）：每个发送人固定一种颜色（按 id 算），自己发的是 mine 那一种、靠右。
     * 便利贴上的字一直是深色（ink），正文用清楚的无衬线黑体，只有发送人名字用手写体（online-paper.css） */
    notes: { colors: ["#f4e27a", "#ffb3c7", "#c8f0b0", "#ffd59e", "#e3c8ff"], mine: "#b8e3ff", ink: "#1a1712" },
    tilt: [-3, 2, -1.5, 3, -2, 1.5],
    /* 白天 / 夜晚 / 天气（第 2 步，规格见 docs/ui-paper/README.md）：所有浮着的面板跟着这一刻的光影和天气换色调。
     *   theme.light    光影 → 纸的底色（傍晚和规则表一样算夜里：PartyCards.isNight）
     *   theme.weather  天气 → 纸上加的一层：沙暴、下雨（酸雨 / 雷鸣）、雪、雾（相位的谐波雾带、微光）；别的天气不加
     *   palette        白天：牛皮纸、米白卡片、白色收据；夜晚：深色牛皮纸、黑卡纸，字是浅色（样稿 shot-day.jpg / shot-night.jpg）。
     *                  写成 CSS 变量 --olp-<名字>（kraftInk → --olp-kraft-ink），online-paper.css 只用变量
     *   tintKeys       天气只给这几样底色加色调（字的颜色不跟着染）
     *   weathers       每种天气：tint 往哪个颜色混、mix 混多少（0–1）、edge 纸边那一圈（内阴影：沙暴发黄、雪是一层霜、雨是深色水渍）、
     *                  fade 字往灰里退多少（雾：对比低一点） */
    theme: {
      light: { day: "day", dusk: "night", night: "night" },
      weather: { sand: "sand", acid: "rain", thunder: "rain", snow: "snow", phase: "fog", glow: "fog" }
    },
    /*              board 瓦楞纸板（深一点，喷漆字才看得清）、spray「结束行动」的喷漆、spray2「唤出」没有主属性时的喷漆、
     *              sprayLift「唤出」跟着主属性的颜色时往这个颜色提亮 35%（火、谐波这种深一点的颜色在纸板上也看得清）、sprayEdge 喷漆字的深色描边；
     *              boardyInk 黄纸（「菜单」、选中的索引标签）上的字：夜里也是深色；
     *              receiptMuted 收据上的小字、虚线 */
    palette: {
      day: { kraft: "#c8a46e", kraftInk: "#2a1b0c", paper: "#f3ecdc", paperInk: "#1d160e", card: "#fbf7ee", muted: "#6e5c44",
        tape: "#e8d6a6", tapeInk: "#2a1d0c", board: "#5a3d20", boardInk: "#f6efe1", boardy: "#e9c443", boardyInk: "#2a1b0c", receipt: "#f6f4ee", receiptInk: "#26231d", receiptMuted: "#7b746a",
        spray: "#ffd21a", spray2: "#3fe8d2", sprayLift: "#ffffff", sprayEdge: "rgba(24, 12, 2, .9)",
        on: "#55d6c2", onInk: "#08332c", stamp: "#c8281e", turn: "#0b6b5a", ring: "#e2b320", hl: "rgba(255, 226, 64, .55)" },
      night: { kraft: "#3a2d20", kraftInk: "#efe4cf", paper: "#1d1c21", paperInk: "#eae4d6", card: "#26252b", muted: "#a59c8a",
        tape: "#a09678", tapeInk: "#1c150c", board: "#4a3521", boardInk: "#f6efe1", boardy: "#c9a73a", boardyInk: "#1c1208", receipt: "#1d1c21", receiptInk: "#eae4d6", receiptMuted: "#a39b8d",
        spray: "#ffd21a", spray2: "#3fe8d2", sprayLift: "#ffffff", sprayEdge: "rgba(0, 0, 0, .92)",
        on: "#3fb8a6", onInk: "#04201b", stamp: "#e0473c", turn: "#3fd1b8", ring: "#e2b320", hl: "rgba(255, 226, 64, .35)" }
    },
    tintKeys: ["kraft", "paper", "card", "tape", "boardy", "receipt"],   // 纸板不染：雪天往白里混会变浅，喷漆字就看不清了
    weathers: {
      sand: { tint: "#d9a54a", mix: 0.2, edge: "inset 0 0 18px rgba(206, 150, 60, .7)" },
      rain: { tint: "#5d7390", mix: 0.22, edge: "inset 0 0 16px rgba(28, 42, 66, .5)" },
      snow: { tint: "#e6f1ff", mix: 0.28, edge: "inset 0 0 14px rgba(255, 255, 255, .95)" },
      fog: { tint: "#9b9b9b", mix: 0.3, edge: "inset 0 0 22px rgba(170, 170, 170, .55)", fade: 0.22 }
    },
    /* 纸片美术（第 3 步）：纹理照 docs/ui-paper/mock.html 用程序生成（crumple 揉皱的折面 + 折痕 + 纤维、rough 撕边、grit 斑驳），按尺寸缓存，不放图片文件。
     *   pad        纹理比面板四边多出来的像素（画撕边外面的影子）
     *   shadow     不均匀的影子：两层（偏移、模糊、浓淡）
     *   scale      折面按几分之一的大小算（再放大、糊一点，和样稿一样）；pixels 算的像素最多这么多（大面板自动再缩）
     *   facet      折面数按面积算（审查：大面板的折面被放大成一块块「碎地砖」）：每 area 平方像素一块，至少是这种纸的 facets，最多 max 块（防止太慢）
     *   cache      最多记多少张（同一个尺寸、同一套配色只画一次）
     *   kinds      每种纸：color 用配色表里的哪个颜色、facets 小纸片至少几块折面 / amp / crease / grain 褶皱、jag 边缘毛多少、torn 哪几条边是撕的（更毛）、
     *              corrugated 瓦楞纸的竖纹、flat 按钮那种不画撕边和影子（直接当底图）、zig 底边是锯齿撕口（收据撕下来的那一头：每 step 像素一个齿、齿深 depth）
     *   weather    天气在纸上加的：沙暴撒沙粒（每多少像素一粒）、下雨几块深色水渍、雪边上一层霜、雾蒙一层灰
     *   grit       印章、喷漆的斑驳遮罩：多大、挖几个小洞（只一点点，字一定要清楚）
     * 哪些面板贴哪种纸（targets）各家不一样：在 make 的配置里给 */
    art: {
      pad: 8,
      shadow: [{ x: 2, y: 5, blur: 7, a: 0.42 }, { x: -1, y: 1, blur: 2, a: 0.22 }],
      scale: 0.5, pixels: 90000, cache: 48,
      facet: { area: 1200, max: 320 },
      kinds: {
        tapebar: { color: "tape", facets: 30, amp: 0.05, crease: 0.12, grain: 0.05, jag: 2, torn: { left: 6, right: 6 } },
        kraft: { color: "kraft", facets: 18, amp: 0.09, crease: 0.22, grain: 0.05, jag: 2, torn: { bottom: 5 } },
        dock: { color: "kraft", facets: 26, amp: 0.08, crease: 0.22, grain: 0.05, jag: 3, torn: { top: 6 } },
        paper: { color: "paper", facets: 20, amp: 0.06, crease: 0.18, grain: 0.04, jag: 2 },
        receipt: { color: "receipt", facets: 12, amp: 0.035, crease: 0.09, grain: 0.03, jag: 1, zig: { step: 8, depth: 7 } },
        card: { color: "card", facets: 8, amp: 0.05, crease: 0.15, grain: 0.04, jag: 1.5 },
        tag: { color: "kraft", facets: 6, amp: 0.06, crease: 0.2, grain: 0.05, jag: 1.5 },
        tagon: { color: "on", facets: 6, amp: 0.06, crease: 0.2, grain: 0.05, jag: 1.5 },
        board: { color: "board", facets: 10, amp: 0.1, crease: 0.22, grain: 0.05, corrugated: 7, flat: true },
        boardy: { color: "boardy", facets: 6, amp: 0.06, crease: 0.18, grain: 0.05, flat: true }
      },
      weather: { sand: { grains: 90 }, rain: { stains: 5 }, snow: { frost: 6 }, fog: { veil: 0.12 } },
      grit: { size: 160, holes: 200 },
      targets: []
    }
  };
  const PAPER = BASE;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fill = (t, v) => String(t).replace("{0}", v);

  /* ---------- 收起 / 展开（读写 localStorage 都包 try/catch）---------- */
  /** 本机记着的：key = 本机存的键；没记过、记了认不得的、读不了（隐私模式、被禁用）都按 dflt */
  function readOpen(key, storage, dflt) {
    try {
      const v = storage && key ? storage.getItem(key) : null;
      if (v === "open") return true;
      if (v === "closed") return false;
    } catch (e) { /* 读不了就按默认 */ }
    return !!dflt;
  }
  /** 记住；存不了（隐私模式、存满了）不报错，返回 false */
  function writeOpen(key, open, storage) {
    try {
      if (!storage || !key) return false;
      storage.setItem(key, open ? "open" : "closed");
      return true;
    } catch (e) { return false; }
  }
  /** 手机上技能栏这一刻该开着还是收着（#311）：o = { phone 手机竖屏（PAPER.phone.media）, manual 手动点过「技能 ▼ / ▲」（本机记着的、这次点过的）,
   *  mine 轮到你了, busy 演出还在播 }。返回 true 展开 / false 收起 / null 不动：
   *  电脑上、手动点过的不动（照本机记着的）；手机上不是你就收起；轮到你等演出播完再展开，自己出手的演出播着时也不收（不来回跳） */
  function dockAuto(o) {
    o = o || {};
    if (!o.phone || o.manual) return null;
    if (!o.mine) return false;
    return o.busy ? null : true;
  }
  /** 手机竖屏的排版要的 CSS 变量（写在 body 上）：技能栏展开时最多多高 */
  function phoneVars() {
    return { "--olp-dock-max": PAPER.phone.dockMax + "dvh" };
  }

  /* ---------- 白天 / 夜晚 / 天气的配色（第 2 步）---------- */
  /** o = { light 这一刻的光影（day / dusk / night，没有 = 看 night）, night 游戏时钟是不是夜里, weather 天气 }：{ time: "day" | "night", weather: "sand" | "rain" | "snow" | "fog" | "none" } */
  function themeOf(o) {
    o = o || {};
    const T = PAPER.theme;
    const time = own(T.light, o.light) ? T.light[o.light] : o.night ? "night" : "day";
    return { time, weather: own(T.weather, o.weather) ? T.weather[o.weather] : "none" };
  }
  const own = (obj, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(obj, k);
  const rgbOf = (hex) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return null; const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
  /** 两个颜色（#rrggbb）按 t 混（0 = a，1 = b）；认不得的颜色原样返回 a */
  function mix(a, b, t) {
    const x = rgbOf(a), y = rgbOf(b);
    if (!x || !y) return a;
    return "#" + x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, "0")).join("");
  }
  const kebab = (k) => k.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
  /** 这一套配色写成的 CSS 变量：{ "--olp-kraft": "#…", …, "--olp-edge-fx": 纸边那一圈 }。天气给底色混一点色调、纸边加一圈；雾天字往灰里退（对比低一点） */
  function themeVars(th) {
    th = th || {};
    const base = PAPER.palette[th.time] || PAPER.palette.day, W = PAPER.weathers[th.weather] || null, out = {};
    Object.keys(base).forEach(k => {
      let v = base[k];
      if (W && PAPER.tintKeys.includes(k)) v = mix(v, W.tint, W.mix);
      if (W && W.fade && /Ink$|^muted$/.test(k)) v = mix(v, W.tint, W.fade);
      out["--olp-" + kebab(k)] = v;
    });
    out["--olp-edge-fx"] = W ? W.edge : "inset 0 0 0 transparent";
    out["--olp-note-ink"] = PAPER.notes.ink;   // 便利贴上的字：白天夜里都是深色（便利贴本身不跟着变黑）
    return out;
  }

  /* ---------- 纸片美术（第 3 步）：照 mock.html 程序生成的纹理，按尺寸缓存 ---------- */
  /** 同一个种子总是同一串随机数（Park–Miller，和 mock.html 一样）：同一个尺寸的纸每次画出来一样 */
  function rng(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const hash = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  /** 撕边（mock.html · rough）：w × h 的纸四条边按步长往里随机缩一点，torn 的那几条边更毛、更碎；返回多边形的点 [[x, y]]（左上角是 0, 0） */
  function roughPath(w, h, o, rnd) {
    o = o || {};
    const jag = o.jag == null ? 2 : o.jag, torn = o.torn || {}, p = [];
    const j = (side) => (torn[side] ? torn[side] : jag), st = (side) => (torn[side] ? 4 : 9);
    for (let x = 0; x <= w; x += st("top")) p.push([x, rnd() * j("top")]);
    for (let y = 0; y <= h; y += st("right")) p.push([w - rnd() * j("right"), y]);
    // 收据的锯齿撕口（mock.html · zig）：一高一低交替
    if (o.zig) for (let x = w, i = 0; x >= 0; x -= o.zig.step, i++) p.push([x, h - (i % 2 ? 0 : o.zig.depth) - rnd() * 1.5]);
    else for (let x = w; x >= 0; x -= st("bottom")) p.push([x, h - rnd() * j("bottom")]);
    for (let y = h; y >= 0; y -= st("left")) p.push([rnd() * j("left"), y]);
    return p;
  }
  /** 这种纸 w × h 画几块折面：按面积算（每 PAPER.art.facet.area 平方像素一块），小纸片至少是这种纸的 facets，大纸最多 facet.max 块。
   *  大纸也是细密的褶皱，不会被放大成一块块「碎地砖」 */
  function facetCount(kind, w, h) {
    const K = PAPER.art.kinds[kind], F = PAPER.art.facet;
    if (!K) return 0;
    const n = Math.round((Math.max(0, w) * Math.max(0, h)) / F.area);
    return Math.max(K.facets, Math.min(F.max, n));
  }
  /** 折面（Voronoi）：每个像素离它最近、第二近的点。点按格子分好，从自己那一格一圈一圈往外找，找够了就停（和挨个比一样的结果，大纸也快） */
  function nearest2(pts, sw, sh) {
    const cs = Math.max(4, Math.sqrt((sw * sh) / Math.max(1, pts.length))), gx = Math.max(1, Math.ceil(sw / cs)), gy = Math.max(1, Math.ceil(sh / cs));
    const cells = Array.from({ length: gx * gy }, () => []);
    pts.forEach((p, i) => cells[Math.min(gy - 1, Math.floor(p.y / cs)) * gx + Math.min(gx - 1, Math.floor(p.x / cs))].push(i));
    return (x, y) => {
      const cx = Math.min(gx - 1, Math.floor(x / cs)), cy = Math.min(gy - 1, Math.floor(y / cs));
      let d1 = 1e9, d2 = 1e9, i1 = 0;
      const see = (i) => { const dx = x - pts[i].x, dy = y - pts[i].y, dd = dx * dx + dy * dy; if (dd < d1) { d2 = d1; d1 = dd; i1 = i; } else if (dd < d2) d2 = dd; };
      for (let r = 0; ; r++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (j < 0 || j >= gy) continue;
          const edge = j === cy - r || j === cy + r;
          for (let i = cx - r; i <= cx + r; i += edge ? 1 : 2 * r) { if (i >= 0 && i < gx) cells[j * gx + i].forEach(see); if (!r) break; }
        }
        // 再往外一圈的点至少离 r × 格子大小：第二近的已经比它近，或者格子都看完了，就停
        const near = r * cs;
        if (d2 <= near * near || (r >= cx && r >= cy && r >= gx - 1 - cx && r >= gy - 1 - cy)) break;
      }
      return { d1, d2, i1 };
    };
  }
  const texCache = new Map();
  /** 这一张纸的纹理（data: 地址）：kind = PAPER.art.kinds 里的一种，w × h 面板的大小，theme = { time, weather }。
   *  同一个尺寸、同一套配色只画一次（记 PAPER.art.cache 张）；没有 canvas（Node 里）返回空字符串。
   *  画法（mock.html · crumple）：几块折面（Voronoi）明暗不同、折痕处一道亮一道暗、撒纤维噪点；瓦楞纸加竖纹；撕边外面画两层不均匀的影子；天气再加一层 */
  function texture(doc, kind, w, h, theme) {
    const A = PAPER.art, K = A.kinds[kind];
    w = Math.round(w); h = Math.round(h);
    if (!K || !doc || typeof doc.createElement !== "function" || !(w > 0) || !(h > 0)) return "";
    theme = theme || { time: "day", weather: "none" };
    const vars = themeVars(theme), base = vars["--olp-" + kebab(K.color)] || "#cccccc";
    const key = [kind, w, h, theme.time, theme.weather, base].join("|");
    if (texCache.has(key)) { const v = texCache.get(key); texCache.delete(key); texCache.set(key, v); return v; }
    const pad = K.flat ? 0 : A.pad, W = w + 2 * pad, H = h + 2 * pad, rnd = rng(hash(key));
    const out = doc.createElement("canvas");
    if (!out || typeof out.getContext !== "function") return "";
    out.width = W; out.height = H;
    const g = out.getContext("2d");
    if (!g) return "";
    // 折面：按 scale 算（大面板再缩），放大时糊一点
    let sc = A.scale;
    if (w * h * sc * sc > A.pixels) sc = Math.sqrt(A.pixels / (w * h));
    const sw = Math.max(8, Math.round(w * sc)), sh = Math.max(8, Math.round(h * sc));
    const small = doc.createElement("canvas"); small.width = sw; small.height = sh;
    const sx = small.getContext("2d"), img = sx.createImageData(sw, sh), d = img.data, c0 = rgbOf(base) || [204, 204, 204];
    const pts = Array.from({ length: facetCount(kind, w, h) }, () => ({ x: rnd() * sw, y: rnd() * sh, l: rnd() * 2 - 1 })), near = nearest2(pts, sw, sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const { d1, d2, i1 } = near(x, y);
      const gap = Math.sqrt(d2) - Math.sqrt(d1);
      let s = 1 + pts[i1].l * K.amp;
      if (gap < 1.6) s += (i1 % 2 ? 1 : -1) * K.crease * (1 - gap / 1.6);
      s += (rnd() - 0.5) * K.grain;
      const k = (y * sw + x) * 4;
      d[k] = c0[0] * s; d[k + 1] = c0[1] * s; d[k + 2] = c0[2] * s; d[k + 3] = 255;
    }
    sx.putImageData(img, 0, 0);
    const poly = K.flat ? [[0, 0], [w, 0], [w, h], [0, h]] : roughPath(w, h, K, rnd);
    const path = () => { g.beginPath(); poly.forEach(([x, y], i) => (i ? g.lineTo(x + pad, y + pad) : g.moveTo(x + pad, y + pad))); g.closePath(); };
    // 不均匀的影子：沿着撕边，两层
    if (!K.flat) A.shadow.forEach(s => { g.save(); g.shadowColor = `rgba(0, 0, 0, ${s.a})`; g.shadowBlur = s.blur; g.shadowOffsetX = s.x; g.shadowOffsetY = s.y; g.fillStyle = base; path(); g.fill(); g.restore(); });
    g.save(); path(); g.clip();
    g.filter = "blur(.6px)"; g.drawImage(small, pad, pad, w, h); g.filter = "none";
    // 纤维：细短的线
    for (let i = 0; i < (w * h) / 260; i++) {
      g.strokeStyle = rnd() < 0.5 ? "rgba(0, 0, 0, .06)" : "rgba(255, 255, 255, .08)"; g.lineWidth = 0.7;
      const a = rnd() * 6.28, L = 2 + rnd() * 5, px = pad + rnd() * w, py = pad + rnd() * h;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); g.stroke();
    }
    if (K.corrugated) for (let x = 0; x < w; x += K.corrugated) { g.fillStyle = "rgba(0, 0, 0, .07)"; g.fillRect(pad + x, pad, 3, h); }
    const Wx = A.weather[theme.weather] || {};
    if (Wx.grains) for (let i = 0; i < (w * h) / Wx.grains; i++) { g.fillStyle = `rgba(${150 + rnd() * 60}, ${110 + rnd() * 40}, 60, ${0.2 + rnd() * 0.3})`; g.fillRect(pad + rnd() * w, pad + rnd() * h, 1.3, 1.3); }
    if (Wx.stains) for (let i = 0; i < Wx.stains; i++) {
      const x = pad + rnd() * w, y = pad + rnd() * h, r = 8 + rnd() * Math.min(40, Math.max(w, h) / 6), gr = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      gr.addColorStop(0, "rgba(30, 44, 66, .16)"); gr.addColorStop(0.85, "rgba(30, 44, 66, .1)"); gr.addColorStop(1, "rgba(30, 44, 66, 0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    }
    if (Wx.veil) { g.fillStyle = `rgba(150, 150, 150, ${Wx.veil})`; g.fillRect(pad, pad, w, h); }
    g.restore();
    if (Wx.frost) { g.save(); path(); g.clip(); g.shadowColor = "rgba(255, 255, 255, .95)"; g.shadowBlur = Wx.frost * 2; g.strokeStyle = "rgba(255, 255, 255, .8)"; g.lineWidth = Wx.frost; path(); g.stroke(); g.restore(); }
    let url = "";
    try { url = out.toDataURL(); } catch (e) { url = ""; }
    texCache.set(key, url);
    while (texCache.size > A.cache) texCache.delete(texCache.keys().next().value);
    return url;
  }
  /** 印章、喷漆的斑驳遮罩（mock.html · grit）：一块黑底挖几个小洞；只一点点（PAPER.art.grit），字一定要清楚。每个页面只画一次 */
  let gritUrl = null;
  function grit(doc) {
    if (gritUrl !== null) return gritUrl;
    const G = PAPER.art.grit, c = doc && typeof doc.createElement === "function" ? doc.createElement("canvas") : null, g = c && c.getContext ? c.getContext("2d") : null;
    if (!g) return "";
    c.width = c.height = G.size;
    const rnd = rng(7);
    g.fillStyle = "#000"; g.fillRect(0, 0, G.size, G.size);
    for (let i = 0; i < G.holes; i++) g.clearRect(rnd() * G.size, rnd() * G.size, 0.8 + rnd() * 1.4, 0.8 + rnd() * 1.4);
    try { gritUrl = c.toDataURL(); } catch (e) { gritUrl = ""; }
    return gritUrl;
  }
  /**
   * 给纸片画面里的面板贴上纹理（每次画完、窗口变了叫）：targets = [[选择器, 纸的种类]]，theme = 这一套配色。
   * 每个面板记着上一次贴的（种类 + 尺寸 + 配色）：没变就不动；变了从缓存拿（没有才画）。纹理写成 --olp-tex（online-paper.css 用：
   * 面板挂在 ::before 上、按钮直接当底图），面板上加 data-olp-tex = 种类。看不见的（宽 0）先不贴
   */
  function dressWith(doc, targets, theme) {
    if (!doc || typeof doc.querySelectorAll !== "function") return 0;
    let n = 0;
    (targets || []).forEach(([sel, kind]) => doc.querySelectorAll(sel).forEach(el => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!(w > 0) || !(h > 0)) return;
      // 「tag|tagon」：当前行动的那一格（.olp-tag.on）用后一种
      const k = kind.includes("|") ? kind.split("|")[el.closest && el.closest(".olp-tag.on") ? 1 : 0] : kind, key = [k, w, h, theme && theme.time, theme && theme.weather].join("|");
      if (el.__olpTex === key) return;
      const url = texture(doc, k, w, h, theme);
      if (!url) return;
      el.__olpTex = key; el.dataset.olpTex = k;
      el.style.setProperty("--olp-tex", `url("${url}")`);
      el.style.setProperty("--olp-pad", (PAPER.art.kinds[k].flat ? 0 : PAPER.art.pad) + "px");
      n++;
    }));
    return n;
  }

  /* ---------- 「工具 ▾」下拉 ---------- */
  /** 下拉里的按钮列表：items = 一个个按钮的 HTML（各家用原来那一排按钮同一个画法：同一个 data-…、同一个处理），空的不画 */
  function toolsHtml(items) {
    return (items || []).filter(Boolean).join("");
  }

  /* ---------- 战斗记录：热敏收据 ---------- */
  /** 投影过的一条记录（{ kind, text, turn }）拆成收据上的一行：who 谁（加粗）、what 干了什么、targets [{ name, dmg, brk, heal, words }]（「→ 目标：…」那几段）。
   *  只拆 online-view.js · projectLogs 写出来的那一句，不认得的写法原样放在 what 里 */
  function receiptLine(row) {
    const R = PAPER.receipt, text = String((row && row.text) || ""), kind = (row && row.kind) || "";
    const at = text.indexOf(R.arrow), head = at >= 0 ? text.slice(0, at) : text, tail = at >= 0 ? text.slice(at + R.arrow.length) : "";
    let who = "", what = head;
    const dot = head.indexOf(R.sep);
    if ((kind === "action" || !kind) && dot > 0) { who = head.slice(0, dot); what = head.slice(dot + R.sep.length); }
    else if ((kind === "gm" || kind === "transfer") && head.startsWith(R.gm)) { who = R.gm; what = head.slice(R.gm.length); }
    const targets = tail ? tail.split("；").filter(Boolean).map(seg => {
      const c = seg.indexOf("："), t = { name: c >= 0 ? seg.slice(0, c) : seg, dmg: 0, brk: 0, heal: 0, words: [] };
      (c >= 0 ? seg.slice(c + 1).split("，") : []).forEach(p => {
        p = p.trim(); if (!p) return;
        const k = Object.keys(R.parts).find(key => R.parts[key].re.test(p));
        if (k) t[k] += Number(R.parts[k].re.exec(p)[1]); else t.words.push(p);
      });
      return t;
    }) : [];
    return { kind, who, what, targets };
  }
  /** 一条条记录按回合分好：[{ turn 第几回合（还没开打的那几条是 null）, lines, total: { dmg, brk, heal } }]。
   *  每条带的 turn 换了就是下一回合；没带 turn 的（主持人改物资……）算在当时那一回合里。「第 N 回合开始」那一句不单独占一行（回合分隔已经写了），带着结算的照旧写 */
  function receiptGroups(logs) {
    const out = [];
    let cur = null;
    (logs || []).forEach(row => {
      if (!row || typeof row !== "object") return;
      const t = Number(row.turn != null ? row.turn : row.turnNo);
      const turn = t > 0 ? Math.floor(t) : null;
      if (!cur || (turn != null && turn !== cur.turn)) { cur = { turn: turn != null ? turn : cur ? cur.turn : null, lines: [], total: { dmg: 0, brk: 0, heal: 0 } }; out.push(cur); }
      const line = receiptLine(row);
      if (line.kind === "round" && !line.targets.length) return;
      line.targets.forEach(x => { cur.total.dmg += x.dmg; cur.total.brk += x.brk; cur.total.heal += x.heal; });
      cur.lines.push(line);
    });
    return out.filter(g => g.lines.length || g.turn != null);
  }

  /* ---------- 小队聊天：便利贴 ---------- */
  /** 这条消息贴哪种颜色的便利贴：自己发的是 PAPER.notes.mine；别人按发送人（id，没有就按名字）固定一种 */
  function noteColor(from, mine) {
    const N = PAPER.notes;
    return mine ? N.mine : N.colors[hash(from || "") % N.colors.length];
  }

  /* ---------- 页面：热座栏里原来的按钮、新画面的镜头按钮 ---------- */
  /** 热座栏（#hs-order）里每一格现在的按钮：Map 格子 → [{ hs 哪一种（move / moveStart / moveCancel）, label, aria, title, primary, disabled }] */
  function readMoves(doc) {
    const out = new Map();
    if (!doc || typeof doc.querySelectorAll !== "function") return out;
    doc.querySelectorAll("#hs-order li[data-order-index]").forEach(li => {
      const btns = [...li.querySelectorAll(".hs-moves [data-hs]")];
      if (!btns.length) return;
      out.set(Number(li.dataset.orderIndex), btns.map(b => ({
        hs: b.dataset.hs, label: (b.textContent || "").trim(), aria: b.getAttribute("aria-label") || "", title: b.getAttribute("title") || "",
        primary: b.classList.contains("hs-primary"), disabled: !!b.disabled
      })));
    });
    return out;
  }
  /** 点热座栏里第 index 格的第 n 个按钮（原来那一个：发同样的指令、进同样的换位状态）；找不到 / 灰着返回 false */
  function pressMove(doc, index, n) {
    if (!doc || typeof doc.querySelector !== "function") return false;
    const li = doc.querySelector(`#hs-order li[data-order-index="${Number(index)}"]`);
    const b = li ? li.querySelectorAll(".hs-moves [data-hs]")[Number(n)] : null;
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }
  /** 新画面的镜头按钮（hd2d-field.js 建在 3D 战场里的 .hd2d-cam）：[{ label, on, title }] */
  function readCam(scope) {
    if (!scope || typeof scope.querySelectorAll !== "function") return [];
    return [...scope.querySelectorAll(".hd2d-cam .hd2d-cam-b")].map(b => ({ label: (b.textContent || "").trim(), on: b.classList.contains("on"), title: b.getAttribute("title") || "" }));
  }
  function pressCam(scope, i) {
    const b = scope && typeof scope.querySelectorAll === "function" ? scope.querySelectorAll(".hd2d-cam .hd2d-cam-b")[Number(i)] : null;
    if (!b) return false;
    b.click();
    return true;
  }

  /* ---------- 3D 白卡让开浮在战场上的面板（#339 第 4 步）---------- */
  /** 浮在战场上、取景要让开的面板这一刻在视口里的矩形：selectors = 这一家配置里的 cover（顶栏胶带、吊牌、左上角的队伍、技能栏、右边的抽屉……）；
   *  藏着的、没大小的不算。返回 [{ left, top, right, bottom }]（视口坐标，和 getBoundingClientRect 一样；交给 hd2d-field.js · cover 换成战场里的坐标、算让多少） */
  function coverRects(doc, selectors) {
    const out = [];
    if (!doc || typeof doc.querySelectorAll !== "function") return out;
    (selectors || []).forEach(sel => doc.querySelectorAll(sel).forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) });
    }));
    return out;
  }

  /* ---------- 一份界面（联机 / 单机各拿自己的配置）---------- */
  /**
   * cfg = { bodyClass 这一家在 body 上另加的类, keys / defaults 本机记住收起 / 展开的键和没记过时的默认, text 这一家的字（标题、按钮说明……，盖在 BASE.text 上）,
   *         toolsId「工具 ▾」下拉的 id（顶栏按钮的 aria-controls）, art.targets 哪些面板贴哪种纸, …别的字段原样放进 PAPER }。
   * 返回 { PAPER（BASE 合上 cfg：配色、纸纹这些还是 BASE 里那一份）, isOpen, setOpen, shellHtml, topHtml, tagsHtml, receiptHtml, dress, …共用的函数 }
   */
  function make(cfg) {
    cfg = cfg || {};
    const P = Object.assign({}, BASE, cfg, {
      text: Object.assign({}, BASE.text, cfg.text),
      receipt: Object.assign({}, BASE.receipt, cfg.receipt),
      art: Object.assign({}, BASE.art, cfg.art)
    });

    /** 本机记着的：name = P.keys 里的一项；没记过、记了认不得的、读不了（隐私模式、被禁用）都按 dflt（没给就按 P.defaults） */
    function isOpen(name, storage, dflt) {
      const d = dflt !== undefined ? !!dflt : !!(P.defaults || {})[name];
      return readOpen((P.keys || {})[name], storage, d);
    }
    /** 记住；存不了（隐私模式、存满了）不报错，返回 false */
    function setOpen(name, open, storage) { return writeOpen((P.keys || {})[name], open, storage); }

    /* ---------- 骨架：顶栏、「工具 ▾」下拉、吊牌、提示各占一块，分开重画 ----------
     * 下拉里的按钮列表（.olp-tools-list）只在按钮变了时重画；开 / 收下拉只换 hidden，不重画它们。
     * o.tools = false：这一家的「工具 ▾」下拉不在这里（单机：旧顶栏原地当下拉，game-paper.js） */
    function shellHtml(o) {
      const T = P.text;
      return `<div class="olp-top-host"></div>` +
        (o && o.tools === false ? "" : `<div class="olp-tools olp-sheet" id="${esc(P.toolsId || "olp-tools")}" data-paper="kraft" role="group" aria-label="${esc(T.tools)}" hidden><p class="olp-tools-head">${esc(T.toolsHead)}</p><div class="olp-tools-list"></div></div>`) +
        `<div class="olp-tags-host"></div><p class="olp-note" role="status" hidden></p>`;
    }

    /* ---------- 顶栏 ---------- */
    /**
     * info = { title 标题（不给 = 这一家的 text.title，联机单局 rogue = text.titleRogue）, room 房间码, reconnecting 断线重连中,
     *          sub 标题后面的一小段（单机：遭遇的名字）, turnNo 回合（turnText 给了就写它：单机开打前写「准备中」）, phase { text, enemy } 我方 / 敌人行动,
     *          day / time / period 游戏时间（没有 = 不写）, weather 天气的名字, night 夜晚（天气前面加「夜 · 」）,
     *          cams [{ label, on }] 镜头按钮（新画面的那几个，没有 = 不画）, toolsOpen 「工具」下拉开着没 }
     * 菜单按钮带 data-pause-open（pause-menu.js 接点击、画新消息的红点）
     */
    function topHtml(info) {
      info = info || {};
      const T = P.text;
      const title = info.title != null ? info.title : info.rogue ? T.titleRogue : T.title;
      const room = info.reconnecting ? T.reconnecting : (info.room || "");
      const sub = info.sub ? `<span class="olp-meta olp-sub">${esc(info.sub)}</span>` : "";
      const turn = info.turnText != null ? info.turnText : fill(T.turn, Math.max(1, Math.round(Number(info.turnNo) || 1)));
      const phase = info.phase && info.phase.text ? `<span class="olp-meta olp-phase${info.phase.enemy ? " enemy" : ""}">${esc(info.phase.text)}</span>` : "";
      const time = info.time ? `<span class="olp-meta olp-time">${info.day ? esc(fill(T.day, info.day)) + " · " : ""}<b>${esc(info.time)}</b>${info.period ? " " + esc(info.period) : ""}</span>` : "";
      const weather = info.weather ? `<span class="olp-meta olp-weather">${info.night ? esc(T.nightPrefix) : ""}${esc(info.weather)}</span>` : "";
      const cams = (info.cams || []).length ? `<span class="olp-cam" role="group" aria-label="${esc(P.cam.label)}">${info.cams.map((c, i) =>
        `<button type="button" class="olp-cam-b${c.on ? " on" : ""}" data-olp-cam="${i}" aria-pressed="${c.on ? "true" : "false"}"${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.label)}</button>`).join("")}</span>` : "";
      return `<div class="olp-top olp-sheet" data-paper="tapebar">` +
        `<span class="olp-title">${esc(title)}</span>` +
        (room ? `<span class="olp-room olp-stamp" title="${esc(T.roomTitle)}">${esc(room)}</span>` : "") + sub +
        `<span class="olp-meta olp-turn">${esc(turn)}</span>${phase}${time}${weather}` +
        `<span class="olp-right">${cams}` +
        `<button type="button" class="olp-tools-b olp-sheet" data-paper="board" data-olp="tools" aria-expanded="${info.toolsOpen ? "true" : "false"}" aria-controls="${esc(P.toolsId || "olp-tools")}" title="${esc(T.toolsTitle)}">${esc(T.tools)} ${esc(T.toolsArrow)}</button>` +
        `<button type="button" class="olp-menu-b olp-sheet" data-paper="boardy" data-pause-open="1" title="${esc(T.menuTitle)}">${esc(T.menu)} <kbd>${esc(T.menuKey)}</kbd></button>` +
        `</span></div>`;
    }

    /* ---------- 行动顺序吊牌 ---------- */
    /**
     * slots = [{ index, actor, name, owner 操控者的名字（单机：这一格的状态）, current 正在行动, done 已结束, locked 已用点数（锁定）, vacated 挪走了的空位,
     *            mine 自己的, face 头像的 HTML（hd2d-ui.js · avatarHtml，没有就空着）, pick 点牌子 = 选这个人行动（单机：点队伍栏里同一个人的按钮）,
     *            moves [{ label, aria, primary, disabled }] 热座栏这一格现在的按钮（readMoves）}]
     * o = { open 点开了 ⇅ 的那一格（index）, moving 正在换位（热座栏里有「取消换位」）}
     * 自己能动的格子：平时只露 ⇅，点开才摆出「延后 / 换位」；正在换位时每一格的按钮（换到这里 / 取消换位……）都直接摆出来。
     * 按钮带 data-olp-move="格子 第几个"：点了就点热座栏里原来那一个
     */
    function tagsHtml(slots, o) {
      o = o || {};
      const T = P.text, tilt = P.tilt;
      const list = (slots || []).map((s, k) => {
        const moves = s.moves || [];
        const shown = moves.length && (o.moving || o.open === s.index);
        const btns = shown ? `<span class="olp-moves">${moves.map((m, n) =>
          `<button type="button" class="olp-move olp-sheet${m.primary ? " primary" : ""}" data-paper="card" data-olp-move="${esc(s.index)} ${n}"${m.disabled ? " disabled" : ""}${m.aria ? ` aria-label="${esc(m.aria)}"` : ""}${m.title ? ` title="${esc(m.title)}"` : ""}>${esc(m.label)}</button>`).join("")}</span>` : "";
        const sw = moves.length && !o.moving ? `<button type="button" class="olp-swap" data-olp-swap="${esc(s.index)}" aria-expanded="${o.open === s.index ? "true" : "false"}" title="${esc(T.swapTitle)}" aria-label="${esc((s.name || "") + " " + T.swapTitle)}">${esc(T.swap)}</button>` : "";
        const cls = ["olp-tag", s.current ? "on" : "", s.done || s.locked ? "done" : "", s.vacated ? "vacated" : "", s.mine ? "mine" : ""].filter(Boolean).join(" ");
        const pick = s.pick ? ` data-olp-pick="${esc(s.actor)}"` : "";
        return `<li class="${cls}" data-olp-slot="${esc(s.index)}"${pick} style="--tilt:${tilt[k % tilt.length]}deg">` +
          `<span class="olp-tag-card olp-sheet" data-paper="${s.current ? "tagon" : "tag"}"><span class="olp-hole" aria-hidden="true"></span>${s.face || ""}` +
          `<span class="olp-tag-nm"><b>${esc(s.actor ? s.name || s.actor : T.empty)}</b><small>${esc(s.actor ? s.owner || "" : s.vacated ? T.vacated : "")}</small></span>${sw}</span>${btns}</li>`;
      }).join("");
      return `<ol class="olp-tags" aria-label="${esc(T.order)}">${list}</ol>`;
    }

    /** 收据（.ol-side-log 里的一个个 <li>）：o = { room 房间码 } */
    function receiptHtml(logs, o) {
      o = o || {};
      const R = P.receipt, Pt = R.parts, groups = receiptGroups(logs);
      const nums = x => Object.keys(Pt).filter(k => k !== "dmg" && x[k]).map(k => fill(Pt[k].label, x[k])).concat(x.words || []);
      const small = list => (list.length ? `<small>${esc(list.join(R.sep))}</small>` : "");
      const n = v => `<span class="olp-rc-n">${v ? esc(v) : ""}</span>`;
      const line = (l) => {
        if (R.phases.includes(l.kind) && !l.targets.length) return `<li class="olp-rc-p">${esc(l.what)}</li>`;
        const lead = `${l.who ? `<b>${esc(l.who)}</b> ` : ""}${esc(l.what.trim())}`;
        if (l.targets.length === 1) {
          const t = l.targets[0];
          return `<li class="olp-rc-r"><span class="olp-rc-l">${lead}${esc(R.arrow)}${esc(t.name)}</span>${n(t.dmg)}${small(nums(t))}</li>`;
        }
        return `<li class="olp-rc-r"><span class="olp-rc-l">${lead}</span>${n(0)}` +
          l.targets.map(t => `<span class="olp-rc-t">${esc(R.arrow.trim())} ${esc(t.name)}</span>${n(t.dmg)}${small(nums(t))}`).join("") + `</li>`;
      };
      const total = g => `<li class="olp-rc-cut" aria-hidden="true">${esc(R.cut)}</li><li class="olp-rc-total">${esc(fill(R.total,
        Object.keys(Pt).filter(k => k === "dmg" || g.total[k]).map(k => fill(Pt[k].label, g.total[k])).join(R.sep)))}</li>`;
      const body = groups.map(g => (g.turn != null ? `<li class="olp-rc-sep">${esc(fill(R.round, g.turn))}</li>` : "") + g.lines.map(line).join("") + (g.turn != null ? total(g) : "")).join("");
      return `<li class="olp-rc-h"><b>${esc(R.brand)}</b><span>${esc(fill(R.head, o.room || ""))}</span></li><li class="olp-rc-rule" aria-hidden="true">${esc(R.rule)}</li>` +
        (body || `<li class="olp-rc-empty">${esc(R.empty)}</li>`);
    }

    /** 给这一家的面板贴纸纹：targets 不给 = 这一家配置里的 art.targets */
    function dress(doc, targets, theme) { return dressWith(doc, targets || P.art.targets, theme); }
    /** 这一家浮在战场上、3D 白卡要让开的面板（配置里的 cover）这一刻的矩形 */
    function cover(doc) { return coverRects(doc, P.cover); }

    return Object.assign({}, SHARED, { PAPER: P, isOpen, setOpen, shellHtml, topHtml, tagsHtml, receiptHtml, dress, cover });
  }

  const SHARED = { dockAuto, phoneVars, themeOf, themeVars, mix, rng, roughPath, facetCount, nearest2, texture, grit, toolsHtml,
    receiptLine, receiptGroups, noteColor, readMoves, pressMove, readCam, pressCam, coverRects };
  return Object.assign({ BASE, make, dress: dressWith, readOpen, writeOpen }, SHARED);
});
