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
 *   · 2D 攻击演出（attack-fx / hit-fx）的位置问这里（rectOf / zoneRectOf：铭牌、地台、间隔按这一刻的镜头投影到屏幕上）；
 *     伤害 / 击破 / 治疗 / 格挡 / 状态字换成原型的纸片风数字（numbers）、打中那一下的纸片感（paper）、出手时推一下镜头（push / release），
 *     都交给 hd2d-play.js（和原型页同一份），演出倍率、跳过跟着 game.js 的 G.fxClock 走（#283）
 *   · 三段镜头（按钮、滚轮、中景 / 近景左右键换区）、双击特写、铭牌、天气（hd2d-scene.js / hd2d-wfx.js）照原型；日志用正式画面现有的
 *   · 技能栏、队伍栏（#297）：建好时给战斗画面底下的 .g-hud 换上原型那一套外壳（hd2d-shell.js · attach：能收起 / 展开、队伍栏浮在战场左下角），
 *     按钮里面的样子由 game.js / online-battle.js 画的时候换（按钮、点击、快捷键还是它们自己的）；拆掉时换回原样，再叫旧画面画一遍
 *   · 新旧画面之间的云雾转场（#261 追加）：远景再往外拉（滚轮 / 双指）→ 镜头升到正上方 → 白色云雾涌进来盖满 → 切到旧画面（开关拨到关）→ 云雾散开；
 *     旧战场上往前滚反过来（云雾 → 切到新画面 → 云雾散开、镜头从正上方降回远景）。顶栏开关走同一个入口（switchTo）；转场中滚轮、开关都不理；
 *     减少动态效果时直接切。几段在 mistPlan、数值在 MIST
 * 关着时什么都不建，也不加载布局 / 场景 / three.js（开了才按顺序加载），旧画面一模一样（只多了旧战场上往前滚 = 打开新画面，也走云雾转场）。
 * 联机玩家（不是房主 / 主持人，#289）：online-ui.js 进战斗时 attach 自己的战斗画面（online-battle.js），同一个开关（#g-hd2d-toggle 挪过去）、同一套云雾转场、
 *   同一个场景；画面只用他收到的包（packetView：已经过 online-view.js 的白名单，不再碰房主的 state），点铭牌 / 地台走联机现有的回调，
 *   收到行动包时整包交给 hd2d-play.js 播（play）。离开战斗 detach，开关放回单机的顶栏。开关、镜头只在这台电脑上，不发给别人。
 *
 *   HD2DField.enabled(storage) / setEnabled(on, storage)   开关（读写 localStorage 都包 try/catch，默认关）
 *   HD2DField.viewState(state, snaps, { OV, itemCatalog })  画面用的那一份（纯函数）
 *   HD2DField.layoutOpts(v, view, portrait)                 交给 HD2DLayout.build 的选项（区域 / 场景 / 光影读投影）
 *   HD2DField.marksOf(marks, layout, actorId)               game.js 的标记 → 场景要的（纯函数）
 *   HD2DField.wire(input)                                   场景的点击 / 悬停 → GAME.fieldInput（纯函数）
 *   HD2DField.gapRect(lens, gap, offset)                    危墙 / 桥梁在屏幕上的矩形（纯函数）
 *   HD2DField.mistPlan(to, { reduced, live }) / wheelGate(s, deltaY, 秒) / mistPuffs()   云雾转场的几段、战场上的一次滚动、一团团云雾（纯函数）
 *   HD2DField.packetView(pv, { OB, OV })                    联机玩家收到的那一份 → 画面用的（纯函数，#289）
 *   HD2DField.quality(storage) / setQuality(choice, storage) / levelOf(choice, dropped) / nextQuality(choice)   画质（#321，见 FIELD.quality；读写都包 try/catch）
 * 页面（game.js 调）：on() / view(snaps) / actor(id) / marks(m) / rectOf(id) / zoneRectOf(区号)；switchTo("old" | "new") / transition()；boot() 在页面加载完自己跑。
 *   联机玩家（online-ui.js 调，#289）：attach(spec) → 把手 { on, view, actor, marks, play, skip }；detach(spec)。spec 见下面的「画面挂在哪」
 *   攻击演出（#283）：numbers(list) 弹纸片风数字 / paper(id) 打中那一下的纸片感 / unpaper() 画布复原 / push(出手的, 目标) 推镜头（返回要等的毫秒，不推 = 0）/ release() 拉回
 * 纯函数的部分 Node 里能 require（tests/hd2d-field.test.js）。数值、文字都在 FIELD。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root, require("./hd2d-layout.js"));
  else root.HD2DField = factory(root, null);
})(typeof self !== "undefined" ? self : this, function (root, L0) {
  "use strict";

  /* ---------- 配置 ----------
   *   storageKey / defaultOn   本机记住开关的键（存 "on" / "off"）、默认（关：主人试过再改默认）
   *   toggleId                 战斗顶栏的开关按钮；label 按钮上写的字（开 / 关 / 正在加载）；text 打不开时的提示（{0} = 浏览器给的原因）
   *   scripts                  开了才按顺序加载的普通脚本（场景要 HD2DLayout / HD2DCamera / HD2DPace，铭牌要 HD2DUI，技能栏 / 队伍栏的新外壳要 HD2DShell）；scene 最后加载的场景包（也是普通脚本：
   *                            hd2d-scene.js 和 three.js 由 tools/build-hd2d.js 打成一个，加载后挂在 window[sceneGlobal] 上）。
   *                            全用普通脚本，直接双击打开 game.html（file://）也能开新画面——浏览器不让 file:// 加载 ES 模块
   *   live                     演出途中每一下的快照盖到投影上的字段（会变的：站位、血量、架势、行动点 / 附赠、倒下 / 濒死 / 失衡、飞 / 潜、藏起来）；
   *                            名字、状态、实际 ATK 这些用这一刻的战斗状态投影出来的
   *   pad                      取景时让开战场上沿的首领机制横幅 / 援军倒计时、下沿的镜头按钮，再多留几像素
   *   drag                     右键拖动（平移镜头）挪过几像素就不算「右键取消」
   *   quality                  画质（#321：联机玩家那边新画面更卡、操作延迟更大）。暂停页面里那一项（字在 pause-menu.js 的 PAUSE_MENU.items.quality）点一下换下一档，
   *                            单机 / 联机同一个本机设置：storageKey 本机记住的键（存 choices 里的一个）、choices 点一下按这个顺序换、dflt 没记过时用哪个；
   *                            levels 每一档交给场景的（hd2d-scene.js · setQuality：pixelRatio 像素比上限、bokeh 景深、bloom 泛光；低 = 像素比最多 1、不加景深和泛光）；
   *                            auto「自动」：先用 from 那一档，满帧画时一直卡（hd2d-pace.js 量的帧时间，场景叫 onSlow）就降到 to——只降一次，这一次打开页面都用它，不记在本机 */
  const FIELD = {
    storageKey: "backfire-hd2d-field",
    defaultOn: false,
    toggleId: "g-hd2d-toggle",
    label: { on: "新画面 开", off: "新画面 关", loading: "新画面 …" },
    text: {
      fail: "新画面打不开（这个浏览器用不了 WebGL：{0}），先用旧画面"
    },
    scripts: ["hd2d-layout.js", "hd2d-scene-art.js", "hd2d-scenes-mine.js", "hd2d-scenes-city.js", "hd2d-scenes-desert.js", "hd2d-ui.js", "hd2d-shell.js", "hd2d-camera.js", "hd2d-pace.js", "hd2d-fx.js", "hd2d-play.js", "hd2d-wfx.js"],
    scene: "hd2d-scene.bundle.js",
    sceneGlobal: "HD2DSceneBundle",
    live: ["zone", "layers", "def", "defMax", "ap", "apMax", "bonus", "bonusMax", "dead", "dying", "stunned", "upOnShp", "hidden", "flying", "submerged"],
    pad: 6,
    drag: 5,
    quality: {
      storageKey: "backfire-hd2d-quality",
      choices: ["auto", "high", "low"], dflt: "auto",
      levels: { high: { pixelRatio: 2, bokeh: true, bloom: true }, low: { pixelRatio: 1, bokeh: false, bloom: false } },
      auto: { from: "high", to: "low" }
    }
  };
  /* ---------- 新旧画面之间的云雾转场（#261 追加）----------
   * 主人：「在远景情况下如果还继续缩小，就会变回之前的战斗画面，具体是镜头上升到正上方然后一阵白色云雾后切换成之前的战斗画面」。
   * 新 → 旧：镜头升到正上方 → 云雾从四边涌进来盖满 → 切到旧画面（开关拨到关）→ 云雾散开；旧 → 新反过来：云雾涌进来 → 切到新画面（镜头在正上方）→ 云雾散开、镜头同时降回远景。
   *   rise      镜头升到战场正上方往下看：elevation 俯角（度，接近 90；正 90 度镜头朝向算不出来）、dist 离看的那一点多远（× 远景的距离）、secs 升多久、ease 缓动（hd2d-camera.js 的 EASE）
   *   descend   旧 → 新：镜头从正上方（rise 的俯角、距离）降回远景要多久、缓动；和云雾散开同时开始
   *   cover     云雾从四边涌进来、合拢盖满要多久（秒）；overlap = 镜头离升到顶还有多少秒时云雾就开始涌（升和涌接得上，不是升完了停一下再来）
   *   hold      盖满以后至少停多久（秒；这时切画面。旧 → 新还要等新画面建好，第一次打开要加载）；frames = 旧 → 新建好以后至少等浏览器画完几帧云雾才散
   *             （第一次画要编译着色器，慢；不等的话云雾散开时可能露出还没画出来的空画布）
   *   clear     云雾散开要多久（秒）
   *   color / opacity   云雾的颜色（r, g, b）、最浓时的不透明度（柔边、半透明叠上去，不是一块纯白硬切）
   *   puffs / size / spread / push / stagger   几团云；每团多大（× 战场的宽 / 高）；盖满时各团离中心多远（× 战场的半宽 / 半高）；
   *             涌进来之前在外面多远（× 团自己的大小）；一团比一团晚出发多少秒（错开一点，像涌进来的）
   *   wheel     旧画面的战场上往前滚（拉近）转到新画面：一次滚动（两下之间停顿不到 idle 秒算同一次）攒够 step 像素算一下，只算一次；
   *             按行 / 按页给的 deltaY 换成像素 × line / × page（和镜头换段的 hd2d-camera.js · CAMERA.wheel 同一个算法）
   * 系统开了「减少动态效果」时一段都不播：不升镜头、不涌云雾，直接切。转场只是这台机器上的画面，不改战斗状态、不发给联机的其他人 */
  const MIST = {
    rise: { elevation: 88, dist: 1.15, secs: 0.75, ease: "inOutCubic" },
    descend: { secs: 0.9, ease: "inOutCubic" },
    cover: 0.55, overlap: 0.25, hold: 0.15, frames: 2, clear: 0.7,
    color: [255, 255, 255], opacity: 0.97,
    puffs: 9, size: 1.1, spread: 0.38, push: 0.8, stagger: 0.03,
    wheel: { step: 40, idle: 0.22, line: 40, page: 800 }
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

  /* ---------- 画质（#321，数值在 FIELD.quality）---------- */
  /** 本机记着的画质（FIELD.quality.choices 里的一个）；没记过、记了认不得的、读不了都按 dflt（自动） */
  function quality(storage) {
    const Q = FIELD.quality;
    try {
      const v = storage ? storage.getItem(Q.storageKey) : null;
      return Q.choices.includes(v) ? v : Q.dflt;
    } catch (e) { return Q.dflt; }
  }
  /** 记住画质；认不得的、存不了（隐私模式、存满了）不报错，返回 false */
  function setQuality(choice, storage) {
    try {
      if (!storage || !FIELD.quality.choices.includes(choice)) return false;
      storage.setItem(FIELD.quality.storageKey, choice);
      return true;
    } catch (e) { return false; }
  }
  /** 这一刻用哪一档（FIELD.quality.levels 的键）：选了高 / 低就是它；自动 = auto.from，这一次打开页面卡过（dropped）就是 auto.to */
  function levelOf(choice, dropped) {
    const Q = FIELD.quality;
    if (choice === "auto" || !own(Q.levels, choice)) return dropped ? Q.auto.to : Q.auto.from;
    return choice;
  }
  /** 暂停页面里点一下换到的下一档（按 FIELD.quality.choices 的顺序，转一圈） */
  function nextQuality(choice) {
    const c = FIELD.quality.choices, i = c.indexOf(choice);
    return c[(i + 1) % c.length];
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
  /**
   * 联机玩家（#289）画面用的那一份：pv = 他收到的包里的 state（OnlineView.projectState / projectPacket 投影过的；演出途中是 online-ui.js 按演出带换过单位的那份），
   * 已经过白名单，不再投影一遍、也不加字段。配置物（pv.props，拆掉的、藏起来的不画）照单机的样子当成铭牌：online-battle.js · snapProp（旧画面的配置物卡片同一份）
   * 再过 OnlineView.projectUnit（单机 viewState 投影配置物快照也是这样），id 是 prop:…。区域 / 场景 / 光影 / 天气 / 棋盘 / 场地 / 首领机制照用 pv 里的
   */
  function packetView(pv, deps) {
    if (!pv || typeof pv !== "object" || !Array.isArray(pv.units)) return null;
    const OB = deps && deps.OB, OV = deps && deps.OV;
    const props = OB && typeof OB.snapProp === "function" && OV && typeof OV.projectUnit === "function"
      ? (Array.isArray(pv.props) ? pv.props : []).filter(p => p && !p.destroyed && !p.hidden).map(p => OV.projectUnit(OB.snapProp(p))).filter(Boolean) : [];
    return Object.assign({}, pv, { units: pv.units.filter(Boolean).concat(props) });
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

  /* ---------- 新旧画面之间的转场（纯函数）---------- */
  /**
   * 转场要走的几段：to = "old" 新 → 旧 / "new" 旧 → 新；o = { reduced 减少动态效果, live 新画面现在建好了（新 → 旧时才有能升起来的镜头） }。
   * 返回 [{ step, secs }]，一段走完接下一段：
   *   rise   镜头往正上方升（升到最后 MIST.overlap 秒时云雾就开始涌，所以这一段只算到那时）
   *   cover  云雾从四边涌进来盖满
   *   swap   切画面（新 → 旧 = 开关拨到关，拆掉 3D；旧 → 新 = 拨到开，建好 3D、镜头摆在正上方）：盖满以后至少停 hold 秒，旧 → 新还要等新画面建好
   *   clear  云雾散开（旧 → 新：镜头同时从正上方降回远景，按两个里长的那个算）
   * 减少动态效果，或者新 → 旧时 3D 还没建好（还在加载 / 打不开，看到的就是旧画面）：只有 0 秒的 swap，直接切
   */
  function mistPlan(to, o) {
    o = o || {};
    const M = MIST;
    if (o.reduced || (to === "old" && !o.live)) return [{ step: "swap", secs: 0 }];
    const plan = to === "old" ? [{ step: "rise", secs: Math.max(0, M.rise.secs - M.overlap) }] : [];
    return plan.concat([
      { step: "cover", secs: M.cover },
      { step: "swap", secs: M.hold },
      { step: "clear", secs: to === "new" ? Math.max(M.clear, M.descend.secs) : M.clear }
    ]);
  }
  /** 战场上的一下滚轮：s = 上一次返回的（第一次给 null），deltaY 像素（往前滚是负的），now 秒。
   *  一次滚动（两下之间停顿不到 MIST.wheel.idle 秒）攒够 step 像素算一下、只算一次：往前 1（拉近）/ 往后 −1（拉远）。
   *  state.ate = 这一次滚动已经换过一次画面（剩下的都不理：触控板的惯性不会接着把新画面的镜头往里推）；换了一次新的滚动就清掉。返回 { step, state } */
  function wheelGate(s, deltaY, now) {
    const W = MIST.wheel, fresh = !s || !(now - s.last <= W.idle);
    const st = { acc: (fresh ? 0 : s.acc) + (Number(deltaY) || 0), last: now, done: !fresh && !!s.done, ate: !fresh && !!s.ate };
    let step = 0;
    if (!st.done && Math.abs(st.acc) >= W.step) { step = st.acc < 0 ? 1 : -1; st.done = true; }
    return { step, state: st };
  }
  /** 滚轮事件的 deltaY 换成像素（有的浏览器按行、按页给） */
  function wheelPixels(e) {
    const W = MIST.wheel;
    return (Number(e && e.deltaY) || 0) * (e && e.deltaMode === 1 ? W.line : e && e.deltaMode === 2 ? W.page : 1);
  }
  /** 云雾一团一团的样子（CSS 变量）：n 团均匀绕着战场一圈，盖满时的中心 x / y（%，离中心 spread × 半宽 / 半高）、大小 w / h（%，× 战场的宽 / 高），
   *  涌进来之前往外挪 dx / dy（%，× 团自己的大小，沿着它那一圈的方向）、晚出发 d 秒。纯函数：只看 MIST */
  function mistPuffs() {
    const M = MIST, n = Math.max(1, Math.round(M.puffs)), out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n, c = Math.cos(a), s = Math.sin(a);
      const big = i % 2 ? 0.85 : 1;                  // 大小错开一点，不是一圈一样的圆
      out.push({
        x: +(50 + 50 * M.spread * c).toFixed(2), y: +(50 + 50 * M.spread * s).toFixed(2),
        w: +(100 * M.size * big).toFixed(2), h: +(100 * M.size * big).toFixed(2),
        dx: +(100 * M.push * c).toFixed(2), dy: +(100 * M.push * s).toFixed(2), d: +((i % 3) * M.stagger).toFixed(3)
      });
    }
    return out;
  }

  /* ---------- 页面 ----------
   * S：开关想开（want）、正在加载（loading）、建好的场景（sc）/ 天气的 2D 层（wfx）/ 攻击演出的适配器（ad）/ 3D 战场那一层（stage）/ 镜头按钮（cam），
   *    出手时推镜头（push：hd2d-play.js · HD2DPlay.camera；pushed = 推着还没拉回），
   *    最近一次排好的布局（layout）和画面用的那一份（view），game.js 给的快照（snaps）、标记（marks）、行动的人（actorId），
   *    broken = 这一次打开页面新画面打不开过（旧战场上往前滚就不再去开它，要开点开关——开关会说为什么打不开）
   * T：新旧画面之间的转场——busy 正在转（滚轮、开关都不理）、to 转去哪边（"old" / "new"）、step 走到哪一段、plan 剩下的几段（mistPlan）、mist 云雾那一层、
   *    pre 旧 → 新时云雾一涌进来就开始加载的、gen 第几次（页面重新 boot 过，旧的计时器到了也不算）、gesture 战场上这一次滚动（wheelGate） */
  const S = { want: false, loading: null, create: null, sc: null, wfx: null, ad: null, push: null, pushed: false, stage: null, cam: null, camInfo: null, layout: null, view: null, snaps: null, marks: null, actorId: null, insetKey: "", broken: false, hud: null };
  const T = { busy: false, to: null, step: null, plan: null, mist: null, pre: null, gen: 0, gesture: null };
  const env = { doc: null, storage: null, load: null, hint: null, title: "", reduced: null, wait: null, now: null, toggle: null, home: null };
  /** 画质（#321）：choice 这一次打开页面在暂停页面里选过的（存不了也照它；null = 照本机记着的）、dropped「自动」一直卡、已经降过一档（这一次打开页面都用低的） */
  const QS = { choice: null, dropped: false };
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
  /** 系统的「减少动态效果」（和场景、weather-fx.js 看的是同一个设置） */
  function reducedMotion() { try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  /* ---------- 画面挂在哪（#289）----------
   * 默认挂在单机的战斗画面（SOLO：game.html 的 #g-app / #g-field；数据 = 本机的战斗状态过白名单，点选交给 GAME.fieldInput，演出的钟 = GAME.fxClock）。
   * 联机玩家（不是房主 / 主持人）进了战斗，online-ui.js 用 attach(spec) 换成他自己的战斗画面（online-battle.js 的 .ol-battle），spec：
   *   field()   3D 战场、云雾铺在哪一格（.ol-battle 的战场）          app()   加 .hd2d-on 的那一层（旧的区和单位卡看不见、点不到）
   *   view()    画面用的那一份：他收到的包（packetView，已经投影过）   input   { unit(id), hover(id, on, 元素), zone(区号 | null), zoneHover(区号, on) }：旧战场同样的回调
   *   clock()   演出倍率（1 正常、0.5 两倍速、0 跳过）                 refresh()  让旧画面再画一遍（拆掉 3D 时；技能栏、队伍栏也跟着换回旧的样子）
   *   hint(msg) 打不开时告诉玩家                                      slot()  顶栏开关（#g-hd2d-toggle）挪到哪（同一个按钮、同一个入口 switchTo）
   *   hud()     技能栏、队伍栏所在的 .g-hud（#297：开着新画面时换上 hd2d-shell.js 的新外壳）；不给 = app() 里的那一个
   * 只读 spec 给的，不碰 GAME / 规则的 state。下面 host.input() 给的是接好的场景回调（wire） */
  const hudIn = (app) => (app && typeof app.querySelector === "function" ? app.querySelector(".g-hud") : null);
  const SOLO = {
    field: () => (env.doc ? env.doc.getElementById("g-field") : null),
    app: () => (env.doc ? env.doc.getElementById("g-app") : null),
    hud: () => hudIn(SOLO.app()),
    view: () => soloView(),
    input: () => { const G = root.GAME; return G && G.fieldInput ? wire(G.fieldInput) : null; },
    clock: () => (root.GAME && typeof root.GAME.fxClock === "function" ? root.GAME.fxClock : null),
    refresh() { const G = root.GAME; if (G && typeof G.refresh === "function" && !G.depth) G.refresh(); },
    hint: null, slot: null
  };
  let host = SOLO;

  /** 页面加载完（game.js 的 boot 之后）接上开关、战场上的滚轮、暂停页面里的「画质」（#321）；本机记着开就直接打开（刚打开页面，不播转场）。
   *  opts（测试用）：doc / storage / load / hint 换成假的，reduced()（减少动态效果）/ wait(秒, fn)（计时器）/ now()（秒）/ pauseMenu（暂停页面）也能换 */
  function boot(opts) {
    opts = opts || {};
    stopMist();
    teardown(false);
    homeToggle();
    host = SOLO;
    S.want = false; S.loading = null; S.broken = false;
    T.gesture = null;
    QS.choice = null; QS.dropped = false;
    env.doc = opts.doc || root.document || null;
    env.storage = opts.storage !== undefined ? opts.storage : storageOf();
    env.load = opts.load || loadModules;
    env.hint = opts.hint || hint;
    env.reduced = opts.reduced || reducedMotion;
    env.wait = opts.wait || ((secs, fn) => root.setTimeout(fn, Math.max(0, secs) * 1000));
    env.now = opts.now || (() => (root.performance && root.performance.now ? root.performance.now() : Date.now()) / 1000);
    if (!env.doc) return;
    const btn = env.doc.getElementById(FIELD.toggleId);
    env.toggle = btn || null;
    if (btn) {
      env.title = btn.title || "";
      if (!btn.hd2dBound) { btn.hd2dBound = true; btn.addEventListener("click", toggle); }
    }
    // 战场上的滚轮在捕获阶段先过这里（比新画面场景自己的滚轮先看到）：转场中不理、旧画面往前滚转到新画面
    bindWheel(env.doc.getElementById("g-field"));
    if (env.doc === root.document && !keysBound && typeof root.addEventListener === "function") { keysBound = true; root.addEventListener("keydown", onKey); }
    registerQuality(opts.pauseMenu || root.PauseMenu);
    paintToggle();
    if (enabled(env.storage)) start();
  }
  function bindWheel(field) {
    if (field && !field.hd2dWheel) { field.hd2dWheel = true; field.addEventListener("wheel", onFieldWheel, { capture: true, passive: false }); }
  }
  /** 顶栏开关：和滚轮走同一个入口（switchTo）——开着就转回旧画面、关着就转到新画面；转场中点了不理 */
  function toggle() { switchTo(S.want ? "old" : "new"); }
  /** 打开：加载（只第一次）→ 建场景。加载途中又关掉就不建。pre = 已经在加载的（转场：云雾一涌进来就开始加载） */
  function start(pre) {
    S.want = true;
    if (S.sc || S.loading) { paintToggle(); return S.loading; }
    const p = pre || loadNow();
    S.loading = p.then((create) => {
      S.loading = null;
      S.create = create;           // 换地方挂（联机玩家 attach / detach）时直接再建，不再加载
      if (S.want && !S.sc) mount(create);
      paintToggle();
    }).catch((err) => { S.loading = null; fail(err); });
    paintToggle();
    return S.loading;
  }
  /** 开始加载（hd2d-field.js · loadModules，加载过的不再加载）；同步出错也给一个 reject 的 Promise */
  function loadNow() { try { return Promise.resolve(env.load()); } catch (e) { return Promise.reject(e); } }
  /** 打不开（没有 WebGL……）：退回旧画面，开关记成关，告诉玩家为什么 */
  function fail(err) {
    S.want = false;
    S.broken = true;
    setEnabled(false, env.storage);
    teardown(true);
    const msg = FIELD.text.fail.replace("{0}", (err && err.message) || String(err));
    paintToggle(msg);
    (host.hint || env.hint)(msg);
  }
  function paintToggle(why) {
    const b = (env.doc && env.doc.getElementById(FIELD.toggleId)) || env.toggle;
    if (!b) return;
    b.textContent = S.loading ? FIELD.label.loading : S.want ? FIELD.label.on : FIELD.label.off;
    b.setAttribute("aria-pressed", S.want ? "true" : "false");
    if (why) b.title = env.title + "\n（上次打不开：" + why + "）";
  }

  /* ---------- 新旧画面之间的云雾转场（#261 追加；几段、数值在 mistPlan / MIST）---------- */
  /** 新旧画面换一下：顶栏开关、新画面远景再往外拉（场景的 onZoomOut）、旧战场上往前滚，都走这一个入口。
   *  to = "old" / "new"；正在转场、已经是那边了：不理，返回 false。减少动态效果（或者 3D 还没建好，没有能升起来的镜头）时直接切；
   *  不然按 mistPlan 一段一段走。只是这台机器上的画面：不碰战斗状态，开关照旧记在本机，不发给联机的其他人 */
  function switchTo(to) {
    if (T.busy || !env.doc || (to === "new") === S.want) return false;
    const plan = mistPlan(to, { reduced: env.reduced(), live: !!S.sc });
    if (plan.length === 1 && !(plan[0].secs > 0)) { swapNow(to); return true; }
    T.busy = true; T.to = to; T.plan = plan.slice(); T.gen++;
    T.mist = mistLayer();      // 先铺上（还透明）：转场中点不到下面半透明的东西
    stepMist(T.gen);
    return true;
  }
  /** 切画面（直接切，或者转场走到云雾最浓的那一下）：新 → 旧 = 开关记成关、拆掉 3D、旧画面露出来；旧 → 新 = 记成开、加载（只第一次）、建好 3D。
   *  返回 Promise：旧 → 新建好或者打不开（退回旧画面、开关记成关、提示为什么）以后 resolve。pre = 已经在加载的 */
  function swapNow(to, pre) {
    if (to === "old") {
      S.want = false;
      setEnabled(false, env.storage);
      teardown(true);
      paintToggle();
      return Promise.resolve();
    }
    setEnabled(true, env.storage);
    return Promise.resolve(start(pre));
  }
  /** 走下一段（gen 对不上 = 页面重新 boot 过，旧计时器作废）：
   *   rise   镜头往正上方升（场景的 overhead）    cover  云雾涌进来（旧 → 新同时开始加载）
   *   swap   云雾盖满：切画面，至少停 hold 秒，旧 → 新还要等建好（建好了镜头先摆在正上方）
   *   clear  云雾散开（旧 → 新：镜头同时从正上方降回远景，场景的 descend）      走完：云雾那一层拿掉 */
  function stepMist(gen) {
    if (gen !== T.gen || !T.busy) return;
    const s = T.plan.shift(), M = MIST, go = () => stepMist(gen);
    if (!s) { stopMist(); return; }
    T.step = s.step;
    if (s.step === "rise") {
      camMove("overhead", { elevation: M.rise.elevation, dist: M.rise.dist, secs: M.rise.secs, ease: M.rise.ease });
      env.wait(s.secs, go);
    } else if (s.step === "cover") {
      mistTo("in");
      if (T.to === "new" && !S.loading) T.pre = preload();
      env.wait(s.secs, go);
    } else if (s.step === "swap") {
      let left = 2;
      const both = () => { if (--left === 0) go(); };
      env.wait(s.secs, both);
      const pre = T.pre;
      T.pre = null;
      swapNow(T.to, pre).then(() => {
        if (gen !== T.gen || T.to !== "new" || !S.sc) { both(); return; }
        camMove("overhead", { elevation: M.rise.elevation, dist: M.rise.dist, secs: 0 });   // 新画面从正上方开始
        afterFrames(M.frames, both);   // 画出来了云雾才散
      });
    } else if (s.step === "clear") {
      mistTo("out");
      if (T.to === "new") camMove("descend", { secs: M.descend.secs, ease: M.descend.ease });
      env.wait(s.secs, go);
    } else go();
  }
  /** 等浏览器画完 n 帧再接着走（新画面第一次画要编译着色器）；没有 requestAnimationFrame（Node 里）就直接接着走 */
  function afterFrames(n, fn) {
    const raf = root.requestAnimationFrame;
    if (!(n > 0) || typeof raf !== "function") { fn(); return; }
    raf.call(root, () => afterFrames(n - 1, fn));
  }
  /** 叫场景挪转场的镜头（overhead 升到 / 摆到正上方、descend 降回远景）；没有场景、场景没有这一招（浏览器缓存里还是旧的场景模块）就算了，云雾照走 */
  function camMove(name, o) { if (S.sc && typeof S.sc[name] === "function") S.sc[name](o); }
  /** 转场走完（或者页面重新 boot）：云雾那一层拿掉，滚轮、开关又接了 */
  function stopMist() {
    T.gen++;
    T.busy = false; T.to = T.step = T.plan = T.pre = null;
    if (T.mist && T.mist.remove) T.mist.remove();
    T.mist = null;
  }
  /** 旧 → 新：云雾一涌进来就开始加载（第一次打开要一会儿，盖满了再建）。先挂一个空的 catch：轮到「切」之前就出错不报「没人接的 reject」，切的时候 start 照样接着处理 */
  function preload() { const p = loadNow(); p.catch(() => {}); return p; }
  /** 云雾那一层：铺在战场那一格（#g-field）里、新画面和首领横幅上面（hd2d.css 的 .hd2d-mist）。转场一开始就铺上（还透明，挡住点击），
   *  cover 时加 .in（一团团从四边涌进来、合拢盖满）、clear 时换成 .out（散开），走完拿掉。颜色、透明度、时长、每团的位置大小都按 MIST 写在行内；
   *  只有几个空的 <i> / <b>，没有字、没有数（坚毅生命更不会有） */
  function mistLayer() {
    const d = env.doc, field = host.field();
    if (!field) return null;
    const M = MIST, el = d.createElement("div");
    el.className = "hd2d-mist";
    el.setAttribute("aria-hidden", "true");
    const vars = (node, kv) => kv.forEach(([k, v]) => node.style.setProperty(k, String(v)));
    vars(el, [["--mist-c", M.color.join(", ")], ["--mist-o", M.opacity], ["--mist-in", M.cover + "s"], ["--mist-out", M.clear + "s"]]);
    const veil = d.createElement("b");
    veil.className = "veil";
    el.appendChild(veil);
    mistPuffs().forEach(p => {
      const i = d.createElement("i");
      vars(i, [["--x", p.x + "%"], ["--y", p.y + "%"], ["--w", p.w + "%"], ["--h", p.h + "%"], ["--dx", p.dx + "%"], ["--dy", p.dy + "%"], ["--d", p.d + "s"]]);
      el.appendChild(i);
    });
    // 转场中的点击、双击、右键都吞掉（不落到 3D 铭牌 / 地台、旧战场上，也不冒到 #g-field 的点击）
    ["click", "dblclick", "contextmenu", "pointerdown"].forEach(t => el.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); }));
    field.appendChild(el);
    return el;
  }
  function mistTo(phase) {
    const el = T.mist;
    if (!el) return;
    if (phase === "in") { void el.offsetWidth; el.classList.add("in"); }   // 先按还没涌进来的样子排一次，才有过渡
    else { el.classList.remove("in"); el.classList.add("out"); }
  }
  /** 战场上的滚轮（#g-field，捕获阶段，一次滚动 = wheelGate）：
   *   正在转场、这一次滚动已经换过一次画面（触控板的惯性还在来）：不理（镜头不换段，页面也不滚）
   *   旧画面：往前滚（拉近）攒够一下 → 转到新画面；往后滚、按着 Ctrl（触控板双指缩放 / 浏览器缩放）照旧是浏览器自己的
   *   新画面：交给场景（三段镜头换段；远景再往外拉由场景叫 onZoomOut）
   * 这一次打开页面新画面已经打不开过：旧画面的滚轮照旧，要开就点开关 */
  function onFieldWheel(e) {
    const r = wheelGate(T.gesture, wheelPixels(e), env.now());
    T.gesture = r.state;
    if (T.busy || T.gesture.ate) { e.preventDefault(); e.stopPropagation(); return; }
    // 联机玩家的旧战场自己会滚动：还没滚到顶就照旧滚，这一次滚动不打开新画面（#289）
    if (!S.want && !S.sc && scrollsUp(e)) { T.gesture.done = true; return; }
    if (S.want || S.sc || r.step !== 1 || e.ctrlKey || S.broken) return;
    e.preventDefault(); e.stopPropagation();
    if (switchTo("new")) T.gesture.ate = true;
  }

  /** 滚轮落在的地方（联机的战场、区）还能往上滚：联机玩家的旧战场单位多时自己会滚动，往回滚不能被当成「打开新画面」。单机的战场不滚，不看 */
  function scrollsUp(e) {
    if (host === SOLO) return false;
    const field = host.field();
    for (let n = e && e.target; n && n.nodeType === 1; n = n.parentNode) {
      if (n.scrollTop > 0) return true;
      if (n === field) break;
    }
    return false;
  }

  /** 开了才加载：普通脚本按顺序（加载过的不再加载），最后是场景包（tools/build-hd2d.js 打的普通脚本），交出 createHd2dScene */
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
    if (!root[FIELD.sceneGlobal]) await loadScript(BASE + FIELD.scene);
    const mod = root[FIELD.sceneGlobal];
    if (!mod || typeof mod.createHd2dScene !== "function") throw new Error("场景包没有 createHd2dScene：" + FIELD.scene);
    return mod.createHd2dScene;
  }

  /** 建 3D 战场：铺在 #g-field 里（盖住旧的区和单位卡，旧的照旧排、只是看不见），镜头按钮、天气的 2D 层、攻击演出的适配器一起建 */
  function mount(create) {
    const d = env.doc, h = host, L = Lay(), HD2DFx = root.HD2DFx, WX = root.HD2DWfx;
    const field = h.field(), app = h.app();
    if (!field || !app || (h === SOLO && !root.GAME) || !L || !HD2DFx || !WX || typeof create !== "function") throw new Error("缺少战斗画面或模块");
    if (h !== SOLO) field.scrollTop = 0;   // 联机的战场自己会滚动：3D 那一层铺在看得见的那一块上
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
      const input = h.input();
      S.sc = create(stage, Object.assign({
        // 画质（#321）：这一刻的那一档；有演出在播时照常满帧画（静止时场景自己降帧）；「自动」一直卡就降一档
        quality: FIELD.quality.levels[qualityLevel()], busy: fxBusy, onSlow,
        onCameraChange: syncCam,
        onPortraitChange: () => { if (S.sc) paint(true); },
        onViewChange: () => { if (S.sc) paint(true); },
        // 远景到头了还往外拉（滚轮 / 双指捏小）：转回旧画面，和顶栏开关同一个入口；这一次滚动剩下的都不理（不会转回去又被惯性拉回来）
        onZoomOut: () => { if (switchTo("old") && T.gesture) T.gesture.ate = true; }
      }, input || {}));
      S.wfx = WX.create(stage, { lens: () => HD2DFx.lens(S.sc.lensNow()), view: () => S.sc.view(), flash: () => S.sc.flash });
      S.ad = HD2DFx.adapter({ lens: () => S.sc.lensNow(), plate: (id) => S.sc.plateOf(id), zone: (id) => S.sc.zoneOf(id), size: (big) => L.plateSize(S.sc.view(), big), offset: () => stage.getBoundingClientRect() });
      // 纸片风数字、纸片感、推镜头（hd2d-play.js，#283）：演出倍率 / 跳过用 game.js 的同一个钟（G.fxClock：「演出 1× / 2×」、协助攻击的慢放、点击跳过；
      // 联机玩家用他那边给的钟）；影子那一层挂进 3D 战场这一层（压在 3D 画面上、铭牌下面）
      const PL = root.HD2DPlay;
      if (PL) {
        const clock = h.clock();
        if (typeof clock === "function") PL.setClock(clock);
        PL.shadeIn(stage);
        S.push = PL.camera(S.sc);
      }
    } catch (e) { teardown(false); throw e; }
    app.classList.add("hd2d-on");
    // 技能栏、队伍栏换上原型那一套（#297，hd2d-shell.js）：按钮还是 game.js / online-battle.js 自己画、自己接，下面 refresh 一画就是新样子
    const shell = root.HD2DShell, hud = h.hud ? h.hud() : null;
    if (shell && hud && shell.attach(hud, { storage: env.storage })) S.hud = hud;
    S.broken = false;
    paint(true);
    // 旧战场的天气叠加层拿掉（画在新画面上）、行动的人、标记都按现在的再走一遍；演出中先不打断，播完 game.js 自己会刷新
    h.refresh();
  }
  /** 拆掉 3D 战场，旧画面露出来；refresh = 让旧画面再画一遍（单机：game.js 把天气叠加层放回去） */
  function teardown(refresh) {
    if (S.sc) { try { S.sc.dispose(); } catch (e) {} }
    if (S.wfx) { try { S.wfx.dispose(); } catch (e) {} }
    if (S.stage && S.stage.remove) S.stage.remove();
    const hadStage = !!S.stage;
    // 纸片风数字、影子拿掉，attack-fx 的画布复原（旧画面照旧画在没压扁的画布上）
    if (hadStage && root.HD2DPlay) { root.HD2DPlay.clear(); root.HD2DPlay.shadeIn(null); }
    S.sc = S.wfx = S.ad = S.push = S.stage = S.cam = S.camInfo = S.layout = S.view = null;
    S.pushed = false;
    S.insetKey = "";
    // 技能栏、队伍栏的新外壳拆掉（#297）：.g-hud 回到换上之前的样子（按钮里面的东西等 refresh / 下一次画技能栏换回旧的）
    if (S.hud) { if (root.HD2DShell) root.HD2DShell.detach(S.hud); S.hud = null; }
    const app = host.app();
    if (app) app.classList.remove("hd2d-on");
    if (!hadStage) return;
    if (root.UnitTip && root.UnitTip.hide) root.UnitTip.hide();
    if (refresh) host.refresh();
  }

  /** 排一次战场（game.js / 联机那边刷新画面、窗口变了、横幅出来了）：画面用的那一份（host.view：单机投影、联机是收到的包）→ 布局 → 场景；
   *  reset = 镜头回到这一段的默认位置 */
  function paint(reset) {
    const L = Lay();
    if (!S.sc || !L) return;
    // 战斗画面藏着（切到地图、标题……，战场宽 0）：先不排，回来时画面大小一变场景会叫 onViewChange 重排（快照记着最新的）
    if (!S.stage || !S.stage.clientWidth) return;
    const v = host.view();
    if (!v) return;
    S.view = v;
    if (insets()) reset = true;
    S.layout = L.build(v, layoutOpts(v, S.sc.view(), S.sc.portrait));
    S.sc.setBattle(S.layout, { weather: v.weather || "none", theme: v.light || "day", actorId: S.actorId });
    if (reset) S.sc.refit();
    S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
    syncWeather();
  }
  /** 单机画面用的那一份：本机的战斗状态投影（viewState），快照用 game.js · setView 给的（还没给过就现拍一张） */
  function soloView() {
    const G = root.GAME, st = stateNow();
    if (!G || !st) return null;
    // 和联机发包前一样先同步区域 / 场景 / 光影（光影跟着时钟、场景跟着场上的场地；只是画面的标签，不改结算：world-data.js）
    try { if (typeof root.battleLookSync === "function") root.battleLookSync(); } catch (e) {}
    const snaps = S.snaps || (typeof G.snapAll === "function" ? G.snapAll() : null);
    return viewState(st, snaps, { OV: root.OnlineView, itemCatalog: catalog() });
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
      b.title = C.CAMERA[t].name + "（滚轮也能切：往前滚拉近、往后滚拉远，远景时再往后滚回到旧画面；近景里双击单位看特写）";
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
    if (T.busy || !S.sc || !S.stage || !S.stage.clientWidth || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    const K = root.HD2DCamera.CAMERA.keys;
    if ((e.key === K.prev || e.key === K.next) && S.sc.tier !== "far") { e.preventDefault(); S.sc.stepZone(e.key === K.prev ? -1 : 1); }
  }

  /* ---------- 画质、演出在播（#321）----------
   * 暂停页面里的「画质」：点一下按 FIELD.quality.choices 换下一档（自动 → 高 → 低），菜单不收起；记在本机（存不了也照这一次选的），单机 / 联机同一个。
   * 新画面开着时才有这一项（关着时画质用不上）。字在 pause-menu.js 的 PAUSE_MENU.items.quality。只换这台电脑上的画面，不碰战斗状态、不发给别人 */
  /** 现在选的（这一次打开页面选过的优先，不然本机记着的） */
  const qualityChoice = () => (QS.choice != null ? QS.choice : quality(env.storage));
  /** 这一刻用哪一档（FIELD.quality.levels 的键） */
  const qualityLevel = () => levelOf(qualityChoice(), QS.dropped);
  /** 演出在播（场景按需渲染时看它：播着就照常满帧画）：整包演出（hd2d-play.js：联机玩家、原型）、单机的出招演出 / 敌人行动（game.js 的 G.depth） */
  function fxBusy() {
    if (root.HD2DPlay && root.HD2DPlay.busy) return true;
    return host === SOLO && !!(root.GAME && root.GAME.depth > 0);
  }
  /** 场景量到一直卡（hd2d-pace.js · meter）：选的是「自动」、还没降过 → 降一档（这一次打开页面都用它，不记在本机）；选了高 / 低就不管 */
  function onSlow() {
    if (qualityChoice() !== "auto" || QS.dropped) return;
    QS.dropped = true;
    applyQuality();
  }
  /** 画质换到这一刻的那一档（场景是旧的、没有 setQuality 就算了），暂停页面的字跟着换 */
  function applyQuality() {
    if (S.sc && typeof S.sc.setQuality === "function") S.sc.setQuality(FIELD.quality.levels[qualityLevel()]);
    if (root.PauseMenu && typeof root.PauseMenu.refresh === "function") root.PauseMenu.refresh();
  }
  /** 暂停页面里点「画质」：换下一档、记在本机，马上用上 */
  function cycleQuality() {
    QS.choice = nextQuality(qualityChoice());
    setQuality(QS.choice, env.storage);
    applyQuality();
  }
  /** 「画质」那一项写什么（PAUSE_MENU.items.quality）：自动卡过、降了一档时另写一句 */
  function qualityLabel(PM) {
    const words = PM.CONFIG && PM.CONFIG.items && PM.CONFIG.items.quality, c = qualityChoice();
    if (!words) return c;
    return c === "auto" && QS.dropped ? words.autoLow : words[c] || words.label;
  }
  /** 在暂停页面登记「画质」（同一个 id 再登记会换掉旧的：重新 boot 也只有一项）；没有暂停页面（Node 里、原型页）就算了 */
  function registerQuality(PM) {
    if (!PM || typeof PM.register !== "function") return;
    PM.register({ id: "quality", stay: true, visible: () => !!S.want, label: () => qualityLabel(PM), run: cycleQuality });
  }

  /* ---------- game.js 调的（单机；联机玩家的画面挂着时不管，快照照样记着）---------- */
  /** 新画面建好了没有（开关开着、模块加载成功）：game.js 的演出位置、天气叠加层看它 */
  function on() { return !!S.sc && host === SOLO; }
  /** game.js · setView 每次都叫（refreshAll 的现在的状态、演出的每一下）：开着就跟着重排；快照记着，刚打开时用 */
  function view(snaps) {
    S.snaps = Array.isArray(snaps) ? snaps : null;
    if (host === SOLO) sync();
  }
  /** 跟着画面重排；旧战场换棋盘时整个清空重建（game.js · syncFieldDom、online-battle.js · layout 的 innerHTML = ""）：新画面那一层、转场的云雾挂回去 */
  function sync() {
    const field = env.doc ? host.field() : null;
    if (field && T.mist && T.mist.parentNode !== field) field.appendChild(T.mist);
    if (!S.sc) return;
    if (field && S.stage && S.stage.parentNode !== field) field.appendChild(S.stage);
    paint(false);
  }
  /** 转场走到哪了（测试、game.js 看）：{ busy 正在转, to 转去哪边, step 哪一段 } */
  function transition() { return { busy: T.busy, to: T.to, step: T.step }; }
  /** 谁在行动（game.js · refreshHud：我方回合选中的那个人；敌人回合是 null）：铭牌描金边、脚下的光圈；换了人中景 / 近景跟到他所在的区。
   *  refreshHud 叫得很勤（放技能、取消……），同一个人不再叫场景，不然玩家自己挪去看别的区的镜头会被拽回来 */
  function actor(id) { if (host === SOLO) setActor(id); }
  function setActor(id) {
    id = id != null ? id : null;
    const changed = id !== S.actorId;
    S.actorId = id;
    if (!S.sc || !changed) return;
    S.sc.setActor(id);
    if (S.layout) S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
  }
  /** 选目标 / 选区的标记（game.js · paintMarks） */
  function marks(m) { if (host === SOLO) setMarks(m); }
  function setMarks(m) {
    S.marks = m ? { pick: !!m.pick, targets: (m.targets || []).slice(), hover: m.hover != null ? m.hover : null, zones: (m.zones || []).slice(), hoverZone: m.hoverZone != null ? m.hoverZone : null } : null;
    if (S.sc && S.layout) S.sc.setMarks(marksOf(S.marks, S.layout, S.actorId));
  }

  /* ---------- 联机玩家的战斗画面（online-ui.js 调，#289）---------- */
  /** 顶栏开关（#g-hd2d-toggle，同一个按钮）挪到 host.slot() 里；联机那边重画舞台把它拿下来了也挂回去。第一次挪走时记下单机顶栏里原来的位置 */
  function placeToggle() {
    const b = env.toggle, slot = host.slot ? host.slot() : null;
    if (!b || !slot || b.parentNode === slot) return;
    if (!env.home && b.parentNode) env.home = { parent: b.parentNode, next: b.nextSibling || null };
    slot.appendChild(b);
  }
  /** 开关放回单机的顶栏原来的位置 */
  function homeToggle() {
    const b = env.toggle, h = env.home;
    env.home = null;
    if (!b || !h || !h.parent) return;
    if (h.next && h.next.parentNode === h.parent && typeof h.parent.insertBefore === "function") h.parent.insertBefore(b, h.next);
    else h.parent.appendChild(b);
  }
  /**
   * 联机玩家进了战斗：新画面挂到他自己的战斗画面上（spec 见上面的「画面挂在哪」）。开关本来开着就直接在那里建好（刚进战斗，不播转场；第一次要先加载）；
   * 关着就只挪开关、接上滚轮（旧战场上往前滚 = 打开，和单机一样）。同一个 spec 再叫一次就是拿回把手。
   * 返回把手（只对这一次挂上去的画面有效，detach 以后都不理）：
   *   on()           新画面建好了没有（收到行动包时看它：开着走 play、关着照旧走旧画面）
   *   view()         联机那边刷新画面（收到包、演出的每一下、选目标）：跟着重排
   *   actor(id)      谁在行动（轮到他、在行动的那个人；不是行动阶段 = null）   marks(m)  选目标 / 选区的标记（和 game.js 的 fieldMarks 一样的格式）
   *   play(packet, { before, bigHit, onImpact })   收到行动包：整包交给 hd2d-play.js 播（原型页同一份），返回 Promise；没开返回 null
   *   skip()         正在播的立刻结束
   */
  function attach(spec) {
    if (!spec || typeof spec.field !== "function" || typeof spec.app !== "function" || typeof spec.view !== "function") return null;
    if (host.spec === spec) return host.handle;
    stopMist();
    teardown(false);
    if (host !== SOLO) homeToggle();
    S.actorId = null; S.marks = null;
    const h = {
      spec, field: spec.field, app: spec.app, view: spec.view,
      input: () => (spec.input ? wire(spec.input) : null),
      clock: () => (typeof spec.clock === "function" ? spec.clock : null),
      refresh: () => { if (typeof spec.refresh === "function") spec.refresh(); },
      hint: typeof spec.hint === "function" ? spec.hint : null,
      slot: () => (typeof spec.slot === "function" ? spec.slot() : null),
      hud: () => (typeof spec.hud === "function" ? spec.hud() : hudIn(spec.app()))
    };
    const mine = () => host === h;
    h.handle = {
      on: () => mine() && !!S.sc,
      view: () => { if (!mine()) return; placeToggle(); sync(); },
      actor: (id) => { if (mine()) setActor(id); },
      marks: (m) => { if (mine()) setMarks(m); },
      play: (packet, o) => (mine() ? play(packet, o) : null),
      skip: () => { if (mine() && root.HD2DPlay) root.HD2DPlay.skip(); }
    };
    host = h;
    placeToggle();
    bindWheel(h.field());
    remount();
    paintToggle();
    return h.handle;
  }
  /** 联机玩家离开战斗（换到探索、离开房间、变成房主）：拆掉他画面上的 3D，开关放回单机的顶栏；开关开着就照旧在单机的战场上建好（和刚打开页面一样） */
  function detach(spec) {
    if (host === SOLO || (spec && host.spec !== spec)) return false;
    stopMist();
    if (root.HD2DPlay && S.sc) root.HD2DPlay.skip();
    teardown(false);
    homeToggle();
    host = SOLO;
    S.actorId = null; S.marks = null;
    remount();
    paintToggle();
    return true;
  }
  /** 换了地方挂：开关开着就在新地方建（加载过的直接建，还在加载的等加载完自己建）；新地方缺东西（单机页面不在）就先不建 */
  function remount() {
    if (!S.want || S.sc || S.loading || !env.doc || !host.field() || !host.app()) return;
    if (!S.create) { start(); return; }
    try { mount(S.create); } catch (e) { fail(e); }
  }
  /** 联机玩家收到一个行动包（#289）：整包交给 hd2d-play.js 播（原型页按联机包播的同一份）——出手 / 弹道 / 打中照 attack-fx、受击粒子照 hit-fx，
   *  位置问 3D 铭牌（适配器）；纸片风数字、纸片感、推镜头，演出倍率、跳过跟着 host.clock。只读投影过的包。
   *  o.before = 出招前画面用的那一份（比一比谁被击倒）、o.bigHit 大伤害加 !!、o.onImpact = 第一下打中时画面换成包里的 state、
   *  o.sound(kind, i) = 该响音效的那一刻（online-sfx.js，#304：出手 strike / 第 i 段打中 wave / 格挡 parry / 演完 end）。没开返回 null */
  function play(packet, o) {
    const PL = root.HD2DPlay;
    if (!S.sc || !S.ad || !PL || typeof PL.play !== "function" || !packet) return null;
    o = o || {};
    if (PL.busy) PL.skip();          // 上一个包还在播：立刻结束（和旧画面收到新包时一样不叠着播）
    return PL.play(packet, S.ad, {
      before: o.before || null, bigHit: o.bigHit || null, onImpact: o.onImpact, sound: o.sound || null,
      view: () => (S.sc && S.stage ? fxView() : { width: 0, height: 0, top: 0 }), camera: S.push, lens: () => (S.sc ? S.sc.lensNow() : null)
    });
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

  /* ---------- 攻击演出：纸片风数字、纸片感、推镜头（#283，game.js · playTape 一下一下调；都交给 hd2d-play.js）---------- */
  /** 数字摆位要的画面：战场那一格在视口里的位置（数字和铭牌的矩形一样是视口坐标）、大小，上下被首领横幅 / 镜头按钮盖住的像素（场景的 insets） */
  function fxView() {
    const r = S.stage.getBoundingClientRect(), v = S.sc.view();
    return { x: r.left, y: r.top, width: v.width, height: v.height, top: v.top || 0, bottom: v.bottom || 0 };
  }
  /** 弹纸片风数字：list = [{ unitId, kind, text, el }]（game.js 按 hd2d-fx.js · numberOf 挑好的，投影里没给数的已经去掉）。
   *  摆位、字号、颜色、时长照 hd2d-fx.js 的 FX（近景大远景小，两两不压住，也不压住画面上还没消失的）；跳过时不弹。没开返回 [] */
  function numbers(list) {
    if (!S.sc || !S.ad || !S.stage || !root.HD2DPlay) return [];
    return root.HD2DPlay.numbers(list, rectOf, fxView());
  }
  /** 打中那一下的纸片感：attack-fx 的画布按镜头俯角压扁、脚下地台上一道淡影子；影子淡掉时画布自己复原（hd2d-fx.js 的 FX.paper，跟着演出倍率） */
  function paper(id) {
    if (!S.sc || !S.ad || !root.HD2DPlay || !root.HD2DFx) return false;
    return root.HD2DPlay.paperHit(rectOf(id), S.sc.lensNow(), { hold: root.HD2DFx.FX.paper.shadow.dur });
  }
  /** 画布马上复原（击倒的红叉要停一阵，不画在压扁的画布上） */
  function unpaper() { if (root.HD2DPlay) root.HD2DPlay.unpaper(); }
  /** 出手时镜头稍微推一下（远景 / 中景；hd2d-play.js · HD2DPlay.camera → hd2d-fx.js · pushPose）：推过去要 FX.push.in 秒（跟着演出倍率）。
   *  返回 game.js 要等多少毫秒再出手（推到位再出手，弹道才对得上铭牌；没推 = 0）。近景、减少动态效果、跳过、转场中都不推 */
  function push(actorId, targetId) {
    if (!S.sc || !S.push || !root.HD2DFx || !root.HD2DPlay) return 0;
    const P = root.HD2DFx.FX.push;
    if (!S.push.push(actorId, targetId, P.in * root.HD2DPlay.clock)) return 0;
    S.pushed = true;
    return P.in * 1000;
  }
  /** 演完拉回推之前的镜头（FX.push.out 秒，跟着演出倍率；跳过了就直接回去）；没推过不管 */
  function release() {
    if (!S.pushed) return;
    S.pushed = false;
    if (S.push && root.HD2DFx && root.HD2DPlay) S.push.release(root.HD2DFx.FX.push.out * root.HD2DPlay.clock);
  }

  const api = { FIELD, MIST, enabled, setEnabled, quality, setQuality, levelOf, nextQuality, viewState, packetView, layoutOpts, marksOf, wire, gapRect, mistPlan, wheelGate, wheelPixels, mistPuffs, boot, on, view, actor, marks, rectOf, zoneRectOf, numbers, paper, unpaper, push, release, switchTo, transition, attach, detach };
  // 页面里：等页面加载完（game.js 的 boot 先登记在 DOMContentLoaded 上，先跑）再接开关
  if (!(typeof module === "object" && module.exports) && root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", () => boot());
    else boot();
  }
  return api;
});
