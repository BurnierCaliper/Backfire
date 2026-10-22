/* Antlerscale: Backfire · HD-2D 战场 · 接进正式战斗画面（game.html，#261）
 *
 * 战斗顶栏的「新画面」开关（默认关，记在本机 localStorage）开着时，战场那一格（#g-field）里铺一层 3D 战场，盖住旧的区和单位卡：
 *   · 画面数据走联机玩家的那条路：本机的战斗状态先过 online-view.js 的白名单（OnlineView.projectState），演出途中每一下的快照
 *     （game.js · setView 拿到的 snapUnit / snapProp）照联机演出带（projectTape）的做法过 OnlineView.projectUnit，再交给布局（hd2d-layout.js）。
 *     区域 / 场景 / 光影读投影里的 region / scene / light。坚毅生命投影里本来就没有，这里一个字都不碰
 *   · 每次战斗画面刷新（game.js · setView：refreshAll、演出的每一下）跟着重排：血量、架势、状态、站位、天气、场地、间隔；谁在行动跟着 refreshHud
 *   · 点铭牌 = 点单位卡、点地台 = 点区、点危墙 / 桥梁 = 点那根竖条、点空地 = 点战场的空白、悬停铭牌 = 悬停单位卡（悬停说明挂在铭牌上）：
 *     都调 game.js 交出来的入口（GAME.fieldInput），规则判断只在 game.js 里那一份
 *   · 选目标 / 选区的标记（game.js 的 fieldMarks）画成铭牌描边、其余变暗、地台 / 间隔亮框
 *   · 2D 攻击演出（attack-fx / hit-fx / 伤害数字）先简单接上：位置问这里（rectOf / zoneRectOf：铭牌、地台、间隔按这一刻的镜头投影到屏幕上）
 *   · 三段镜头（按钮、滚轮、中景 / 近景左右键换区）、双击特写、铭牌、天气（hd2d-scene.js / hd2d-wfx.js）照原型；技能栏、队伍栏、日志用正式画面现有的
 * 关着时什么都不建，也不加载布局 / 场景 / three.js（开了才按顺序加载），旧画面一模一样。
 *
 *   HD2DField.enabled(storage) / setEnabled(on, storage)   开关（读写 localStorage 都包 try/catch，默认关）
 *   HD2DField.viewState(state, snaps, { OV, itemCatalog })  画面用的那一份（纯函数）
 *   HD2DField.layoutOpts(v, view, portrait)                 交给 HD2DLayout.build 的选项（区域 / 场景 / 光影读投影）
 *   HD2DField.marksOf(marks, layout, actorId)               game.js 的标记 → 场景要的（纯函数）
 *   HD2DField.wire(input)                                   场景的点击 / 悬停 → GAME.fieldInput（纯函数）
 *   HD2DField.gapRect(lens, gap, offset)                    危墙 / 桥梁在屏幕上的矩形（纯函数）
 * 页面（game.js 调）：on() / view(snaps) / actor(id) / marks(m) / rectOf(id) / zoneRectOf(区号)；boot() 在页面加载完自己跑。
 * 纯函数的部分 Node 里能 require（tests/hd2d-field.test.js）。数值、文字都在 FIELD。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./hd2d-layout.js"));
  else root.HD2DField = factory(root, null);
})(typeof self !== "undefined" ? self : this, function (root, L0) {
  "use strict";

  /* ---------- 配置 ----------
   *   storageKey / defaultOn   本机记住开关的键（存 "on" / "off"）、默认（关：主人试过再改默认）
   *   toggleId                 战斗顶栏的开关按钮；label 按钮上写的字（开 / 关 / 正在加载）；text 打不开时的提示（{0} = 浏览器给的原因）
   *   scripts                  开了才按顺序加载的普通脚本（场景模块 import 时就要 HD2DLayout / HD2DCamera，铭牌要 HD2DUI）；scene 最后 import 的场景（ES 模块，
   *                            three.js 走 game.html 的 importmap → vendor/three/）
   *   live                     演出途中每一下的快照盖到投影上的字段（会变的：站位、血量、架势、行动点 / 附赠、倒下 / 濒死 / 失衡、飞 / 潜、藏起来）；
   *                            名字、状态、实际 ATK 这些用这一刻的战斗状态投影出来的
   *   pad                      取景时让开战场上沿的首领机制横幅 / 援军倒计时、下沿的镜头按钮，再多留几像素
   *   drag                     右键拖动（平移镜头）挪过几像素就不算「右键取消」 */
  const FIELD = {
    storageKey: "backfire-hd2d-field",
    defaultOn: false,
    toggleId: "g-hd2d-toggle",
    label: { on: "新画面 开", off: "新画面 关", loading: "新画面 …" },
    text: {
      file: "新画面要用本地服务打开 game.html（在仓库目录运行 python3 -m http.server 8000，再打开 http://localhost:8000/game.html），先用旧画面",
      fail: "新画面打不开（这个浏览器用不了 WebGL 或 ES 模块：{0}），先用旧画面"
    },
    scripts: ["hd2d-layout.js", "hd2d-scene-art.js", "hd2d-scenes-mine.js", "hd2d-scenes-city.js", "hd2d-scenes-desert.js", "hd2d-ui.js", "hd2d-camera.js", "hd2d-fx.js", "hd2d-wfx.js"],
    scene: "hd2d-scene.js",
    live: ["zone", "layers", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "dead", "dying", "stunned", "upOnShp", "hidden", "flying", "submerged"],
    pad: 6,
    drag: 5
  };

  /** 布局（hd2d-layout.js）：Node 里直接 require；页面里开了新画面才加载，用的时候再取 */
  const Lay = () => L0 || root.HD2DLayout;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 开关 ---------- */
  /** 本机记着的开关（"on" / "off"）；没记过、记了认不得的、读不了（隐私模式、被禁用）都按默认（关） */
  function enabled(storage) {
    try {
      const v = storage ? storage.getItem(FIELD.storageKey) : null;
      return v === "on" ? true : v === "off" ? false : FIELD.defaultOn;
    } catch (e) { return FIELD.defaultOn; }
  }
  /** 记住开关；存不了（隐私模式、存满了）不报错，返回 false */
  function setEnabled(on, storage) {
    try {
      if (!storage) return false;
      storage.setItem(FIELD.storageKey, on ? "on" : "off");
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 画面用的数据（纯函数）---------- */
  /**
   * 画面用的那一份，和联机玩家拿到的同一条路：state 过 OnlineView.projectState；
   * snaps = game.js · setView 这一帧的快照（单位、配置物；演出途中是那一下的样子），每个过 OnlineView.projectUnit（联机演出带 projectTape 也是这样投影快照的），
   * 会变的字段（FIELD.live）盖到投影出来的单位上；配置物（id 是 prop:…，和单位卡一样）也当成铭牌画。快照里没有的单位（还没登场 / 已经拿掉）不画；
   * 危墙 / 桥梁（快照里的 isGap）画成地台之间的间隔，不进单位。没给快照 = 投影本身。两个投影都不放行坚毅生命，这里也不碰
   */
  function viewState(state, snaps, deps) {
    const OV = deps && deps.OV;
    if (!state || !OV) return null;
    const pv = OV.projectState(state, { itemCatalog: (deps && deps.itemCatalog) || {} });
    if (!pv || !Array.isArray(snaps)) return pv;
    const base = new Map((pv.units || []).map(u => [u.id, u]));
    const units = [];
    snaps.forEach(s => {
      if (!s || s.isGap) return;
      const p = OV.projectUnit(s);
      if (!p) return;
      const b = base.get(p.id);
      if (!b) { units.push(p); return; }
      const u = Object.assign({}, b);
      FIELD.live.forEach(k => { if (own(p, k)) u[k] = p[k]; });
      units.push(u);
    });
    return Object.assign({}, pv, { units });
  }
  /** 交给 HD2DLayout.build 的选项：画面大小、竖屏；区域 / 场景 / 光影读投影里的（没有 = 布局的兜底，光影按白天） */
  function layoutOpts(v, view, portrait) {
    return { portrait: !!portrait, view, region: (v && v.region) || null, scene: (v && v.scene) || null, theme: (v && v.light) || "day" };
  }
  /**
   * game.js 的标记（fieldMarks：pick 正在选目标、targets 能点的目标 id、hover 鼠标停着的、zones 能移动去的区、hoverZone）→ 场景要的：
   *   targets 场上有铭牌的目标、dim 变暗的（正在选目标时，不是目标、也不是行动的人——和旧画面单位卡的 is-dim 一样）、aim 鼠标停着的目标、
   *   zones / hoverZone 地台亮框、gaps 能打的危墙 / 桥梁（目标 id 是 gap:…）
   */
  function marksOf(m, layout, actorId) {
    m = m || {};
    const on = new Set(((layout && layout.units) || []).map(u => u.id));
    const want = new Set((m.targets || []).map(String));
    const targets = new Set([...want].filter(id => on.has(id)));
    return {
      targets,
      dim: new Set(m.pick ? [...on].filter(id => !want.has(id) && id !== actorId) : []),
      aim: m.hover != null && targets.has(String(m.hover)) ? String(m.hover) : null,
      zones: new Set((m.zones || []).map(Number).filter(Number.isFinite)),
      hoverZone: m.hoverZone != null && Number.isFinite(Number(m.hoverZone)) ? Number(m.hoverZone) : null,
      gaps: new Set([...want].filter(id => id.indexOf("gap:") === 0).map(id => id.slice(4)))
    };
  }
  /** 场景的点击 / 悬停 → game.js 交出来的入口（GAME.fieldInput，旧画面的单位卡、危墙、区也走它们）：
   *  input = { unit(id) 点单位卡, hover(id, on, 挂悬停说明的元素) 悬停单位卡, zone(区号 | null, 点在什么上) 点战场, zoneHover(区号, on) 悬停区 } */
  function wire(input) {
    return {
      onUnitClick: (id) => input.unit(id),
      onGapClick: (key) => input.unit("gap:" + key),
      onZoneClick: (zone) => input.zone(zone, {}),
      onEmptyClick: () => input.zone(null, {}),
      onUnitHover: (id, on, el) => input.hover(id, on, el),
      onZoneHover: (zone, on) => input.zoneHover(zone, on)
    };
  }
  /** 一条间隔（危墙 / 桥梁……，布局的 gaps）在屏幕上的矩形：间隔那一块地（长沿 axis、宽 = 地台宽）的四个角按这一刻的镜头（hd2d-fx.js · lens）投影，取外框；
   *  offset = 战场在页面里的位置（{ left, top }）。和 hd2d-fx.js 的 zoneRect 一样两种写法都给（attack-fx 要中心 + 宽高，HitFx.burst 要 left / top / width / height） */
  function gapRect(lens, g, offset) {
    const L = Lay();
    if (!lens || !g || !L) return null;
    const hx = (g.axis === "z" ? g.width : g.length) / 2, hz = (g.axis === "z" ? g.length : g.width) / 2;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
      const s = L.project(lens, { x: g.x + sx * hx, y: g.topY, z: g.z + sz * hz });
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }));
    if (!Number.isFinite(x0) || !(x1 > x0) || !(y1 > y0)) return null;
    const left = x0 + ((offset && offset.left) || 0), top = y0 + ((offset && offset.top) || 0), w = x1 - x0, h = y1 - y0;
    return { x: left + w / 2, y: top + h / 2, w, h, left, top, width: w, height: h, right: left + w, bottom: top + h };
  }

  /* ---------- 页面 ----------
   * S：开关想开（want）、正在加载（loading）、建好的场景（sc）/ 天气的 2D 层（wfx）/ 攻击演出的适配器（ad）/ 3D 战场那一层（stage）/ 镜头按钮（cam），
   *    最近一次排好的布局（layout）和画面用的那一份（view），game.js 给的快照（snaps）、标记（marks）、行动的人（actorId） */
  const S = { want: false, loading: null, sc: null, wfx: null, ad: null, stage: null, cam: null, camInfo: null, layout: null, view: null, snaps: null, marks: null, actorId: null, insetKey: "" };
  const env = { doc: null, storage: null, load: null, hint: null, title: "" };
  let keysBound = false;
  /** 这个脚本所在的目录（hd2d/）：开了以后从这里加载布局、场景 */
  let BASE = "hd2d/";
  try { const cs = root.document && root.document.currentScript; if (cs && cs.src) BASE = cs.src.replace(/[^/]*$/, ""); } catch (e) {}

  const stateNow = () => (typeof state !== "undefined" ? state : null);                    // 规则的战斗状态（app.js 的全局）
  const catalog = () => (typeof ITEM_CATALOG !== "undefined" ? ITEM_CATALOG : {});         // 投影背包时查道具名（items.js）
  function storageOf() { try { return root.localStorage || null; } catch (e) { return null; } }
  function hint(msg) {
    const G = root.GAME;
    if (G && typeof G.flashHint === "function") G.flashHint(msg);
    if (root.console && root.console.warn) root.console.warn("[HD-2D]", msg);
  }
  function isFile() { try { return !!(root.location && root.location.protocol === "file:"); } catch (e) { return false; } }

  /** 页面加载完（game.js 的 boot 之后）接上开关；本机记着开就直接打开。opts（测试用）：doc / storage / load / hint 换成假的 */
  function boot(opts) {
    opts = opts || {};
    teardown(false);
    S.want = false; S.loading = null;
    env.doc = opts.doc || root.document || null;
    env.storage = opts.storage !== undefined ? opts.storage : storageOf();
    env.load = opts.load || loadModules;
    env.hint = opts.hint || hint;
    if (!env.doc) return;
    const btn = env.doc.getElementById(FIELD.toggleId);
    if (btn) {
      env.title = btn.title || "";
      if (!btn.hd2dBound) { btn.hd2dBound = true; btn.addEventListener("click", toggle); }
    }
    if (env.doc === root.document && !keysBound && typeof root.addEventListener === "function") { keysBound = true; root.addEventListener("keydown", onKey); }
    paintToggle();
    if (enabled(env.storage)) start();
  }
  function toggle() {
    if (S.want) {
      S.want = false;
      setEnabled(false, env.storage);
      teardown(true);
      paintToggle();
      return;
    }
    setEnabled(true, env.storage);
    start();
  }
  /** 打开：加载（只第一次）→ 建场景。加载途中又关掉就不建 */
  function start() {
    S.want = true;
    if (S.sc || S.loading) { paintToggle(); return S.loading; }
    let p;
    try { p = Promise.resolve(env.load()); } catch (e) { p = Promise.reject(e); }
    S.loading = p.then((create) => {
      S.loading = null;
      if (S.want && !S.sc) mount(create);
      paintToggle();
    }).catch((err) => { S.loading = null; fail(err); });
    paintToggle();
    return S.loading;
  }
  /** 打不开（本地文件打不开 ES 模块、没有 WebGL……）：退回旧画面，开关记成关，告诉玩家为什么 */
  function fail(err) {
    S.want = false;
    setEnabled(false, env.storage);
    teardown(true);
    const msg = isFile() ? FIELD.text.file : FIELD.text.fail.replace("{0}", (err && err.message) || String(err));
    paintToggle(msg);
    env.hint(msg);
  }
  function paintToggle(why) {
    const b = env.doc && env.doc.getElementById(FIELD.toggleId);
    if (!b) return;
    b.textContent = S.loading ? FIELD.label.loading : S.want ? FIELD.label.on : FIELD.label.off;
    b.setAttribute("aria-pressed", S.want ? "true" : "false");
    if (why) b.title = env.title + "\n（上次打不开：" + why + "）";
  }

  /** 开了才加载：普通脚本按顺序（加载过的不再加载），最后 import 场景模块，交出 createHd2dScene */
  const loaded = new Set();
  function loadScript(src) {
    return new Promise((ok, bad) => {
      const s = env.doc.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => ok();
      s.onerror = () => bad(new Error("载入失败：" + src));
      env.doc.head.appendChild(s);
    });
  }
  async function loadModules() {
    for (const f of FIELD.scripts) {
      if (loaded.has(f)) continue;
      await loadScript(BASE + f);
      loaded.add(f);
    }
    const mod = await import(BASE + FIELD.scene);
    return mod.createHd2dScene;
  }

  /** 建 3D 战场：铺在 #g-field 里（盖住旧的区和单位卡，旧的照旧排、只是看不见），镜头按钮、天气的 2D 层、攻击演出的适配器一起建 */
  function mount(create) {
    const d = env.doc, G = root.GAME, L = Lay(), HD2DFx = root.HD2DFx, WX = root.HD2DWfx;
    const field = d.getElementById("g-field"), app = d.getElementById("g-app");
    if (!field || !app || !G || !L || !HD2DFx || !WX || typeof create !== "function") throw new Error("缺少战斗画面或模块");
    const stage = d.createElement("div");
    stage.className = "hd2d-field hd2d-theme";
    // 3D 里的点击自己转给 GAME.fieldInput（铭牌、地台、空地），不再冒到旧战场 #g-field 的点击上（不然点一下算两下）
    stage.addEventListener("click", (e) => e.stopPropagation());
    // 右键拖动是平移镜头：拖过的那一下松手时浏览器还会发 contextmenu，别让它冒到 game.js 那里当成「右键取消选目标」；没拖动的右键照旧取消
    let rdown = null;
    stage.addEventListener("pointerdown", (e) => { rdown = e.button === 2 ? { x: e.clientX, y: e.clientY } : null; }, true);
    stage.addEventListener("contextmenu", (e) => {
      if (rdown && Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > FIELD.drag) { e.preventDefault(); e.stopPropagation(); }
      rdown = null;
    });
    field.appendChild(stage);
    S.stage = stage;
    buildCam(stage);
    try {
      S.sc = create(stage, Object.assign({
        onCameraChange: syncCam,
        onPortraitChange: () => { if (S.sc) paint(true); },
        onViewChange: () => { if (S.sc) paint(true); }
      }, G.fieldInput ? wire(G.fieldInput) : {}));
      S.wfx = WX.create(stage, { lens: () => HD2DFx.lens(S.sc.lensNow()), view: () => S.sc.view(), flash: () => S.sc.flash });
      S.ad = HD2DFx.adapter({ lens: () => S.sc.lensNow(), plate: (id) => S.sc.plateOf(id), zone: (id) => S.sc.zoneOf(id), size: (big) => L.plateSize(S.sc.view(), big), offset: () => stage.getBoundingClientRect() });
    } catch (e) { teardown(false); throw e; }
    app.classList.add("hd2d-on");
    paint(true);
    // 旧战场的天气叠加层拿掉（画在新画面上）、行动的人、标记都按现在的再走一遍；演出中先不打断，播完 game.js 自己会刷新
    if (typeof G.refresh === "function" && !G.depth) G.refresh();
  }
  /** 拆掉 3D 战场，旧画面露出来；refresh = 让 game.js 再画一遍旧战场（天气叠加层放回去） */
  function teardown(refresh) {
    if (S.sc) { try { S.sc.dispose(); } catch (e) {} }
    if (S.wfx) { try { S.wfx.dispose(); } catch (e) {} }
    if (S.stage && S.stage.remove) S.stage.remove();
    const hadStage = !!S.stage;
    S.sc = S.wfx = S.ad = S.stage = S.cam = S.camInfo = S.layout = S.view = null;
    S.insetKey = "";
    const app = env.doc && env.doc.getElementById("g-app");
    if (app) app.classList.remove("hd2d-on");
    if (!hadStage) return;
    if (root.UnitTip && root.UnitTip.hide) root.UnitTip.hide();
    const G = root.GAME;
    if (refresh && G && typeof G.refresh === "function" && !G.depth) G.refresh();
  }

  /** 排一次战场（game.js 刷新画面、窗口变了、横幅出来了）：投影 → 布局 → 场景；reset = 镜头回到这一段的默认位置 */
  function paint(reset) {
    const G = root.GAME, L = Lay(), st = stateNow();
    if (!S.sc || !G || !L || !st) return;
    // 战斗画面藏着（切到地图、标题……，战场宽 0）：先不排，回来时画面大小一变场景会叫 onViewChange 重排（快照记着最新的）
    if (!S.stage || !S.stage.clientWidth) return;
    // 和联机发包前一样先同步区域 / 场景 / 光影（光影跟着时钟、场景跟着场上的场地；只是画面的标签，不改结算：world-data.js）
    try { if (typeof root.battleLookSync === "function") root.battleLookSync(); } catch (e) {}
    const snaps = S.snaps || (typeof G.snapAll === "function" ? G.snapAll() : null);
    const v = viewState(st, snaps, { OV: root.OnlineView, itemCatalog: catalog() });
    if (!v) return;
    S.view = v;
    if (insets()) reset = true;
    S.layout = L.build(v, layoutOpts(v, S.sc.view(), S.sc.portrait));
    S.sc.setBattle(S.layout, { weather: v.weather || "none", theme: v.light || "day", actorId: S.actorId });
    if (reset) S.sc.refit();
    S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
    syncWeather();
  }
  /** 天气的 2D 层（正式画面的 weather-fx 压在 3D 上，hd2d-wfx.js）和 3D 沙粒的风：只读投影里的天气 / 风向 / 相位 / 光影；镜头是这个玩家自己的 */
  function syncWeather() {
    if (!S.sc || !S.wfx || !S.view) return;
    const v = S.view, WX = root.HD2DWfx, portrait = !!(S.layout && S.layout.portrait), cam = S.camInfo || {};
    S.sc.setWind(WX.windOf(v.sandDir, portrait));
    S.wfx.sync({
      weather: v.weather || "none", theme: v.light || "day", sandDir: v.sandDir, phaseStep: v.phaseStep, portrait,
      tier: cam.tier || S.sc.tier, close: cam.close != null, zone: cam.zone != null ? cam.zone : S.sc.zone, reduced: !S.sc.motion, layout: S.layout
    });
  }
  /** 取景让开战场上沿的一摞（首领机制横幅 / 援军倒计时，game.js 放在 #g-field 的 .g-topstack 里，照旧露在新画面上面）和下沿的镜头按钮；变了返回 true */
  function insets() {
    const field = S.stage && S.stage.parentNode;
    const top = field && field.querySelector ? field.querySelector(":scope > .g-topstack") : null;
    const t = top && top.offsetHeight > 0 ? top.offsetTop + top.offsetHeight + FIELD.pad : 0;
    const b = S.cam && S.cam.bar ? S.cam.bar.offsetHeight + 2 * FIELD.pad : 0;
    S.sc.setInsets({ top: t, bottom: b });
    const key = t + "|" + b;
    if (key === S.insetKey) return false;
    S.insetKey = key;
    return true;
  }

  /* ---------- 镜头按钮：远 / 中 / 近、看的那个区；中景 / 近景时两边的换区箭头（键盘左右键也行） ---------- */
  function buildCam(stage) {
    const d = env.doc, C = root.HD2DCamera;
    const bar = d.createElement("div");
    bar.className = "hd2d-cam";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "镜头：远景 / 中景 / 近景");
    const tiers = {};
    C.CAMERA.order.forEach(t => {
      const b = d.createElement("button");
      b.type = "button";
      b.className = "hd2d-cam-b";
      b.textContent = C.CAMERA[t].label;
      b.title = C.CAMERA[t].name + "（滚轮也能切：往前滚拉近、往后滚拉远；近景里双击单位看特写）";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => { if (S.sc) S.sc.setTier(t); });
      bar.appendChild(b);
      tiers[t] = b;
    });
    const tag = d.createElement("span");
    tag.className = "hd2d-cam-z";
    bar.appendChild(tag);
    const nav = (dir, cls) => {
      const b = d.createElement("button");
      b.type = "button";
      b.className = "hd2d-zone-nav " + cls;
      b.hidden = true;
      b.addEventListener("click", () => { if (S.sc) S.sc.stepZone(dir); });
      stage.appendChild(b);
      return b;
    };
    stage.appendChild(bar);
    S.cam = { bar, tiers, tag, prev: nav(-1, "prev"), next: nav(1, "next") };
  }
  /** 镜头变了（场景的 onCameraChange）：按钮、看的那个区、换区箭头跟着换；天气的 2D 层按这一段调强弱 */
  function syncCam(info) {
    S.camInfo = info;
    const c = S.cam;
    if (!c) return;
    Object.keys(c.tiers).forEach(t => { const on = info.tier === t; c.tiers[t].classList.toggle("on", on); c.tiers[t].setAttribute("aria-pressed", String(on)); });
    c.tag.textContent = (info.tag || "") + (info.close != null ? " · 特写 " + info.closeName : "");
    const nav = info.tier !== "far";
    [[c.prev, info.prev, "◀ " + info.prevTag], [c.next, info.next, info.nextTag + " ▶"]].forEach(([b, zone, text]) => {
      b.hidden = !nav || zone == null;
      b.textContent = text;
    });
    syncWeather();
  }
  /** 中景 / 近景里左右键换到相邻的区。数字键 1–9 在正式画面是放技能，镜头的远 / 中 / 近用按钮和滚轮。战斗画面藏起来时（宽 0）不管 */
  function onKey(e) {
    if (!S.sc || !S.stage || !S.stage.clientWidth || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    const K = root.HD2DCamera.CAMERA.keys;
    if ((e.key === K.prev || e.key === K.next) && S.sc.tier !== "far") { e.preventDefault(); S.sc.stepZone(e.key === K.prev ? -1 : 1); }
  }

  /* ---------- game.js 调的 ---------- */
  /** 新画面建好了没有（开关开着、模块加载成功）：game.js 的演出位置、天气叠加层看它 */
  function on() { return !!S.sc; }
  /** game.js · setView 每次都叫（refreshAll 的现在的状态、演出的每一下）：开着就跟着重排；快照记着，刚打开时用 */
  function view(snaps) {
    S.snaps = Array.isArray(snaps) ? snaps : null;
    if (!S.sc) return;
    // 旧战场换棋盘时整个清空重建（game.js · syncFieldDom 的 innerHTML = ""）：新画面那一层挂回去
    const field = env.doc && env.doc.getElementById("g-field");
    if (field && S.stage && S.stage.parentNode !== field) field.appendChild(S.stage);
    paint(false);
  }
  /** 谁在行动（game.js · refreshHud：我方回合选中的那个人；敌人回合是 null）：铭牌描金边、脚下的光圈；换了人中景 / 近景跟到他所在的区。
   *  refreshHud 叫得很勤（放技能、取消……），同一个人不再叫场景，不然玩家自己挪去看别的区的镜头会被拽回来 */
  function actor(id) {
    id = id != null ? id : null;
    const changed = id !== S.actorId;
    S.actorId = id;
    if (!S.sc || !changed) return;
    S.sc.setActor(id);
    if (S.layout) S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
  }
  /** 选目标 / 选区的标记（game.js · paintMarks） */
  function marks(m) {
    S.marks = m ? { pick: !!m.pick, targets: (m.targets || []).slice(), hover: m.hover != null ? m.hover : null, zones: (m.zones || []).slice(), hoverZone: m.hoverZone != null ? m.hoverZone : null } : null;
    if (S.sc && S.layout) S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
  }
  /** 2D 攻击演出要的「单位 / 危墙在屏幕上的矩形」（game.js · centerOf）：铭牌按这一刻的镜头投影（hd2d-fx.js 的适配器；被击倒拿掉的单位给最后一次的位置），
   *  危墙 / 桥梁按间隔投影；没开 / 找不到返回 null */
  function rectOf(id) {
    if (!S.sc || !S.ad || id == null) return null;
    const k = String(id);
    if (k.indexOf("gap:") === 0) {
      const g = S.layout && S.layout.gaps.find(x => x.key === k.slice(4));
      return g ? gapRect(root.HD2DFx.lens(S.sc.lensNow()), g, S.stage.getBoundingClientRect()) : null;
    }
    return S.ad.rectOf(k);
  }
  /** 一个区的地台在屏幕上的外框（范围攻击画满整个区：game.js · zoneRectOf） */
  function zoneRectOf(zone) { return S.sc && S.ad ? S.ad.zoneRectOf(Number(zone)) : null; }

  const api = { FIELD, enabled, setEnabled, viewState, layoutOpts, marksOf, wire, gapRect, boot, on, view, actor, marks, rectOf, zoneRectOf };
  // 页面里：等页面加载完（game.js 的 boot 先登记在 DOMContentLoaded 上，先跑）再接开关
  if (!(typeof module === "object" && module.exports) && root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => boot());
    else boot();
  }
  return api;
});
