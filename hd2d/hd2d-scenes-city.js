/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：城市类（#241）
 *
 * 主人试玩反馈 · 四：外城区、巨人城、天网设施、下水道各一套美术（地面、地台侧面、装饰、远景、光照 / 调色）。数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（#242 的登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   外城区 street：黄沙上的贫民窟。地面是黄沙（车辙、脚印、零碎的垃圾），地台侧面是一块块拼起来的瓦楞铁皮；
 *                  地台上零星的油桶、旧轮胎；战场后面、左右两边一圈矮房子和铁皮棚屋（不挡战场）；
 *                  再远处横穿整个画面的大管道（架在支架上、一道道法兰、几盏红灯），最后面一道沙岩悬崖（左右两边的更高，像峡谷）
 *   巨人城 city：  战场在一条往远处伸的大马路上（沥青、车道虚线、两边的实线、路沿、人行道），镜头顺着马路往里看；
 *                  两边一栋挨一栋非常非常大的玻璃楼（比画面上沿高好几倍，冲出画面），马路尽头再一排玻璃巨幕楼；楼上挂着会换画面的广告屏，
 *                  楼角竖着蓝色的灯带；地台顶面是干净的沥青、侧面是路沿石，地台上是隔离桩、小花坛；整体蓝色调，夜里窗亮、灯火通明
 *   天网设施 facility：混凝土、水泥的硬核设施。地台是浇筑的混凝土板（模板缝、螺栓孔），侧面混凝土墙、底下一道黄黑警示带；地台上是防撞墩、警示桩、油桶；
 *                  场地是一块块混凝土，战场四周一圈黄黑警示线；后面一排掩体（射击孔）、一道预制混凝土墙（墙脚警示带、墙头蛇腹铁丝网），墙后几座混凝土大楼；
 *                  左右两边铁丝网围栏（顶上斜伸出去几道带刺铁丝）；墙边两座探照灯塔；调色是冷冷的灰、压饱和度
 *   下水道 tunnel：巨大圆管的里面（只画后半边，像剖开的模型）：管壁从灯后面往后往上弯过竖直再弯成拱顶，比画面上沿高，看不到天（天幕也收起来）；
 *                  一段段混凝土、水位线、接缝和铆钉、一圈圈的灯带，管壁上几盏灯（照亮的那一片另外叠一层）、沿壁的管子；
 *                  地上铺满污水（贴图在流，上面一层更快的亮纹、灯的倒影），地台是湿的混凝土板；光照不分白天黑夜、昏暗；
 *                  天上来的天气不画（SHELTER：雷鸣只让灯闪一下）
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯，hd2d-scene-art.js · around）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesCity = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各区域的色调：sheet 铁皮（锈褐、镀锌灰、红锈、褪色的青、土黄……轮着用）、wall 矮房子的土坯 / 砖墙、roof 屋顶、dark 门洞 / 窗洞、
   *  barrel 油桶的漆色、tire 轮胎 */
  const PALETTE = {
    street: {
      sheet: [0x8c6a4e, 0x7c7e7a, 0x9c5c3c, 0x6c8482, 0xa58e66, 0x84563e],
      wall: [0xbf9f74, 0xa88c6a, 0xcaa97c, 0x9e8566],
      roof: [0x6a5644, 0x7c7066, 0x5c4a3c, 0x8a6248],
      dark: 0x1e1712, barrel: [0x3f6a8a, 0x9a3a2a, 0xc8962e, 0x5a6a4a], tire: 0x24201c
    },
    tunnel: {
      barrel: [0x4a5a3a, 0x6a4a32, 0x3c4a4a], tire: 0x1c1e1a, pipe: 0x4a3c30, wheel: 0x8a3a26
    },
    // 巨人城：post 隔离桩的银灰、ring 桩上那圈发光的蓝；planter 花坛的白水泥、leaf 灌木
    city: { post: 0xc4ccd8, ring: 0x5fd8ff, planter: 0xdde3ea, leaf: [0x4f9a68, 0x3f8a74] },
    // 天网设施：concrete 混凝土、barrel 油桶（警示黄 / 军绿）、tire 用不上（同上一套的写法，留着兜底）
    bunker: { concrete: 0xa4a49c, barrel: [0xe0b018, 0x55603e, 0xd8a414], tire: 0x222222 }
  };
  /** 天网设施 facility：混凝土、水泥的硬核军事设施。战场是一片浇筑的混凝土场地（模板缝、对拉螺栓孔），四周刷着黄黑警示线；
   *  后面一排混凝土掩体（射击孔）、再后面一道预制混凝土墙（墙脚刷黄黑警示带、墙头一卷卷蛇腹铁丝网），墙后几座混凝土大楼；
   *  左右两边是铁丝网围栏（铁丝网 + 顶上斜伸出去的几道带刺铁丝）；墙边两座探照灯塔（夜里很亮）。
   *   yard    场地：混凝土地面一块块（tile 世界单位一块），警示线离战场边 at、宽 w
   *   bunker  掩体：离「后面最近到哪」再往后 gap，几座（n）、宽 w / 高 h / 进深 d，射击孔离地 slit 高
   *   wall    墙：在掩体后面再往后 gap，高 = 那里画面上沿高度 × h（至少 min），每块预制板宽 panel、厚 d；警示带高 band；
   *           往战场左右各铺出去 reach；wire 墙头的蛇腹铁丝网（每圈半径 r、圈和圈隔 step）
   *   fence   左右的铁丝网围栏：离「左右最近到哪」再往外 gap，高 h，每隔 post 一根桩，顶上 strands 道带刺铁丝（往外斜伸出去 lean）
   *   block   墙后的混凝土大楼：几座、宽 / 高（× 那里画面上沿高度）、离天幕 sky
   *   flood   探照灯塔：几座（横向位置 × 战场半宽）、高（× 画面上沿高度）、灯的颜色、白天 / 傍晚 / 夜晚多亮 */
  const BUNKER = {
    yard: { tile: 4, hazard: { at: 0.6, w: 0.32 } },
    bunker: { gap: 0.7, n: 3, w: [2.8, 3.8], h: 1.25, d: 2.2, slit: 0.75 },
    wall: { gap: 0.9, h: 0.34, min: 2.4, panel: 2.4, d: 0.5, band: 0.45, reach: 24, wire: { r: 0.24, step: 0.16 } },
    fence: { gap: 1.4, h: 2.3, post: 2.6, strands: 3, lean: 0.35 },
    block: { n: 5, w: [5, 9], h: [0.65, 0.95], sky: 2.2 },
    flood: { at: [-0.75, 0.75], h: 0.62, color: 0xeaf4ff, bright: { day: 1.2, dusk: 2.2, night: 3 } }
  };
  /** 巨人城 city：战场在一条往远处伸的大马路上（镜头顺着马路往里看），两边是非常非常大的高楼（比画面上沿高好几倍，冲出画面），
   *  马路尽头再一排更多的玻璃巨幕楼，幕墙上挂着广告屏。整体蓝色调，先进、干净。
   *   road   马路：比战场每边宽 margin；lane 每隔多宽一条车道虚线（一段线占 dash 成）、edge 两边的实线离路沿多远（宽 w）；
   *          curb 路沿的宽、高，walk 人行道多宽（地砖每块 tile）；color 沥青、线、路沿、人行道的颜色
   *   side   两边的高楼：人行道外面，每边从马路尽头（离天幕 sky）排到战场前沿再往前 front；宽 w、进深 d 的范围，两栋之间留 gap；
   *          高 = 那里「画面上沿那条视线」的高度 × tall（至少 min）：冲出画面
   *   back   马路尽头的一排玻璃楼：离天幕 sky（在天边那条远景前面）、往战场左右各铺出去 reach；宽 / 高同上（进深 d）
   *   podium 每栋楼底下几层的裙楼（高 h，往外多出 out），lobby 门厅那一条玻璃（夜里亮）
   *   fin    楼角上竖着的灯带（宽 w，蓝色，白天 / 傍晚 / 夜晚多亮）
   *   glass  幕墙：一张贴图管 tile × tile 的一块（panels 列 × panels 层玻璃）；几种颜色（白天反着天光、夜里深色）轮着用；
   *          lit 傍晚 / 夜晚几成的窗亮着、亮多少（夜晚灯火通明）
   *   ads    广告屏：side / back 几成的楼上挂一块（屏的宽 × 楼宽、高 × 那里画面上沿的高度、底边离地 × 同上）；几套配色轮着；
   *          bright 白天 / 傍晚 / 夜晚多亮（泛光会抓到）；every 秒换一张画面（减少动态效果时不换） */
  const CITY = {
    road: {
      margin: 1.6, lane: 3.6, dash: 0.5, edge: { at: 0.35, w: 0.12 }, curb: { w: 0.3, h: 0.16 }, walk: 2.4, tile: 1.2,
      color: { asphalt: "#2e3542", line: 0xe6eeff, curb: 0xb8c2cc, walk: "#9aa4b2" }
    },
    side: { sky: 1.2, front: 6, w: [8, 12], d: [6, 9.5], gap: [0.4, 1.4], tall: [2.6, 4.2], min: 30 },
    back: { sky: 1.6, reach: 30, w: [5, 9], d: 3.5, gap: [0.2, 0.9], tall: [1.6, 3.2], min: 22 },
    podium: { h: 1.7, out: 0.25, lobby: 0.55 },
    fin: { w: 0.14, color: 0x5fd8ff, bright: { day: 0.6, dusk: 1.6, night: 2.4 } },
    glass: {
      tile: 16, panels: 8,
      day: ["#8fb8e0", "#7fa6d4", "#a6c6e4", "#6f9cc8"], dusk: ["#4a5a8a", "#3e4e7c", "#56608e", "#384872"], night: ["#16223c", "#121c34", "#1c2844", "#0e1830"],
      lit: { day: 0, dusk: 0.35, night: 0.62 }, glow: { day: 0, dusk: 0.9, night: 1.5 }
    },
    ads: {
      side: 0.7, back: 0.6, w: 0.62, h: 0.42, at: 0.28,
      colors: [["#ff3fa8", "#5f2bff"], ["#20e8ff", "#2060ff"], ["#ffb02e", "#ff3f6a"], ["#7dff9a", "#16a0c8"]],
      bright: { day: 1.1, dusk: 1.7, night: 2.3 }, every: [3, 6]
    }
  };
  /** 下水道 tunnel：在一根巨大的圆管里面。只画后面那半边（像剖开的模型，镜头从剖开的那边看进去）：管底就是地面，
   *  管壁从灯后面 gap 处开始往后、往上弯，过了竖直再往头顶弯过来成拱顶（arc 弧度），比画面上沿高得多，看不到天；天幕和天边那条远景也收起来。
   *  （默认镜头俯角 30°、视角 22°：管壁在画面里只露出离地两三到六的那一截，近景几乎只看得到地面。所以「弧形」靠这一截上的灯带、接缝、铆钉和水面的倒影看出来；
   *   拱顶在镜头往上转时才看得到。拱顶弯到 arc 为止：再往前弯，镜头就看到管壁的外面了）
   *   r          管子的半径（世界单位；还要让弯到竖直的那一截在天幕前面，放不下就小一点）
   *   seg / rows 横着几段、沿弧几段；wall 管壁混凝土的颜色（一段段轮着）；glow 管壁自己发的一点光（昏暗里也看得出形状）
   *   joint      每隔 every 一道接缝（宽 w，颜色 × dark）；rivet 接缝两边各一排铆钉（沿弧每隔 step 一颗，半径 r、颜色）
   *   rings      灯带：每隔 each 道接缝，接缝上一圈沿着管壁的灯带（宽 w，颜色 × gain，泛光会抓到）；照亮两边的管壁（spread 以内，最亮加 level 的灯色）
   *   stain      水位线：离地 h 以下颜色 × dark、往 tint（泡过污水的绿褐）靠
   *   lamps      管壁上 n 盏灯：离地 h；照亮的那一圈 reach 大，另外叠一层加色的网格（最亮加 gain × 0.18 的灯色，不受场景光照影响）；
   *              前 blink 盏会闪（AMBIENT.flicker）
   *   pipes      沿管壁横着走的管子 / 电缆：离地 h、半径 r、颜色
   *   water      地上的污水：比地面高 y，贴图往左流 speed（每秒走多少世界单位），颜色；
   *              streak 水面上一道道顺着流向的亮纹（另一层，比污水快 fast 倍：两层流速不同，看得出在流）；
   *              shine 灯带、壁灯在水面上的倒影：一条条往前伸 len、宽 w 的亮纹（亮度 level，贴图晃动着往左流 speed） */
  const TUNNEL = {
    r: 8.6, gap: 0.6, arc: 2.55, seg: 96, rows: 34,
    wall: [0x6c776c, 0x637066, 0x737d72], glow: 0x10160f,
    joint: { every: 4.2, w: 0.35, dark: 0.55, rivet: { step: 0.5, r: 0.055, color: 0xa4ac98 } },
    rings: { each: 2, w: 0.16, color: 0xd8f0a8, gain: 2.4, spread: 1.5, level: 0.2 },
    stain: { h: 1.2, dark: 0.62, tint: 0x3a4628 },
    lamps: { n: 6, h: 2.7, reach: 3.4, gain: 2.2, color: 0xe4f0a8, blink: 1 },
    pipes: [{ h: 1.6, r: 0.17, color: 0x4a3a2e }, { h: 2.05, r: 0.08, color: 0x2a3032 }, { h: 3.6, r: 0.26, color: 0x50463a }],
    water: {
      y: 0.04, speed: 0.35, color: 0x5f6a44,
      streak: { fast: 2.2, opacity: 0.55 },
      shine: { len: 6.5, w: 0.9, level: 0.5, speed: 0.6 }
    },
    // 排污口：管壁上伸出来一截横着的管子（u 横向位置 × 战场半宽，离地 h，半径 r），污水从管口往下流进地上的污水里（fall 每秒往下走多少）
    outfall: { u: 0.55, h: 1.7, r: 0.55, fall: 1.2, color: 0x6a7048 }
  };
  /** 环境动画的频率（秒）：flicker 管壁上会闪的灯隔多久闪一下、每次暗多久。减少动态效果时灯一直亮着、污水不流。
   *  thunder 雷鸣时（SHELTER.thunder.flicker）：外面隔 every 秒（随机）打一次雷，管子里的灯（壁灯、灯带、照亮的那一片）跟着闪一下：
   *          一共 dur 秒，dips = [第几秒起, 剩几成亮]（一下暗、一下亮、再暗一下，然后恢复） */
  const AMBIENT = {
    flicker: { every: [1.5, 5], dur: [0.06, 0.25] },
    thunder: { every: [4, 10], dur: 0.34, dips: [[0, 0.12], [0.07, 0.85], [0.13, 0.3], [0.22, 0.75]] }
  };
  /** 室内的场景里（下水道）天气怎么画（主人：「下水道里不显示天空类的天气」）：天上来的都不画，换成管子里说得通的样子；
   *  规则上的天气照旧（顶栏照旧写着），只是画面不一样。挂钩见 hd2d-scene-art.js · weather。
   *   fx       3D 那边按哪种天气画（"none" = 只剩飘浮的尘：没有乌云、闪电、雨丝、雪、沙粒，也不闪白、镜头不抖）
   *   wfx      2D 层（正式画面的 weather-fx）按哪种叠（"none" = 不叠）
   *   flicker  打雷时管子里的灯跟着闪一下（AMBIENT.thunder）
   *  没写的天气（微光、相位：不是天上来的）照旧 */
  const SHELTER = {
    thunder: { fx: "none", wfx: "none", flicker: true },   // 乌云、闪电、闪白 → 只让灯闪一下
    acid: { fx: "none", wfx: "none" },                      // 雨丝、地台上的涟漪
    snow: { fx: "none", wfx: "none" },                      // 雪
    sand: { fx: "none", wfx: "none" },                      // 沙暴的沙粒、沙雾（管子里刮不进风沙）
    heat: { fx: "heat", wfx: "none" }                       // 酷暑：3D 的热浪扭曲、热尘留着（管子里闷热）；2D 那层从底下泛上来的暖光（像太阳的光晕）不要
  };
  /** 战场周围的贫民窟（hd2d-scene-art.js · around 给的范围外面，margin 是再让开多少）：
   *   rows     后面几排：每排离「后面最近到哪」再往后 gap，横着每隔 step（± jitter 成）一间，往左右各伸出战场半宽 + reach
   *   side     左右两边各几列：每列离「左右最近到哪」再往外 gap，从后面一直排到战场前后的正中（不排到前面，不挡人）
   *   shack / house   铁皮棚屋 / 矮房子的宽、高、深的范围（世界单位，放大以前）；house = 几成是矮房子（其余是铁皮棚屋）
   *   scale    整体放大（主人 10/23：房子太小，长宽高都放大到 3 倍）：每间的宽 / 高 / 深、屋顶厚、烟囱粗，连同排与排、间与间的距离、
   *            往左右伸出去的 reach 一起乘（不然放大了会挤在一起）；离战场让开的 margin 不乘 */
  const SLUM = {
    scale: 3,
    margin: { back: 0.5, side: 0.9 },
    rows: [{ gap: 0, step: 1.7, jitter: 0.25 }, { gap: 2.0, step: 2.0, jitter: 0.3 }],
    reach: 8,
    side: [{ gap: 0, step: 1.8 }, { gap: 2.1, step: 2.1 }],
    shack: { w: [1.0, 1.5], h: [0.75, 1.05], d: [0.8, 1.1] },
    house: { w: [1.3, 2.0], h: [0.95, 1.4], d: [1.0, 1.4] },
    houses: 0.4,
    lit: { day: 0, dusk: 0.3, night: 0.55 },   // 几成的门洞 / 窗洞透出暖光（自己发光，泛光会抓到）；glow 光的颜色
    glow: 0xffb060,
    flue: 0.35                                 // 几成的棚屋顶上插一根烟囱管
  };
  /** 一间棚屋 / 矮房子的样子（× 这一间的宽 / 进深 / 高）：roof 屋顶比墙宽多少、深多少，lean 屋顶往门那边挪多少，eave 中心离门前那条线至少多远
   *  （= 屋顶伸出去的那一截：roof.d / 2 + lean，再留一点），door / win 门洞、窗洞的宽高 */
  const HUT = { roof: { w: 1.14, d: 1.3 }, lean: 0.06, eave: 0.75, tilt: { shack: 0.16, house: 0.05 }, door: [0.26, 0.62], win: [0.18, 0.2] };
  /** 贫民窟后面、再远处（都在天幕前面，离天幕 sky 远；高度 × 那里「画面上沿那条视线」能放多高 hmax）：
   *   pipes   横穿整个画面的大管道（几根）：sky 离天幕多远、r 半径（× hmax，至少 min）、y 管中心多高（× hmax，至少 2.4 个半径：支架露得出来）、
   *           k 远近（0–1，越远越偏雾色）；
   *           每隔 flange 一道法兰、每隔 legs 一副支架；warn 几盏一闪一闪的红灯
   *   cliff   沙岩悬崖：一段段（宽 w）一层层沙岩叠起来（layers 层，越往上越往里收 inset），高 h（× hmax），离天幕 sky、厚 d；
   *           wings 左右两边的高多少倍（像夹着这片贫民窟的峡谷），reach 往战场左右各铺出去多宽 */
  const FAR = {
    pipes: [{ sky: 3.4, r: 0.13, min: 0.5, y: 0.36, k: 0.55 }, { sky: 2.5, r: 0.085, min: 0.34, y: 0.22, k: 0.7 }],
    flange: 2.6, legs: 4.4, warn: 3,
    cliff: { sky: 1.25, d: 1.1, w: [2.4, 4.6], h: [0.5, 0.82], layers: [3, 5], inset: 0.08, wings: 1.3, reach: 26 }
  };
  /** 每个场景（键 = 地面主题）：
   *   palette   PALETTE 的哪一套
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、kinds 摆什么（barrel 油桶、tire 旧轮胎、valve 阀门、
   *             bollard 发光的隔离桩、planter 小花坛、jersey 混凝土防撞墩、post 黄黑警示桩；PROPS），轮着挑
   *   backdrop  远景：slum 战场周围的贫民窟（SLUM）、pipes 远处的大管道 / cliffs 沙岩悬崖（FAR）、tunnel 下水道的圆管（TUNNEL）、
   *             city 巨人城的马路、两边的高楼、马路尽头的玻璃巨幕楼（CITY）、bunker 天网设施的场地、掩体、墙、铁丝网（BUNKER）、
   *             band 天边画的远景用哪种（bandTexture 的 kind；null = 用以前的）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting）
   *   weather   室内的场景里天气怎么画（SHELTER；不写 = 照旧） */
  const ART = {
    outer_street: {
      palette: "street",
      decor: { band: 3, ledge: 2, size: [0.16, 0.22], kinds: ["barrel", "barrel", "tire"] },
      backdrop: { slum: true, pipes: true, cliffs: true, band: "desert" },
      // 黄沙反上来的暖光、带沙尘的雾；白天天色偏土黄，夜里棚屋透出暖光（SLUM.lit），路灯亮一点
      light: {
        all: { tint: { fog: [0xd8b47a, 0.25], hemiGround: [0xb08850, 0.35] } },
        day: { tint: { sky: [0xe8cf98, 0.18] }, grade: { temp: [1.06, 1.0, 0.9] } },
        dusk: { tint: { fog: [0xd0905a, 0.12] } },
        night: { tint: { hemiGround: [0x3a2c20, 0.3] }, scale: { lamp: 1.15 } }
      }
    },
    giant_road: {
      palette: "city",
      decor: { band: 3, ledge: 2, size: [0.15, 0.2], kinds: ["bollard", "bollard", "planter"] },
      backdrop: { city: true, band: "city" },
      // 蓝色调、干净：雾和环境光偏冷蓝，调色往蓝里拉一点、更通透；夜里灯火通明（灯更亮、环境光被城市的光照亮一些、曝光高一点）
      light: {
        all: { tint: { fog: [0x8eb2da, 0.32], hemiSky: [0xc4dcff, 0.3], hemiGround: [0x485a74, 0.4], rim: [0xbfe0ff, 0.3] }, grade: { temp: [0.94, 1.0, 1.08], sat: 1.04, vignette: 0.25 } },
        day: { tint: { sky: [0x9cc4ee, 0.38] } },
        dusk: { tint: { sky: [0x6a7ad8, 0.22], sun: [0xc8b8ff, 0.2] } },
        night: { tint: { sky: [0x14285a, 0.3], hemiSky: [0x5a8adf, 0.3] }, scale: { lamp: 1.5, hemi: 1.25, exposure: 1.08 } }
      }
    },
    skynet_yard: {
      palette: "bunker",
      decor: { band: 3, ledge: 2, size: [0.15, 0.2], kinds: ["barrel", "jersey", "post"] },
      backdrop: { bunker: true, band: "desert" },
      // 冷冷的灰：雾、天光往水泥灰靠，饱和度压低、对比拉高（硬核）；夜里探照灯、路灯更亮
      light: {
        all: { tint: { fog: [0xa4a8a6, 0.4], hemiSky: [0xe0e6ea, 0.3], hemiGround: [0x5c5e5a, 0.45], sun: [0xf4f6f8, 0.3] }, grade: { temp: [0.98, 1.0, 1.02], sat: 0.8, contrast: 1.12 } },
        day: { tint: { sky: [0xc0c8cc, 0.3] } },
        night: { scale: { lamp: 1.4 } }
      }
    },
    sewer_tunnel: {
      palette: "tunnel",
      decor: { band: 3, ledge: 2, size: [0.15, 0.2], kinds: ["valve", "barrel", "tire"] },
      backdrop: { tunnel: true, band: null },
      weather: SHELTER,
      // 管子里：不分白天黑夜（按夜晚画、光照固定），天是黑的（反正被管壁挡住）；环境光、主光压暗，偏一点污水的黄绿，灯更亮；调色更闷、暗角更重。
      // 截图验收（主人：「远景、近景都太暗」）：环境光、主光比上一版亮一点，暗角轻一点（整体还是昏暗，结构靠灯带、铆钉、倒影看清）
      light: {
        fixed: "night",
        all: {
          set: { sky: ["#141a15", "#0e130f", "#090c0a", "#050706"], fog: 0x121a11, ground: 0x2e362e, hemiSky: 0x9fb09a, hemiGround: 0x283022, sun: 0xd8e8b0, rim: 0xb8d0a0 },
          scale: { hemi: 1.1, sunI: 0.72, rimI: 0.75, lamp: 1.4 },
          grade: { temp: [0.97, 1.02, 0.93], sat: 0.94, contrast: 1.1, vignette: 0.42 }
        }
      }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    outer_street: {   // 外城区：黄沙地（车辙、脚印、零碎的垃圾），侧面拼起来的瓦楞铁皮；地台外面是沙地；路灯
      tex: "artSlumSand", tint: 0xffffff, side: "artSlumSheet", decals: { ripple: 3, gravel: 2, oil: 1 },
      pebbles: 12, pebble: 0xa08058, rock: 0x8c7052, decor: "sand", ground: 0xc29a62, backdrop: "outer_street",
      lamps: { kind: "street", color: 0xffc98a, day: 1, dusk: 2, night: 2 }
    },
    giant_road: {     // 巨人城：干净的沥青（车道虚线、井盖），侧面是路沿石；地台外面是马路（远景铺的）；冷白的路灯
      tex: "artCityAsphalt", tint: 0xffffff, rough: 0.72, side: "artCityCurb", decals: { grate: 1 },
      pebbles: 0, pebble: 0x5a6270, rock: 0x5a6270, decor: "clean", ground: 0x262c36, backdrop: "giant_road",
      lamps: { kind: "street", color: 0xd8ecff, day: 1, dusk: 2, night: 2 }
    },
    skynet_yard: {  // 天网设施：浇筑的混凝土板（模板缝、对拉螺栓孔），侧面是混凝土墙、底下一道黄黑警示带；地台外面是混凝土场地（远景铺的）；冷白的灯
      tex: "artBunkerSlab", tint: 0xffffff, rough: 0.92, side: "artBunkerWall", decals: { crack: 2, oil: 1 },
      pebbles: 4, pebble: 0x8a8a84, rock: 0x7a7a74, decor: "clean", ground: 0x7a7870, backdrop: "skynet_yard",
      lamps: { kind: "street", color: 0xe8f4ff, day: 1, dusk: 2, night: 2 }
    },
    sewer_tunnel: {   // 下水道：湿的混凝土板（青苔、污渍），侧面泡过水的混凝土；积水贴花；地台外面是污水（远景铺的）；两盏吊灯
      tex: "artSewerSlab", tint: 0xffffff, rough: 0.5, side: "artSewerSide", decals: { puddle: 3, crack: 2 },
      pebbles: 6, pebble: 0x4c5248, rock: 0x464c42, decor: "art", ground: 0x2a312a, backdrop: "sewer_tunnel",
      lamps: { kind: "hanging", color: 0xe4f0a8, day: 2, dusk: 2, night: 2 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "外城区": { street: "outer_street" },
    "巨人城": { city: "giant_road" },
    "天网设施": { facility: "skynet_yard" },
    "下水道": { tunnel: "sewer_tunnel" }
  };

  /* ---------- 小工具 ---------- */
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 11; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }
  /** 远景用的 canvas 贴图（远景的小工具里没有 canvasTex：在这里画，交给 env.keep 一起清） */
  function farTex(kit, env, size, draw, seed) {
    const THREE = kit.THREE, c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size, kit.rng(seed));
    const t = env.keep(new THREE.CanvasTexture(c));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    return t;
  }
  const hex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0");

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  /** 瓦楞铁皮：竖着一块块（宽窄、颜色不一），一道道楞（亮暗相间），上沿往下流的锈迹，接缝的阴影和一排铆钉。顶面、侧面、远景的棚屋都用它 */
  function drawSheet(g, s, r, cols) {
    let x = 0;
    while (x < s) {
      let w = Math.round(s * (0.18 + r() * 0.2));
      if (s - x - w < s * 0.12) w = s - x;
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, 0, w, s);
      const off = Math.round((r() - 0.5) * s * 0.3);   // 这块铁皮上下错开一点，横缝不齐
      for (let k = x + 2; k < x + w; k += 5) {
        g.fillStyle = "rgba(255,240,220,.16)"; g.fillRect(k, 0, 1.5, s);
        g.fillStyle = "rgba(20,12,6,.22)"; g.fillRect(k + 2.5, 0, 1.5, s);
      }
      for (let k = 0; k < 3; k++) {   // 锈迹：从上沿 / 钉眼往下流
        const rx = x + r() * w, len = s * (0.2 + r() * 0.5), grd = g.createLinearGradient(0, 0, 0, len);
        grd.addColorStop(0, "rgba(120,52,20,.55)"); grd.addColorStop(1, "rgba(120,52,20,0)");
        g.fillStyle = grd; g.fillRect(rx, 0, 2 + r() * 5, len);
      }
      g.fillStyle = "rgba(18,10,6,.5)"; g.fillRect(x, 0, 2, s);                     // 接缝
      g.fillStyle = "rgba(18,10,6,.35)"; g.fillRect(x, (s / 2 + off + s) % s, w, 2);   // 横缝
      g.fillStyle = "rgba(230,220,200,.6)";
      for (let y = 4; y < s; y += s / 4) g.fillRect(x + 3, y, 2, 2);                // 铆钉
      x += w;
    }
  }
  /** 黄黑警示条纹：在 (x, y, w, h) 里画 45° 的斜条（每条宽 k 像素），左右接得上 */
  function drawHazard(g, x, y, w, h, k) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = "#1c1c1a"; g.fillRect(x, y, w, h);
    g.fillStyle = "#f0c218";
    for (let i = -h; i < w + h; i += k * 2) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + k, y + h); g.lineTo(x + i + k + h, y); g.lineTo(x + i + h, y); g.fill(); }
    g.restore();
  }
  /** 浇筑的混凝土（天网设施）：灰色的底、深浅不一的几片，模板缝（一块块），每块上一排排对拉螺栓孔，零星的水渍、修补的痕迹 */
  function drawConcrete(g, s, r, kit, n) {
    g.fillStyle = "#a4a49c"; g.fillRect(0, 0, s, s);
    for (let k = 0; k < 10; k++) {
      const x = r() * s, y = r() * s, rad = 16 + r() * 40, grd = g.createRadialGradient(x, y, 0, x, y, rad), c = r() < 0.5 ? "190,190,182" : "120,120,114";
      grd.addColorStop(0, `rgba(${c},.35)`); grd.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    if (kit) kit.speckle(g, s, r, s * 10, "rgba(235,235,228,.14)", "rgba(40,40,36,.18)");
    const w = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = `rgba(${r() < 0.5 ? "255,255,250" : "30,30,28"},${0.03 + r() * 0.05})`; g.fillRect(i * w, j * w, w, w);   // 每块深浅不一
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {   // 对拉螺栓孔
        const hx = i * w + w * (0.28 + a * 0.44), hy = j * w + w * (0.28 + b * 0.44);
        g.fillStyle = "rgba(40,40,36,.7)"; g.beginPath(); g.arc(hx, hy, Math.max(1.5, w * 0.035), 0, 7); g.fill();
        g.fillStyle = "rgba(230,230,222,.35)"; g.fillRect(hx - 1, hy + Math.max(1.5, w * 0.035), 2, 1);
      }
    }
    g.fillStyle = "rgba(40,40,36,.55)";   // 模板缝
    for (let i = 0; i <= n; i++) { g.fillRect(i * w - 1, 0, 2, s); g.fillRect(0, i * w - 1, s, 2); }
  }
  const TEXTURES = {
    /** 黄沙地（外城区）：黄沙底、深浅不一的几片，风吹的沙纹，一道车辙（左右首尾相接）、一串脚印，零碎的垃圾（锈铁片、瓶盖、压扁的纸箱）和碎石 */
    artSlumSand: paint("artSlumSand", 256, (g, s, r, kit) => {
      g.fillStyle = "#d2aa6a"; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 14; k++) {
        const x = r() * s, y = r() * s, rad = 20 + r() * 50, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.5 ? "226,190,128" : "176,136,82";
        grd.addColorStop(0, `rgba(${c},.35)`); grd.addColorStop(1, `rgba(${c},0)`);
        [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }));
      }
      kit.speckle(g, s, r, 2600, "rgba(255,236,196,.2)", "rgba(110,76,36,.2)");
      g.lineWidth = 1.2;
      for (let k = 0; k < 9; k++) {   // 沙纹：横着的波浪线（周期 = 贴图宽，左右接得上）
        const y0 = r() * s, a = 2 + r() * 3, ph = r() * 7;
        g.strokeStyle = k % 2 ? "rgba(140,100,52,.22)" : "rgba(255,236,190,.22)";
        g.beginPath();
        for (let x = 0; x <= s; x += 4) g.lineTo(x, y0 + Math.sin(x / s * Math.PI * 4 + ph) * a);
        g.stroke();
      }
      const ty = s * 0.68;   // 车辙：两道压实的深色带子 + 一格格胎纹
      [0, 22].forEach(dy => {
        for (let x = 0; x < s; x += 3) {
          const y = ty + dy + Math.sin(x / s * Math.PI * 2) * 10;
          g.fillStyle = "rgba(120,86,46,.32)"; g.fillRect(x, y, 3, 9);
          if (x % 9 === 0) { g.fillStyle = "rgba(90,60,30,.3)"; g.fillRect(x, y + 1, 2, 7); }
        }
      });
      for (let k = 0; k < 7; k++) {   // 一串脚印
        const x = s * 0.15 + k * 18, y = s * 0.28 + (k % 2) * 8 + k * 5;
        g.fillStyle = "rgba(120,84,44,.35)"; g.beginPath(); g.ellipse(x, y, 3, 5.5, 0.5, 0, 7); g.fill();
      }
      for (let k = 0; k < 5; k++) {   // 锈铁片
        g.save(); g.translate(r() * s, r() * s); g.rotate(r() * 3);
        g.fillStyle = ["#7a4a2a", "#8a6a4a", "#5a6a6a"][k % 3]; g.fillRect(-6, -3, 10 + r() * 8, 5 + r() * 4);
        g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(-6, 2, 12, 1.5);
        g.restore();
      }
      for (let k = 0; k < 10; k++) { g.fillStyle = r() < 0.5 ? "#b8b0a0" : "#a84a30"; g.beginPath(); g.arc(r() * s, r() * s, 1.6, 0, 7); g.fill(); }   // 瓶盖
      g.save(); g.translate(s * 0.78, s * 0.2); g.rotate(0.4);   // 压扁的纸箱
      g.fillStyle = "#b08e62"; g.fillRect(-14, -9, 28, 18); g.strokeStyle = "rgba(80,56,30,.5)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke();
      g.restore();
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 6, 6 + Math.floor(r() * 6));
    }),
    /** 地台侧面（外城区）：拼起来的瓦楞铁皮 */
    artSlumSheet: paint("artSlumSheet", 128, (g, s, r) => drawSheet(g, s, r, ["#8c6a4e", "#7c7e7a", "#9c5c3c", "#6c8482", "#a58e66", "#84563e"])),
    /** 干净的沥青（巨人城）：偏蓝的深灰、细细的颗粒，中间一条白色的车道虚线、一边一条实线，一个井盖，几道浅浅的车辙 */
    artCityAsphalt: paint("artCityAsphalt", 256, (g, s, r, kit) => {
      g.fillStyle = CITY.road.color.asphalt; g.fillRect(0, 0, s, s);
      kit.speckle(g, s, r, 3200, "rgba(200,214,236,.1)", "rgba(8,12,20,.22)");
      for (let k = 0; k < 3; k++) { g.fillStyle = "rgba(20,26,36,.18)"; g.fillRect(0, s * (0.2 + k * 0.27) + r() * 8, s, 10 + r() * 6); }   // 车辙（很浅）
      g.fillStyle = hex(CITY.road.line);
      for (let x = 8; x < s; x += 64) g.fillRect(x, s * 0.5 - 3, 38, 6);   // 车道虚线（左右接得上）
      g.fillRect(0, s * 0.9, s, 5);                                        // 实线
      g.fillStyle = "rgba(255,255,255,.07)"; g.fillRect(0, s * 0.5 - 6, s, 2);
      const mx = s * 0.72, my = s * 0.24;   // 井盖：一圈铸铁 + 网格
      g.fillStyle = "#454d5a"; g.beginPath(); g.arc(mx, my, 15, 0, 7); g.fill();
      g.strokeStyle = "rgba(14,18,26,.8)"; g.lineWidth = 1.5;
      for (let k = -12; k <= 12; k += 4) { g.beginPath(); g.moveTo(mx + k, my - 13); g.lineTo(mx + k, my + 13); g.stroke(); g.beginPath(); g.moveTo(mx - 13, my + k); g.lineTo(mx + 13, my + k); g.stroke(); }
      g.strokeStyle = "rgba(170,184,204,.5)"; g.beginPath(); g.arc(mx, my, 15, 0, 7); g.stroke();
    }),
    /** 地台侧面（巨人城）：上面一条浅色的花岗岩路沿石（一块块），底下一道反光条，再下面是干净的蓝灰混凝土（模板的横缝） */
    artCityCurb: paint("artCityCurb", 128, (g, s, r, kit) => {
      g.fillStyle = "#7c8696"; g.fillRect(0, 0, s, s);
      kit.speckle(g, s, r, 700, "rgba(220,230,244,.12)", "rgba(20,26,36,.2)");
      for (let y = s * 0.45; y < s; y += s * 0.18) { g.fillStyle = "rgba(30,38,50,.25)"; g.fillRect(0, y, s, 1.5); }   // 模板的横缝
      g.fillStyle = hex(CITY.road.color.curb); g.fillRect(0, 0, s, s * 0.3);   // 路沿石
      for (let x = 0; x < s; x += 32) { g.fillStyle = "rgba(40,48,60,.45)"; g.fillRect(x, 0, 1.5, s * 0.3); }
      kit.speckle(g, s, r, 220, "rgba(255,255,255,.18)", "rgba(40,48,60,.18)");
      g.fillStyle = "#e8f6ff"; g.fillRect(0, s * 0.3, s, 3);                    // 反光条
      g.fillStyle = "rgba(95,216,255,.55)"; g.fillRect(0, s * 0.3 + 3, s, 1.5);
      const grd = g.createLinearGradient(0, s * 0.75, 0, s); grd.addColorStop(0, "rgba(16,22,32,0)"); grd.addColorStop(1, "rgba(16,22,32,.35)");
      g.fillStyle = grd; g.fillRect(0, s * 0.75, s, s * 0.25);
    }),
    /** 浇筑的混凝土板（天网设施）：两块 × 两块，模板缝、对拉螺栓孔，几道裂缝、一片油渍 */
    artBunkerSlab: paint("artBunkerSlab", 256, (g, s, r, kit) => {
      drawConcrete(g, s, r, kit, 2);
      g.strokeStyle = "rgba(50,50,46,.5)";
      for (let k = 0; k < 3; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 5), 1.1, 1);
      g.fillStyle = "rgba(40,36,30,.18)"; g.beginPath(); g.ellipse(s * 0.7, s * 0.3, 22, 12, 0.4, 0, 7); g.fill();
    }),
    /** 地台侧面（天网设施）：混凝土墙（一块块、螺栓孔），最底下一道黄黑警示带（侧面的贴图从地台底往上铺，底边就是贴图的下沿） */
    artBunkerWall: paint("artBunkerWall", 128, (g, s, r, kit) => {
      drawConcrete(g, s, r, kit, 2);
      drawHazard(g, 0, s * 0.86, s, s * 0.14, 9);
      g.fillStyle = "rgba(20,20,18,.5)"; g.fillRect(0, s * 0.86 - 2, s, 2);
    }),
    /** 湿的混凝土板（下水道）：一块块方板（颜色深浅不一、接缝发黑），湿的地方更深、反一点光，接缝和角落长青苔，零星的污渍和裂缝 */
    artSewerSlab: paint("artSewerSlab", 256, (g, s, r, kit) => {
      const n = 4, w = s / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const v = 92 + Math.floor(r() * 22);
        g.fillStyle = `rgb(${v - 6},${v},${v - 8})`; g.fillRect(i * w, j * w, w, w);
      }
      for (let k = 0; k < 9; k++) {   // 湿的一片片（更深）
        const x = r() * s, y = r() * s, rad = 16 + r() * 40, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, "rgba(30,38,30,.45)"); grd.addColorStop(1, "rgba(30,38,30,0)");
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      kit.speckle(g, s, r, 2400, "rgba(200,210,190,.12)", "rgba(20,26,18,.25)");
      g.fillStyle = "rgba(14,18,12,.75)";   // 接缝
      for (let i = 0; i <= n; i++) { g.fillRect(i * w - 2, 0, 4, s); g.fillRect(0, i * w - 2, s, 4); }
      g.fillStyle = "rgba(70,96,40,.45)";   // 接缝里的青苔
      for (let k = 0; k < 60; k++) { const i = Math.floor(r() * (n + 1)), t = r() * s, horiz = r() < 0.5; g.fillRect(horiz ? t : i * w - 3, horiz ? i * w - 3 : t, 3 + r() * 6, 3 + r() * 6); }
      g.strokeStyle = "rgba(16,20,14,.55)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 6), 1.2, 1);
      for (let k = 0; k < 5; k++) { g.fillStyle = "rgba(60,48,26,.3)"; g.beginPath(); g.ellipse(r() * s, r() * s, 6 + r() * 14, 4 + r() * 8, r() * 3, 0, 7); g.fill(); }   // 污渍
    }),
    /** 地台侧面（下水道）：泡过水的混凝土——横着几道水位线（下面更深更绿），往下流的水渍、青苔，零星露出的砖 */
    artSewerSide: paint("artSewerSide", 128, (g, s, r, kit) => {
      const grd = g.createLinearGradient(0, 0, 0, s);
      grd.addColorStop(0, "#6c7468"); grd.addColorStop(0.55, "#59625a"); grd.addColorStop(1, "#3a4636");
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
      kit.speckle(g, s, r, 900, "rgba(210,220,200,.1)", "rgba(16,22,14,.25)");
      [0.58, 0.72, 0.86].forEach((k, i) => { g.fillStyle = `rgba(40,52,26,${0.25 + i * 0.1})`; g.fillRect(0, s * k, s, 2 + i); });   // 水位线
      for (let k = 0; k < 10; k++) {   // 往下流的水渍
        const x = r() * s, len = s * (0.2 + r() * 0.5), y = r() * s * 0.4, w = 2 + r() * 4, gg = g.createLinearGradient(0, y, 0, y + len);
        gg.addColorStop(0, "rgba(24,30,20,.45)"); gg.addColorStop(1, "rgba(24,30,20,0)");
        g.fillStyle = gg; g.fillRect(x, y, w, len);
      }
      g.fillStyle = "rgba(80,110,46,.5)";   // 青苔（下半截多）
      for (let k = 0; k < 50; k++) { const y = s * (0.6 + Math.pow(r(), 0.6) * 0.4); g.fillRect(r() * s, y, 2 + r() * 5, 2 + r() * 4); }
      g.strokeStyle = "rgba(20,24,18,.35)"; g.lineWidth = 1;   // 露出的砖
      const bx = r() * s * 0.6, by = s * (0.15 + r() * 0.25);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g.strokeRect(bx + x * 14 + (y % 2) * 7, by + y * 8, 14, 8);
    })
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS）：这一版都用 hd2d-world.js 里现成的（沙纹、碎石、油渍） */
  const DECALS = {};

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.2);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    // 台子在外轮廓外面，但外轮廓往里凹的地方台子离站位区也近：装饰再小一点，横着离站位区至少 foot + 半径
    const room = (s) => Math.abs(s.x) - (z.w / 2 - L.CONFIG.pad) - A.SPOT.foot;
    return band.concat(ledge).map((s, i) => ({ kind: D.kinds[(i + z.id) % D.kinds.length], x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r, room(s)), on: s.on }))
      .filter(d => d.size >= D.size[0] * 0.75);
  }
  /** 一个油桶（半径 rad）：桶身 + 两道箍 + 桶盖，漆色掉了一半 */
  function barrel(kit, rad, col) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.6;
    g.add(kit.mesh(new THREE.CylinderGeometry(rad, rad, h, 10), kit.mat("art-barrel-" + col, col, { roughness: 0.75, metalness: 0.3 }), 0, h / 2, 0));
    [0.3, 0.7].forEach(k => g.add(kit.mesh(new THREE.CylinderGeometry(rad * 1.04, rad * 1.04, h * 0.05, 10), kit.mat("art-barrel-ring", 0x3a2e26, { roughness: 0.6, metalness: 0.5 }), 0, h * k, 0)));
    g.add(kit.mesh(new THREE.CylinderGeometry(rad * 0.98, rad * 0.98, 0.012, 10), kit.mat("art-barrel-lid", 0x4a3c30, { roughness: 0.7, metalness: 0.4 }), 0, h + 0.006, 0));
    return g;
  }
  /** 一个平躺着的旧轮胎（外半径 rad） */
  function tire(kit, rad, col) {
    const THREE = kit.THREE, m = kit.mesh(new THREE.TorusGeometry(rad * 0.72, rad * 0.28, 6, 12), kit.mat("art-tire", col, { roughness: 0.95 }), 0, rad * 0.28, 0);
    m.rotation.x = Math.PI / 2;
    return m;
  }
  /** 一个阀门（半径 rad 以内）：地上冒出来一截管子（底下一圈法兰），顶上一个红色的手轮 */
  function valve(kit, rad, P) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.4, pr = rad * 0.3;
    const pm = kit.mat("art-valve-pipe", P.pipe, { roughness: 0.7, metalness: 0.4 }), wm = kit.mat("art-valve-wheel", P.wheel, { roughness: 0.6, metalness: 0.3 });
    g.add(kit.mesh(new THREE.CylinderGeometry(pr * 1.7, pr * 1.7, rad * 0.16, 10), pm, 0, rad * 0.08, 0));
    g.add(kit.mesh(new THREE.CylinderGeometry(pr, pr, h, 8), pm, 0, h / 2, 0));
    const wheel = kit.mesh(new THREE.TorusGeometry(rad * 0.68, rad * 0.08, 5, 14), wm, 0, h + rad * 0.05, 0);
    wheel.rotation.x = Math.PI / 2; g.add(wheel);
    [0, Math.PI / 2].forEach(a => { const sp = kit.mesh(new THREE.BoxGeometry(rad * 1.36, rad * 0.06, rad * 0.07), wm, 0, h + rad * 0.05, 0); sp.rotation.y = a; g.add(sp); });
    return g;
  }
  /** 一根隔离桩（半径 rad 以内，巨人城）：银灰的圆柱、顶上一圈发光的蓝环（泛光会抓到） */
  function bollard(kit, rad, P) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 2.6, pr = rad * 0.42;
    g.add(kit.mesh(new THREE.CylinderGeometry(pr * 1.3, pr * 1.3, rad * 0.12, 12), kit.mat("art-bollard-base", P.post, { roughness: 0.4, metalness: 0.6 }), 0, rad * 0.06, 0));
    g.add(kit.mesh(new THREE.CylinderGeometry(pr * 0.92, pr, h, 12), kit.mat("art-bollard", P.post, { roughness: 0.35, metalness: 0.65 }), 0, h / 2, 0));
    const ring = kit.mesh(new THREE.CylinderGeometry(pr * 1.02, pr * 1.02, rad * 0.16, 12, 1, true), kit.mat("art-bollard-ring", P.ring, { emissive: new THREE.Color(P.ring).multiplyScalar(1.6), roughness: 0.3 }), 0, h * 0.82, 0);
    g.add(ring);
    return g;
  }
  /** 一个小花坛（半径 rad 以内，巨人城）：白水泥的矮方盒 + 一丛修得圆圆的矮灌木（比油桶矮，不挡后面的人） */
  function planter(kit, rad, P, R) {
    const THREE = kit.THREE, g = new THREE.Group(), w = rad * 1.4, h = rad * 0.7;
    g.add(kit.mesh(new THREE.BoxGeometry(w, h, w), kit.mat("art-planter", P.planter, { roughness: 0.8 }), 0, h / 2, 0));
    const bush = kit.mesh(new THREE.IcosahedronGeometry(rad * 0.55, 0), kit.mat("art-leaf", P.leaf[Math.floor(R() * P.leaf.length)], { roughness: 0.85 }), 0, h + rad * 0.25, 0);
    bush.scale.y = 0.7; g.add(bush);
    return g;
  }
  /** 天网设施的小东西用的黄黑警示条纹贴图 */
  const hazardTex = (kit) => kit.canvasTex("art-hazard", 64, (g, s) => drawHazard(g, 0, 0, s, s, 8));
  /** 一小段混凝土防撞墩（半径 rad 以内，天网设施）：底宽顶窄的两截，上面一道黄黑警示带 */
  function jersey(kit, rad, P) {
    const THREE = kit.THREE, g = new THREE.Group(), len = rad * 1.8, h = rad * 1.05, m = kit.mat("art-jersey", P.concrete, { roughness: 0.95 });
    g.add(kit.mesh(new THREE.BoxGeometry(rad * 0.75, h * 0.35, len), m, 0, h * 0.175, 0));
    g.add(kit.mesh(new THREE.BoxGeometry(rad * 0.4, h * 0.65, len), m, 0, h * 0.675, 0));
    g.add(kit.mesh(new THREE.BoxGeometry(rad * 0.42, h * 0.16, len * 1.004), kit.mat("art-hazard", 0xffffff, { map: hazardTex(kit), roughness: 0.8 }), 0, h * 0.75, 0));
    return g;
  }
  /** 一根黄黑条纹的警示桩（半径 rad 以内，天网设施），底下一块混凝土墩；比油桶矮（近景里不挡后面的人的脚下） */
  function hazardPost(kit, rad, P) {
    const THREE = kit.THREE, g = new THREE.Group(), h = rad * 1.7, pr = rad * 0.3;
    g.add(kit.mesh(new THREE.BoxGeometry(pr * 3, rad * 0.14, pr * 3), kit.mat("art-jersey", P.concrete, { roughness: 0.95 }), 0, rad * 0.07, 0));
    g.add(kit.mesh(new THREE.CylinderGeometry(pr, pr, h, 10), kit.mat("art-hazard", 0xffffff, { map: hazardTex(kit), roughness: 0.8 }), 0, h / 2 + rad * 0.14, 0));
    return g;
  }
  /** 地台上的各种装饰：kind → 做一个（半径 s，颜色从这一套的 PALETTE 里挑） */
  const PROPS = {
    barrel: (kit, s, P, R) => barrel(kit, s * 0.8, P.barrel[Math.floor(R() * P.barrel.length)]),
    tire: (kit, s, P) => tire(kit, s, P.tire),
    valve: (kit, s, P) => valve(kit, s, P),
    bollard: (kit, s, P) => bollard(kit, s, P),
    planter: (kit, s, P, R) => planter(kit, s, P, R),
    jersey: (kit, s, P) => jersey(kit, s, P),
    post: (kit, s, P) => hazardPost(kit, s, P)
  };
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了） */
  function zone(kit, g, z, ctx, r, look, a) {
    const P = PALETTE[a.art.palette], R = A.rand(z.id * 131 + seedOf(a.key));
    zonePlan(z, a.key).forEach(d => {
      const o = (PROPS[d.kind] || PROPS.barrel)(kit, d.size, P, R);
      o.position.set(d.x, d.y, d.z); o.rotation.y = R() * Math.PI * 2;
      o.userData.art = d.kind; o.userData.size = d.size;
      g.add(o);
    });
  }

  /* ---------- 远景：战场周围的贫民窟 ---------- */
  /**
   * 贫民窟里每一间摆在哪（纯函数，测试用同一份）：后面 SLUM.rows 几排、左右 SLUM.side 几列，都在战场范围外面（hd2d-scene-art.js · around）。
   * 每间的门朝着战场（后面的朝前、左右的朝里），屋顶往门那边多伸出一截（HUT.eave）：中心离边上再让开 HUT.eave × 进深。
   * 返回 [{ kind: "shack" / "house", x, z（中心）, w, h, d, rot }]
   */
  function slumPlan(b, seed) {
    const S = SLUM, k = S.scale || 1, R = A.rand(seed), at = A.around(b, S.margin), out = [];
    const one = (kind, x, z, rot, D) => out.push({ kind, x, z, w: D.w, h: D.h, d: D.d, rot, s: k });
    const size = () => { const kind = R() < S.houses ? "house" : "shack", D = S[kind]; return { kind, w: A.span(R, D.w) * k, h: A.span(R, D.h) * k, d: A.span(R, D.d) * k }; };
    S.rows.forEach((row, i) => {
      const from = at.cx - at.hx - S.reach * k, to = at.cx + at.hx + S.reach * k, step = row.step * k;
      for (let x = from + R() * step * 0.5; x < to; x += step * (1 + (R() - 0.5) * 2 * row.jitter)) {
        const D = size();
        one(D.kind, x, at.back - row.gap * k - HUT.eave * D.d - (i ? R() * 0.4 * k : 0), (R() - 0.5) * 0.25, D);
      }
    });
    [-1, 1].forEach(sx => S.side.forEach(col => {
      for (let z = at.back; z < at.cz;) {
        const D = size();
        z += D.w * 0.6;
        one(D.kind, at.cx + sx * (at.sideX + col.gap * k + HUT.eave * D.d), z, -sx * Math.PI / 2 + (R() - 0.5) * 0.2, D);
        z += D.w * 0.6 + col.step * k * 0.3 * R();
      }
    }));
    return out;
  }
  /** 远景的材质：铁皮（几种颜色各一个，贴瓦楞铁皮）、墙、屋顶、门洞 */
  function slumMats(kit, env, P, seed) {
    const THREE = kit.THREE, std = (color, map, opt) => env.keep(new THREE.MeshStandardMaterial(Object.assign({ color, map, roughness: 0.9, metalness: 0.15, flatShading: true }, opt || {})));
    const sheetTex = farTex(kit, env, 64, (g, s, r) => drawSheet(g, s, r, ["#d8d0c4", "#c4bcb0", "#e4dcd0"]), seed);
    const wallTex = farTex(kit, env, 64, (g, s, r) => {   // 土坯 / 砖墙：一行行错开的砖，抹的灰掉了几块
      g.fillStyle = "#e8e0d4"; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? -6 : 0; x < s; x += 12) { g.fillStyle = r() < 0.5 ? "#ddd4c6" : "#f2eade"; g.fillRect(x + 1, y + 1, 10, 6); }
      for (let k = 0; k < 4; k++) { g.fillStyle = "rgba(255,250,240,.5)"; g.fillRect(r() * s, r() * s, 10 + r() * 14, 8 + r() * 10); }
    }, seed + 7);
    return {
      sheet: P.sheet.map(c => std(c, sheetTex)), wall: P.wall.map(c => std(c, wallTex, { metalness: 0 })),
      roof: P.roof.map(c => std(c, sheetTex)), dark: std(P.dark, null, { roughness: 1, metalness: 0 }),
      glow: env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(SLUM.glow).multiplyScalar(1.8), toneMapped: false, fog: false })),
      lit: SLUM.lit[env.theme] || 0
    };
  }
  /** 一间铁皮棚屋 / 矮房子：方盒子（铁皮的 / 砖墙的），单坡屋顶往前伸出一截，前面一个黑门洞、矮房子再开一两个窗洞；屋顶上压几块石头 */
  function hut(kit, M, h, R) {
    const THREE = kit.THREE, g = new THREE.Group(), pick = (list) => list[Math.floor(R() * list.length)], k = h.s || 1;   // k：SLUM.scale（屋顶厚、烟囱粗跟着放大）
    const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), h.kind === "house" ? pick(M.wall) : pick(M.sheet));
    body.position.y = h.h / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(h.w * HUT.roof.w, 0.05 * k, h.d * HUT.roof.d), pick(M.roof));
    roof.position.set(0, h.h + 0.05 * k, h.d * HUT.lean); roof.rotation.x = HUT.tilt[h.kind]; g.add(roof);
    const hole = () => (R() < M.lit ? M.glow : M.dark);   // 傍晚 / 夜里一部分透出暖光
    const door = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.door[0], h.h * HUT.door[1]), hole());
    door.position.set((R() - 0.5) * h.w * 0.4, h.h * HUT.door[1] / 2, h.d / 2 + 0.006); g.add(door);
    if (h.kind === "house") {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(h.w * HUT.win[0], h.h * HUT.win[1]), hole());
      win.position.set(door.position.x > 0 ? -h.w * 0.25 : h.w * 0.25, h.h * 0.6, h.d / 2 + 0.006); g.add(win);
    } else if (R() < SLUM.flue) {   // 棚屋顶上的烟囱管
      const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * k, 0.045 * k, h.h * 0.5, 6), M.dark);
      flue.position.set((R() - 0.5) * h.w * 0.6, h.h * 1.2, -h.d * 0.2); g.add(flue);
    }
    return g;
  }
  /** 外城区：战场周围一圈矮房子、铁皮棚屋 */
  function slumScene(kit, env, art, P, b, seed) {
    const M = slumMats(kit, env, P, seed), R = A.rand(seed + 3);
    slumPlan(b, seed).forEach(h => {
      const o = hut(kit, M, h, R);
      o.position.set(h.x, L.CONFIG.groundY, h.z); o.rotation.y = h.rot;
      env.group.add(tag(o, h.kind));
    });
  }

  /** 横穿整个画面的大管道（FAR.pipes）：一根根架在支架（两条腿 + 托住管子的横梁）上，每隔一段一道法兰；
   *  前面那根上几盏红灯一闪一闪（减少动态效果时一直亮着）。法兰、支架是实例网格 */
  function bigPipes(kit, env, R) {
    const THREE = kit.THREE, F = FAR, y0 = L.CONFIG.groundY, from = env.cx - env.hx - F.cliff.reach, to = env.cx + env.hx + F.cliff.reach, len = to - from;
    const o = new THREE.Object3D();
    F.pipes.forEach((p, i) => {
      const z = env.skyZ + p.sky, hm = Math.max(1, env.topY(z) * 0.84), r = Math.max(p.min, hm * p.r), y = y0 + Math.max(hm * p.y, r * 2.4), M = env.mats(p.k), g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14, 1, true), M.body), (from + to) / 2, y, z));
      g.children[0].rotation.z = Math.PI / 2;
      const nF = Math.floor(len / F.flange), fl = new THREE.InstancedMesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.22, 14), M.dark, nF);
      for (let k = 0; k < nF; k++) { o.position.set(from + (k + 0.5) * F.flange, y, z); o.rotation.set(0, 0, Math.PI / 2); o.updateMatrix(); fl.setMatrixAt(k, o.matrix); }
      const nL = Math.floor(len / F.legs), legH = y - r * 0.9 - y0;
      const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.22, legH, r * 0.22), M.dark, nL * 2);
      const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(r * 0.3, r * 0.25, r * 2.4), M.dark, nL);
      for (let k = 0; k < nL; k++) {
        const x = from + (k + 0.5) * F.legs + (R() - 0.5) * 0.6;
        [-1, 1].forEach((s, j) => { o.position.set(x, y0 + legH / 2, z + s * r * 0.9); o.rotation.set(s * 0.12, 0, 0); o.updateMatrix(); legs.setMatrixAt(k * 2 + j, o.matrix); });
        o.position.set(x, y - r * 0.95, z); o.rotation.set(0, 0, 0); o.updateMatrix(); beams.setMatrixAt(k, o.matrix);
      }
      g.add(fl, legs, beams);
      env.group.add(tag(g, "pipe"));
      if (i === 0) for (let k = 0; k < F.warn; k++) env.blinker(env.cx + (k / Math.max(1, F.warn - 1) - 0.5) * env.hx * 1.6 + (R() - 0.5), y + r + 0.12, z, R());
    });
  }
  /** 沙岩悬崖（FAR.cliff）：一段段、一层层沙岩（沙色 / 岩色轮着，越往上越往里收），顶上高低错落；战场左右两边外面的更高，像夹着这片贫民窟的峡谷。
   *  用远景最远那层的材质（偏雾色） */
  function sandCliffs(kit, env, R) {
    const C = FAR.cliff, z = env.skyZ + C.sky, hm = Math.max(1, env.topY(z) * 0.84), M = env.mats(1), g = new kit.THREE.Group();
    const from = env.cx - env.hx - C.reach, to = env.cx + env.hx + C.reach;
    for (let x = from; x < to;) {
      const w = A.span(R, C.w), wing = Math.abs(x + w / 2 - env.cx) > env.hx + 2 ? C.wings : 1;
      const h = hm * A.span(R, C.h) * wing, n = Math.round(A.span(R, C.layers));
      let y = L.CONFIG.groundY;
      for (let i = 0; i < n; i++) {
        const hh = h / n * (0.75 + R() * 0.5), k = 1 - i * C.inset;
        g.add(kit.box(i % 2 ? M.rock : M.sand, w * k, hh, C.d * k, x + w / 2, y + hh / 2, z + (R() - 0.5) * 0.2));
        y += hh;
      }
      x += w * (0.85 + R() * 0.2);
    }
    env.group.add(tag(g, "cliff"));
  }

  /* ---------- 远景：巨人城（大马路 + 两边冲出画面的高楼 + 马路尽头的玻璃巨幕楼）---------- */
  /** 盒子的贴图坐标按世界大小铺（一张贴图管 tile × tile）：六个面（+x −x +y −y +z −z）各按自己的宽高 */
  function boxUV(geo, w, h, d, tile) {
    const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tile, uv.getY(k) * dims[f][1] / tile); }
    uv.needsUpdate = true;
    return geo;
  }
  const shade = (c, k) => hex(A.scaleHex(c, k));
  /** 幕墙的材质（几种颜色各一个）：一块块玻璃（上亮下暗的渐变）、竖框横框，白天一道斜着的天光反射；傍晚 / 夜里几成的窗亮着（自发光贴图） */
  function glassMats(kit, env, seed) {
    const THREE = kit.THREE, G = CITY.glass, th = G[env.theme] ? env.theme : "day", lit = G.lit[th] || 0, n = G.panels;
    return G[th].map((col, i) => {
      const map = farTex(kit, env, 256, (g, s, r) => {
        const cw = s / n;
        for (let cx = 0; cx < n; cx++) for (let cy = 0; cy < n; cy++) {
          const grd = g.createLinearGradient(0, cy * cw, 0, (cy + 1) * cw), k = 0.9 + r() * 0.2;
          grd.addColorStop(0, shade(col, 1.2 * k)); grd.addColorStop(1, shade(col, 0.8 * k));
          g.fillStyle = grd; g.fillRect(cx * cw, cy * cw, cw, cw);
        }
        if (th === "day") { g.fillStyle = "rgba(255,255,255,.14)"; g.beginPath(); g.moveTo(s * 0.2, 0); g.lineTo(s * 0.55, 0); g.lineTo(s * 0.15, s); g.lineTo(-s * 0.2, s); g.fill(); }
        g.fillStyle = "rgba(16,24,38,.8)";   // 竖框、横框
        for (let k = 0; k <= n; k++) { g.fillRect(k * cw - 1, 0, 2, s); g.fillRect(0, k * cw - 2, s, 4); }
      }, seed + i * 7);
      const opt = { map, roughness: 0.2, metalness: 0.55, flatShading: true, fog: false };
      if (lit > 0) {
        opt.emissiveMap = farTex(kit, env, 256, (g, s, r) => {
          const cw = s / n;
          g.fillStyle = "#000"; g.fillRect(0, 0, s, s);
          for (let cx = 0; cx < n; cx++) for (let cy = 0; cy < n; cy++) if (r() < lit) { g.fillStyle = r() < 0.6 ? "#ffe6bc" : "#cfe4ff"; g.fillRect(cx * cw + 2, cy * cw + 3, cw - 4, cw - 6); }
        }, seed + i * 7 + 3);
        opt.emissive = 0xffffff; opt.emissiveIntensity = G.glow[th];
      }
      return env.keep(new THREE.MeshStandardMaterial(opt));
    });
  }
  /** 广告屏的材质：每套配色两张画面（换着放）——斜着的渐变底、一个大圆 / 一道斜条、几行「字」、白边、扫描线。自己发光（泛光会抓到） */
  function adMats(kit, env, seed) {
    const THREE = kit.THREE, AD = CITY.ads, k = AD.bright[env.theme] || AD.bright.day;
    return AD.colors.map((cs, i) => [0, 1].map(f => {
      const map = farTex(kit, env, 128, (g, s, r) => {
        const grd = g.createLinearGradient(0, 0, s, s); grd.addColorStop(0, cs[f]); grd.addColorStop(1, cs[1 - f]);
        g.fillStyle = grd; g.fillRect(0, 0, s, s);
        g.fillStyle = "rgba(255,255,255,.85)";
        if ((i + f) % 2) { g.beginPath(); g.arc(s * (0.3 + r() * 0.4), s * (0.28 + r() * 0.2), s * 0.2, 0, 7); g.fill(); }
        else { g.save(); g.translate(s / 2, s * 0.35); g.rotate(-0.5); g.fillRect(-s, -s * 0.08, 2 * s, s * 0.16); g.restore(); }
        for (let j = 0; j < 3; j++) { g.fillStyle = `rgba(255,255,255,${0.9 - j * 0.2})`; g.fillRect(s * 0.1, s * (0.64 + j * 0.1), s * (0.8 - j * 0.2 - r() * 0.1), s * 0.05); }
        g.strokeStyle = "rgba(255,255,255,.6)"; g.lineWidth = 3; g.strokeRect(2, 2, s - 4, s - 4);
        g.fillStyle = "rgba(0,0,0,.12)"; for (let y = 0; y < s; y += 4) g.fillRect(0, y, s, 1);
      }, seed + i * 13 + f);
      map.magFilter = THREE.LinearFilter;
      return env.keep(new THREE.MeshBasicMaterial({ map, color: new THREE.Color(k, k, k), toneMapped: false, fog: false }));
    }));
  }
  /** 一栋玻璃楼（t = { x, z, w, h, d, face: { x, z }（朝着马路那面的方向）, glass, ad }）：底下深色石材的裙楼、朝着马路那面一条门厅玻璃，
   *  玻璃塔身（幕墙按世界大小铺），朝着马路那面两个楼角各一条竖着的灯带；ad = 那面挂一块广告屏（隔几秒换一张画面，减少动态效果时不换） */
  function glassTower(kit, env, M, t, R) {
    const THREE = kit.THREE, y0 = L.CONFIG.groundY, P = CITY.podium, F = CITY.fin, g = new THREE.Group(), f = t.face;
    g.add(kit.put(new THREE.Mesh(boxUV(new THREE.BoxGeometry(t.w, t.h, t.d), t.w, t.h, t.d, CITY.glass.tile), M.glass[t.glass % M.glass.length]), t.x, y0 + t.h / 2, t.z));
    g.add(kit.box(M.podium, t.w + P.out * 2, P.h, t.d + P.out * 2, t.x, y0 + P.h / 2, t.z));
    const along = f.x ? t.d : t.w, onFace = (out) => ({ x: t.x + f.x * (t.w / 2 + out), z: t.z + f.z * (t.d / 2 + out) }), rotY = f.x ? f.x * Math.PI / 2 : 0;
    const lobby = new THREE.Mesh(new THREE.PlaneGeometry(along * 0.8, P.h * P.lobby), M.lobby), lp = onFace(P.out + 0.01);
    lobby.position.set(lp.x, y0 + P.h * 0.42, lp.z); lobby.rotation.y = rotY; g.add(lobby);
    [-1, 1].forEach(s => {
      const c = onFace(0), fh = t.h - P.h;
      g.add(kit.box(M.fin, F.w, fh, F.w, c.x + (f.x ? 0 : s * t.w / 2), y0 + P.h + fh / 2, c.z + (f.x ? s * t.d / 2 : 0)));
    });
    if (t.ad) {
      const AD = CITY.ads, top = env.topY(t.z), pair = M.ads[t.ad.set % M.ads.length], ap = onFace(0.03);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(along * AD.w, Math.max(1.5, top * AD.h)), pair[0]);
      scr.position.set(ap.x, y0 + Math.max(P.h + 0.5, top * AD.at) + Math.max(1.5, top * AD.h) / 2, ap.z); scr.rotation.y = rotY;
      scr.userData.art = "adScreen";
      g.add(scr);
      let wait = A.span(R, AD.every), on = 0;
      env.anims.push((tt, dt) => {
        if (!(dt > 0) || (wait -= dt) > 0) return;
        on = 1 - on; scr.material = pair[on]; wait = A.span(R, AD.every);
      });
    }
    return g;
  }
  /** 马路（平铺在地面上，不算「装饰」，userData.road）：沥青 + 一道道车道虚线（贴图一张管一条车道宽、两段虚线长），两边的实线；
   *  路沿、人行道（「装饰」，在战场左右外面）一直从马路尽头铺到镜头后面 */
  function cityRoad(kit, env, RW, zBack, zFront, seed) {
    const THREE = kit.THREE, C = CITY.road, y0 = L.CONFIG.groundY, len = zFront - zBack, zc = (zBack + zFront) / 2;
    const tex = farTex(kit, env, 128, (g, s, r) => {
      g.fillStyle = C.color.asphalt; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 900; k++) { g.fillStyle = r() < 0.5 ? "rgba(210,222,240,.06)" : "rgba(6,10,18,.16)"; g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2); }
      g.fillStyle = hex(C.line); g.fillRect(0, s * 0.25, Math.max(2, s * 0.035), s * C.dash);   // 车道虚线（贴图的左边沿 = 一条车道的分界）
    }, seed + 3);
    tex.repeat.set(RW * 2 / C.lane, len / (C.lane * 2));
    const road = new THREE.Mesh(new THREE.PlaneGeometry(RW * 2, len), env.keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.05, fog: true })));
    road.rotation.x = -Math.PI / 2; road.position.set(env.cx, y0 + 0.012, zc); road.receiveShadow = true; road.userData.road = "asphalt";
    env.group.add(road);
    const lineM = env.keep(new THREE.MeshStandardMaterial({ color: C.line, roughness: 0.6, fog: true }));
    [-1, 1].forEach(sx => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(C.edge.w, len), lineM);
      l.rotation.x = -Math.PI / 2; l.position.set(env.cx + sx * (RW - C.edge.at), y0 + 0.016, zc); l.userData.road = "line";
      env.group.add(l);
    });
    const walkTex = farTex(kit, env, 64, (g, s, r) => {
      g.fillStyle = C.color.walk; g.fillRect(0, 0, s, s);
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) { g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.07})`; g.fillRect(k * 16 + 1, j * 16 + 1, 14, 14); }
      g.fillStyle = "rgba(40,48,62,.45)"; for (let k = 0; k <= 4; k++) { g.fillRect(k * 16 - 0.5, 0, 1, s); g.fillRect(0, k * 16 - 0.5, s, 1); }
    }, seed + 5);
    walkTex.repeat.set(C.walk / (C.tile * 4), len / (C.tile * 4));
    const curbM = env.keep(new THREE.MeshStandardMaterial({ color: C.color.curb, roughness: 0.7, fog: true }));
    const walkM = env.keep(new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.85, fog: true }));
    [-1, 1].forEach(sx => {
      env.group.add(tag(kit.box(curbM, C.curb.w, C.curb.h, len, env.cx + sx * (RW + C.curb.w / 2), y0 + C.curb.h / 2, zc), "curb"));
      env.group.add(tag(kit.box(walkM, C.walk - C.curb.w, C.curb.h * 0.8, len, env.cx + sx * (RW + C.curb.w + (C.walk - C.curb.w) / 2), y0 + C.curb.h * 0.4, zc), "sidewalk"));
    });
  }
  /** 巨人城：马路、两边冲出画面的高楼（每边从马路尽头排到战场前面）、马路尽头一排玻璃巨幕楼；楼上挂着广告屏 */
  function cityScene(kit, env, seed) {
    const THREE = kit.THREE, C = CITY, R = A.rand(seed + 61), RW = env.hx + C.road.margin, walk = C.road.walk;
    const zBack = env.skyZ + 0.9, zFront = env.cz + env.hz + 40;
    cityRoad(kit, env, RW, zBack, zFront, seed);
    const th = env.theme, M = {
      glass: glassMats(kit, env, seed + 11), ads: adMats(kit, env, seed + 19),
      podium: env.keep(new THREE.MeshStandardMaterial({ color: 0x353e4c, roughness: 0.55, metalness: 0.3, flatShading: true, fog: false })),
      lobby: env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdff0ff).multiplyScalar(th === "night" ? 1.7 : th === "dusk" ? 1.25 : 0.75), toneMapped: false, fog: false })),
      fin: env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(C.fin.color).multiplyScalar(C.fin.bright[th] || C.fin.bright.day), toneMapped: false, fog: false }))
    };
    let ad = 0;
    // 两边：人行道外面一栋挨一栋，从马路尽头排到战场前面；高 = 那里画面上沿的高度 × tall（冲出画面）
    [-1, 1].forEach(sx => {
      for (let z = env.skyZ + C.side.sky, end = env.cz + env.hz + C.side.front; z < end;) {
        const w = A.span(R, C.side.w), d = A.span(R, C.side.d), zc = z + d / 2;
        const t = { x: env.cx + sx * (RW + walk + C.podium.out + w / 2), z: zc, w, d, h: Math.max(C.side.min, env.topY(zc) * A.span(R, C.side.tall)), face: { x: -sx, z: 0 }, glass: Math.floor(R() * 4) };
        if (R() < C.ads.side) t.ad = { set: ad++ };
        env.group.add(tag(glassTower(kit, env, M, t, A.rand(seed + 97 + ad * 5 + Math.round(zc * 3))), "tower"));
        z += d + A.span(R, C.side.gap);
      }
    });
    // 马路尽头：一排玻璃巨幕楼，往战场左右各铺出去 reach
    const zb = env.skyZ + C.back.sky + C.back.d / 2;
    for (let x = env.cx - RW - walk - C.back.reach, end = env.cx + RW + walk + C.back.reach; x < end;) {
      const w = A.span(R, C.back.w), t = { x: x + w / 2, z: zb, w, d: C.back.d, h: Math.max(C.back.min, env.topY(zb) * A.span(R, C.back.tall)), face: { x: 0, z: 1 }, glass: Math.floor(R() * 4) };
      if (R() < C.ads.back) t.ad = { set: ad++ };
      env.group.add(tag(glassTower(kit, env, M, t, A.rand(seed + 131 + ad * 7 + Math.round(t.x * 3))), "glassTower"));
      x += w + A.span(R, C.back.gap);
    }
  }

  /* ---------- 远景：天网设施（混凝土场地、警示线、掩体、墙和铁丝网、围栏、探照灯塔、墙后的混凝土大楼）---------- */
  /** 一条平铺在地上的黄黑警示线（长 len、宽 w，沿 x 或沿 z），贴图按长度铺 */
  function hazardStrip(kit, env, tex, len, w, x, z, alongZ) {
    const THREE = kit.THREE, t = env.keep(tex.clone());
    t.needsUpdate = true; t.repeat.set(alongZ ? 1 : len / w, alongZ ? len / w : 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(alongZ ? w : len, alongZ ? len : w), env.keep(new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 })));
    m.rotation.x = -Math.PI / 2; m.position.set(x, L.CONFIG.groundY + 0.018, z); m.userData.yard = "hazard";
    env.group.add(m);
    return m;
  }
  /** 天网设施：混凝土场地 + 战场四周的警示线（平铺，不算「装饰」）；后面一排掩体、一道墙（墙脚警示带、墙头蛇腹铁丝网）、墙后的混凝土大楼；
   *  左右的铁丝网围栏；墙边的探照灯塔（顶上一盏红灯） */
  function bunkerScene(kit, env, seed) {
    const THREE = kit.THREE, BK = BUNKER, y0 = L.CONFIG.groundY, R = A.rand(seed + 71), b = boundsOf(env), at = A.around(b, { back: BK.bunker.gap, side: BK.fence.gap }), th = env.theme;
    const concTex = farTex(kit, env, 128, (g, s, r) => drawConcrete(g, s, r, null, 2), seed + 3);
    const hazTex = farTex(kit, env, 64, (g, s) => drawHazard(g, 0, 0, s, s, 8), seed + 4);
    const M = {
      conc: env.keep(new THREE.MeshStandardMaterial({ map: concTex, roughness: 0.95, flatShading: true })),
      far: env.keep(new THREE.MeshStandardMaterial({ map: concTex, color: 0x9a9c98, roughness: 0.95, flatShading: true, fog: false })),
      dark: env.keep(new THREE.MeshStandardMaterial({ color: 0x5c5e5a, roughness: 0.95, flatShading: true })),
      slit: env.keep(new THREE.MeshBasicMaterial({ color: 0x0c0d0c })),
      win: env.keep(new THREE.MeshBasicMaterial({ color: th === "night" ? new THREE.Color(0xffd9a0).multiplyScalar(1.4) : th === "dusk" ? new THREE.Color(0xffd9a0).multiplyScalar(0.8) : new THREE.Color(0x16181a), toneMapped: false, fog: false })),
      haz: env.keep(new THREE.MeshStandardMaterial({ map: hazTex, roughness: 0.8 })),
      wire: env.keep(new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.4, metalness: 0.8 }))
    };
    const W = BK.wall, x0 = env.cx - env.hx - W.reach, x1 = env.cx + env.hx + W.reach, len = x1 - x0;
    const zBunker = at.back - BK.bunker.d / 2, zWall = at.back - BK.bunker.d - W.gap - W.d / 2, zFront = env.cz + env.hz + 40;
    // 场地：一块块混凝土，从墙脚一直铺到镜头后面
    const yt = farTex(kit, env, 128, (g, s, r) => drawConcrete(g, s, r, null, 1), seed + 5);
    yt.repeat.set(len / BK.yard.tile, (zFront - zWall) / BK.yard.tile);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(len, zFront - zWall), env.keep(new THREE.MeshStandardMaterial({ map: yt, color: 0xb4b4ac, roughness: 0.95 })));
    yard.rotation.x = -Math.PI / 2; yard.position.set((x0 + x1) / 2, y0 + 0.012, (zWall + zFront) / 2); yard.receiveShadow = true; yard.userData.yard = "concrete";
    env.group.add(yard);
    // 战场四周的黄黑警示线
    const HZ = BK.yard.hazard, e = HZ.at + HZ.w / 2, wx = b.maxX - b.minX + 2 * e + HZ.w, wz = b.maxZ - b.minZ + 2 * e - HZ.w;
    [b.minZ - e, b.maxZ + e].forEach(z => hazardStrip(kit, env, hazTex, wx, HZ.w, env.cx, z, false));
    [b.minX - e, b.maxX + e].forEach(x => hazardStrip(kit, env, hazTex, wz, HZ.w, x, env.cz, true));
    // 掩体：一排低矮的混凝土盒子（射击孔、顶上一块厚板、前面两个角刷警示条纹）
    for (let i = 0; i < BK.bunker.n; i++) {
      const w = A.span(R, BK.bunker.w), h = BK.bunker.h, d = BK.bunker.d, x = env.cx + ((i + 0.5) / BK.bunker.n * 2 - 1) * env.hx * 0.8 + (R() - 0.5) * 1.2, g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 2), M.conc), x, y0 + h / 2, zBunker));
      g.add(kit.box(M.dark, w + 0.3, 0.2, d + 0.3, x, y0 + h + 0.1, zBunker));
      g.add(kit.box(M.slit, w * 0.55, 0.16, 0.06, x, y0 + BK.bunker.slit, zBunker + d / 2 + 0.01));
      [-1, 1].forEach(s => g.add(kit.box(M.haz, 0.14, h, 0.14, x + s * (w / 2 - 0.05), y0 + h / 2, zBunker + d / 2 - 0.05)));
      env.group.add(tag(g, "bunker"));
    }
    // 墙：一块块预制板（实例网格），墙脚一道黄黑警示带
    const H = Math.max(W.min, env.topY(zWall) * W.h), nP = Math.ceil(len / W.panel), wall = new THREE.Group(), o = new THREE.Object3D();
    const panels = new THREE.InstancedMesh(boxUV(new THREE.BoxGeometry(W.panel - 0.05, H, W.d), W.panel - 0.05, H, W.d, 2), M.conc, nP);
    for (let k = 0; k < nP; k++) { o.position.set(x0 + (k + 0.5) * W.panel, y0 + H / 2, zWall); o.rotation.set(0, 0, 0); o.updateMatrix(); panels.setMatrixAt(k, o.matrix); }
    wall.add(panels);
    const bt = env.keep(hazTex.clone()); bt.needsUpdate = true; bt.repeat.set(len / W.band, 1);
    wall.add(kit.put(new THREE.Mesh(new THREE.PlaneGeometry(len, W.band), env.keep(new THREE.MeshStandardMaterial({ map: bt, roughness: 0.85 }))), (x0 + x1) / 2, y0 + 0.3 + W.band / 2, zWall + W.d / 2 + 0.01));
    env.group.add(tag(wall, "wall"));
    // 墙头的蛇腹铁丝网：一圈圈铁丝（实例网格），圈和圈错开一点角度
    const WR = W.wire, nW = Math.floor(len / WR.step), coil = new THREE.InstancedMesh(new THREE.TorusGeometry(WR.r, 0.014, 3, 14), M.wire, nW);
    for (let k = 0; k < nW; k++) { o.position.set(x0 + (k + 0.5) * WR.step, y0 + H + WR.r * 0.9, zWall); o.rotation.set(0, Math.PI / 2 + (k % 2 ? 0.25 : -0.25), 0); o.updateMatrix(); coil.setMatrixAt(k, o.matrix); }
    env.group.add(tag(coil, "razorWire"));
    // 左右的铁丝网围栏：桩、铁丝网（透明的菱形网格）、顶上往外斜伸出去的几道带刺铁丝
    const F = BK.fence, fz0 = zWall + W.d / 2, fz1 = env.cz + env.hz + 1, flen = fz1 - fz0;
    const meshTex = farTex(kit, env, 64, (g, s) => {
      g.clearRect(0, 0, s, s); g.strokeStyle = "rgba(200,206,210,1)"; g.lineWidth = 2;
      for (let k = -s; k <= s; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + s, s); g.stroke(); g.beginPath(); g.moveTo(k + s, 0); g.lineTo(k, s); g.stroke(); }
    }, seed + 6);
    meshTex.repeat.set(flen / 0.6, F.h / 0.6);
    const meshM = env.keep(new THREE.MeshStandardMaterial({ map: meshTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5, color: 0xb8bcc0 }));
    [-1, 1].forEach(sx => {
      const x = env.cx + sx * at.sideX, g = new THREE.Group(), nPost = Math.floor(flen / F.post) + 1;
      const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, F.h + 0.4, 6), M.wire, nPost);
      for (let k = 0; k < nPost; k++) { o.position.set(x, y0 + (F.h + 0.4) / 2, fz0 + k * F.post); o.rotation.set(0, 0, sx * -0.12); o.updateMatrix(); posts.setMatrixAt(k, o.matrix); }
      g.add(posts);
      const net = kit.put(new THREE.Mesh(new THREE.PlaneGeometry(flen, F.h), meshM), x, y0 + F.h / 2, (fz0 + fz1) / 2);
      net.rotation.y = Math.PI / 2; g.add(net);
      for (let k = 0; k < F.strands; k++) {
        const s = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, flen, 4), M.wire), x + sx * F.lean * (k + 1) / F.strands, y0 + F.h + 0.12 * (k + 1), (fz0 + fz1) / 2);
        s.rotation.x = Math.PI / 2; g.add(s);
      }
      env.group.add(tag(g, "fence"));
    });
    // 墙后的混凝土大楼：方方正正的大块头，几道窄窄的窗带（夜里亮）
    for (let i = 0; i < BK.block.n; i++) {
      const w = A.span(R, BK.block.w), d = 3, z = env.skyZ + BK.block.sky + d / 2, h = env.topY(z) * A.span(R, BK.block.h), x = env.cx + ((i + 0.5) / BK.block.n * 2 - 1) * (env.hx + 8) + (R() - 0.5) * 2, g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 3), M.far), x, y0 + h / 2, z));
      for (let k = 1; k <= 3; k++) g.add(kit.box(M.win, w * 0.8, 0.12, 0.05, x, y0 + h * (0.25 + k * 0.17), z + d / 2 + 0.01));
      env.group.add(tag(g, "block"));
    }
    // 探照灯塔：墙后一根灯杆、横担上两盏灯（自己发光 + 一团光晕），顶上一盏红灯一闪一闪
    const FL = BK.flood, k = FL.bright[th] || FL.bright.day, head = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(FL.color).multiplyScalar(k), toneMapped: false, fog: false }));
    const glowTex = farTex(kit, env, 64, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(0.3, "rgba(255,255,255,.3)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }, seed + 8);
    FL.at.forEach(u => {
      const x = env.cx + u * env.hx, z = zWall - W.d / 2 - 0.6, h = Math.max(H + 1.5, env.topY(z) * FL.h), g = new THREE.Group();
      g.add(kit.cyl(M.dark, 0.12, 0.16, h, x, y0 + h / 2, z, 8));
      g.add(kit.box(M.dark, 1.6, 0.12, 0.12, x, y0 + h - 0.2, z));
      [-0.55, 0.55].forEach(dx => {
        g.add(kit.box(M.dark, 0.5, 0.36, 0.3, x + dx, y0 + h, z));
        g.add(kit.box(head, 0.42, 0.28, 0.02, x + dx, y0 + h, z + 0.16));
        const sp = new THREE.Sprite(env.keep(new THREE.SpriteMaterial({ map: glowTex, color: FL.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: th === "day" ? 0.35 : 0.8 })));
        sp.position.set(x + dx, y0 + h, z + 0.3); sp.scale.setScalar(th === "day" ? 1.2 : 2.4); g.add(sp);
      });
      env.group.add(tag(g, "floodlight"));
      env.blinker(x, y0 + h + 0.4, z, R());
    });
  }

  /* ---------- 远景：下水道（巨大圆管的里面）---------- */
  /**
   * 管壁的形状（纯函数，测试用同一份）：管子的轴沿 x，管底在地面上、从 zw（最后一排地台后沿 → 灯 → 再往后 TUNNEL.gap）开始往后往上弯。
   * 半径放不下 TUNNEL.r 就小一点（弯到竖直的那一截要在天幕前面）。
   * 返回 { r, yc, zc（轴）, zw, y0（地面）, point(φ) / at(离地多高) → { y, z, ny, nz }（管壁上的点、朝管子中心的方向）}
   */
  function tunnelShape(env) {
    const T = TUNNEL, y0 = L.CONFIG.groundY, zw = env.cz - env.hz - L.CONFIG.lamps.back - T.gap;
    const r = Math.max(3, Math.min(T.r, zw - env.skyZ - 0.8)), yc = y0 + r, zc = zw;
    const point = (phi) => ({ y: yc - r * Math.cos(phi), z: zc - r * Math.sin(phi), ny: Math.cos(phi), nz: Math.sin(phi) });
    const at = (h) => point(Math.acos(Math.max(-1, Math.min(1, (r - h) / r))));
    return { r, yc, zc, zw, y0, point, at };
  }
  /** 管壁上的灯在哪（战场左右再往外一点，等距排开，贴着管壁往里 0.12） */
  function tunnelLamps(env, S) {
    const T = TUNNEL.lamps, p = S.at(T.h), span = env.hx + 10, out = [];
    for (let i = 0; i < T.n; i++) out.push({ x: env.cx - span + 2 * span * (i + 0.5) / T.n, y: p.y + p.ny * 0.12, z: p.z + p.nz * 0.12 });
    return out;
  }
  /** 一片沿着管壁的网格（x 从 xa 到 xb 分 nx 段、沿弧从 0 到 arc 分 rows 段；往管子中心挪 lift）：顶点颜色 color(x, 点, 离地多高) */
  function wallSheet(kit, S, xa, xb, nx, arc, rows, lift, color) {
    const THREE = kit.THREE, pos = [], col = [], idx = [], w = nx + 1;
    for (let j = 0; j <= rows; j++) {
      const p = S.point(arc * j / rows);
      for (let i = 0; i <= nx; i++) {
        const x = xa + (xb - xa) * i / nx, c = color(x, p, p.y - S.y0);
        pos.push(x, p.y + p.ny * lift, p.z + p.nz * lift); col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < nx; i++) { const a = j * w + i; idx.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  /** 接缝在哪（x，从战场中间往两边每隔 joint.every 一道）；哪几道上有灯带（每隔 rings.each 道，正中那道有） */
  function tunnelJoints(env) {
    const J = TUNNEL.joint, xs = [], rings = [];
    for (let k = -Math.floor((env.cx - env.x0) / J.every); env.cx + k * J.every <= env.x1; k++) {
      const x = env.cx + k * J.every;
      xs.push(x);
      if (((k % TUNNEL.rings.each) + TUNNEL.rings.each) % TUNNEL.rings.each === 0) rings.push(x);
    }
    return { xs, rings };
  }
  /** 管壁：混凝土一段段（颜色轮着），水位线以下更暗更绿；每隔一段一道接缝（略凸出来的一圈暗色的环），接缝两边各一排铆钉；
   *  隔几道接缝一圈灯带（从管底沿着管壁一直亮到拱顶：管壁的弧形就看这一圈圈的环）；
   *  灯带、壁灯照亮的那一片另外叠一层（加色混合，不受场景光照影响：管子里就靠这些灯） */
  function tunnelWall(kit, env, S, lamps, joints) {
    const THREE = kit.THREE, T = TUNNEL, J = T.joint, c = new THREE.Color(), stain = new THREE.Color(T.stain.tint);
    const base = (x, p, h) => {
      const k = Math.floor((x - env.cx) / J.every);
      c.set(T.wall[((k % T.wall.length) + T.wall.length) % T.wall.length]);
      if (h < T.stain.h) { const f = 1 - h / T.stain.h; c.lerp(stain, 0.5 * f).multiplyScalar(1 - (1 - T.stain.dark) * f); }
      return c;
    };
    const geo = wallSheet(kit, S, env.x0, env.x1, T.seg, T.arc, T.rows, 0, base);
    env.group.add(tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide, fog: false, emissive: T.glow }))), "tunnelWall"));
    // 接缝：每道一条窄窄的环，贴着管壁往里一点；两边各一排铆钉（实例网格）
    const ribs = new THREE.Group(), ribM = env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, fog: false }));
    joints.xs.forEach(x => ribs.add(new THREE.Mesh(wallSheet(kit, S, x - J.w / 2, x + J.w / 2, 1, T.arc, T.rows, 0.04, (xx, p, h) => base(xx, p, h).multiplyScalar(J.dark)), ribM)));
    env.group.add(tag(ribs, "tunnelRib"));
    const RV = J.rivet, per = Math.floor(T.arc * S.r / RV.step), o = new THREE.Object3D();
    const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(RV.r, 6, 4), env.keep(new THREE.MeshStandardMaterial({ color: RV.color, roughness: 0.45, metalness: 0.6, fog: false, emissive: T.glow })), joints.xs.length * 2 * per);
    let n = 0;
    joints.xs.forEach(x => [-1, 1].forEach(s => {
      for (let i = 0; i < per; i++) {
        const p = S.point((i + 0.5) * RV.step / S.r);
        o.position.set(x + s * J.w * 0.32, p.y + p.ny * 0.06, p.z + p.nz * 0.06); o.updateMatrix(); rivets.setMatrixAt(n++, o.matrix);
      }
    }));
    env.group.add(tag(rivets, "rivet"));
    // 灯带：接缝上一圈细细的亮带（自己发光，泛光会抓到）
    const RG = T.rings, ringM = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(RG.color).multiplyScalar(RG.gain), toneMapped: false, fog: false, side: THREE.DoubleSide }));
    const rings = new THREE.Group();
    joints.rings.forEach(x => rings.add(new THREE.Mesh(wallSheet(kit, S, x - RG.w / 2, x + RG.w / 2, 1, T.arc, T.rows, 0.075, () => c.setRGB(1, 1, 1)), ringM)));
    env.group.add(tag(rings, "lightRing"));
    // 灯带、壁灯照亮的那一片
    const lc = new THREE.Color(T.lamps.color), rc = new THREE.Color(RG.color), add = new THREE.Color(), R2 = T.lamps.reach * T.lamps.reach, S2 = RG.spread * RG.spread;
    const glow = (x, p) => {
      let lit = 0, band = 0;
      lamps.forEach(l => { lit += Math.exp(-((x - l.x) ** 2 + (p.y - l.y) ** 2 + (p.z - l.z) ** 2) / R2); });
      joints.rings.forEach(rx => { band += Math.exp(-((x - rx) ** 2) / S2); });
      return c.copy(lc).multiplyScalar(Math.min(1, lit) * T.lamps.gain * 0.18).add(add.copy(rc).multiplyScalar(Math.min(1, band) * RG.level));
    };
    const poolM = env.keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    env.group.add(tag(new THREE.Mesh(wallSheet(kit, S, env.x0, env.x1, T.seg * 3, T.arc, T.rows, 0.06, glow), poolM), "lampPool"));
    // 打雷时灯跟着闪（tunnelScene）：灯带、照亮的那一片剩 v 成亮
    const ringC = ringM.color.clone();
    return (v) => { ringM.color.copy(ringC).multiplyScalar(v); poolM.color.setScalar(v); };
  }
  /** 管壁上的灯：一个暗色的灯罩 + 发光的灯泡 + 一团柔光；有几盏时不时闪一下（AMBIENT.flicker；减少动态效果时一直亮着） */
  function wallLamps(kit, env, lamps) {
    const THREE = kit.THREE, T = TUNNEL.lamps, cfg = AMBIENT.flicker;
    const house = env.keep(new THREE.MeshStandardMaterial({ color: 0x2a2e2a, roughness: 0.7, metalness: 0.4, fog: false }));
    const bulb = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(T.color).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const glowTex = farTex(kit, env, 64, (g, s) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(0.35, "rgba(255,255,255,.3)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    }, 5);
    const all = [];
    lamps.forEach((l, i) => {
      const g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.2), house), l.x, l.y + 0.1, l.z));
      const b = kit.put(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), bulb), l.x, l.y - 0.02, l.z + 0.04);
      const sm = env.keep(new THREE.SpriteMaterial({ map: glowTex, color: T.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.55 }));
      const sp = new THREE.Sprite(sm); sp.position.set(l.x, l.y, l.z + 0.1); sp.scale.setScalar(1.6);
      g.add(b, sp);
      env.group.add(tag(g, "wallLamp"));
      const blink = i < T.blink;
      if (blink) {
        const beat = A.beat(A.rand(i * 59 + 7), cfg.every, cfg.dur);
        g.userData.ambient = { kind: "flicker", beat };
        env.anims.push((t, dt) => { const on = dt === 0 || beat.step(dt) < 0; b.visible = on; sm.opacity = on ? 0.55 : 0.08; });
      }
      all.push({ b, sm, blink });
    });
    // 打雷时灯跟着闪（tunnelScene，排在上面自己闪的那几盏后面）：剩 v 成亮，太暗的那一下灯泡也灭
    return (v) => all.forEach(l => { l.sm.opacity = (l.blink ? l.sm.opacity : 0.55) * v; l.b.visible = (l.blink ? l.b.visible : true) && v >= 0.4; });
  }
  /** 沿管壁横着走的管子 / 电缆（TUNNEL.pipes），每隔 3 一个卡箍 */
  function wallPipes(kit, env, S) {
    const THREE = kit.THREE, len = env.x1 - env.x0, o = new THREE.Object3D();
    TUNNEL.pipes.forEach(p => {
      const w = S.at(p.h), y = w.y + w.ny * (p.r + 0.05), z = w.z + w.nz * (p.r + 0.05), m = env.keep(new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.45, flatShading: true, fog: false }));
      const g = new THREE.Group(), pipe = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, len, 10, 1, true), m), (env.x0 + env.x1) / 2, y, z);
      pipe.rotation.z = Math.PI / 2; g.add(pipe);
      const n = Math.floor(len / 3), clips = new THREE.InstancedMesh(new THREE.CylinderGeometry(p.r * 1.25, p.r * 1.25, 0.08, 10), m, n);
      for (let k = 0; k < n; k++) { o.position.set(env.x0 + (k + 0.5) * 3, y, z); o.rotation.set(0, 0, Math.PI / 2); o.updateMatrix(); clips.setMatrixAt(k, o.matrix); }
      g.add(clips);
      env.group.add(tag(g, "wallPipe"));
    });
  }
  /** 地上的污水：一大片铺满管底（地台从水里冒出来），浑浊的黄绿、一道道水纹和浮沫，贴图慢慢往左流（减少动态效果时不流）。
   *  平铺在地面上、比地台低，不算「装饰」（不打 userData.art，userData.flow 标出来） */
  function sewage(kit, env, S, seed) {
    const THREE = kit.THREE, W = TUNNEL.water, z0 = S.zw, z1 = env.cz + env.hz + 30, tile = 6;
    const tex = farTex(kit, env, 256, (g, s, r) => {
      g.fillStyle = hex(W.color); g.fillRect(0, 0, s, s);
      for (let k = 0; k < 14; k++) {   // 深浅不一的几片（左右上下都接得上）
        const x = r() * s, y = r() * s, rad = 20 + r() * 50, dark = r() < 0.6, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, dark ? "rgba(30,34,18,.35)" : "rgba(120,124,70,.25)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        [-s, 0, s].forEach(dx => [-s, 0, s].forEach(dy => { g.fillStyle = grd; g.save(); g.translate(dx, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }));
      }
      for (let k = 0; k < 70; k++) {   // 顺着流向的水纹（横着的细长条）
        const x = r() * s, y = r() * s, w = 14 + r() * 40;
        g.fillStyle = r() < 0.5 ? "rgba(190,196,140,.18)" : "rgba(20,24,12,.2)";
        [0, -s].forEach(dx => g.fillRect(x + dx, y, w, 1 + r() * 1.5));
      }
      for (let k = 0; k < 40; k++) { g.fillStyle = "rgba(210,214,170,.35)"; g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 2); }   // 浮沫
    }, seed);
    tex.magFilter = THREE.LinearFilter; tex.repeat.set((env.x1 - env.x0) / tile, (z1 - z0) / tile);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(env.x1 - env.x0, z1 - z0), env.keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.12, metalness: 0.35, fog: true, emissive: TUNNEL.glow })));
    m.rotation.x = -Math.PI / 2; m.position.set((env.x0 + env.x1) / 2, S.y0 + W.y, (z0 + z1) / 2);
    m.receiveShadow = true; m.userData.flow = "sewage";
    env.group.add(m);
    // 水面上一道道顺着流向的亮纹：另一层（透明），比污水流得快——两层流速不同，一眼看得出水在往一边流
    const st = farTex(kit, env, 128, (g, s, r) => {
      for (let k = 0; k < 46; k++) {
        const x = r() * s, y = r() * s, w = 10 + r() * 34, a = 0.25 + r() * 0.5;
        [0, -s].forEach(dx => {
          g.fillStyle = `rgba(214,222,170,${a})`; g.fillRect(x + dx, y, w, 1);
          g.fillStyle = `rgba(214,222,170,${a * 0.4})`; g.fillRect(x + dx + w * 0.2, y + 1, w * 0.6, 1);
        });
      }
    }, seed + 37);
    st.magFilter = THREE.LinearFilter; st.repeat.set((env.x1 - env.x0) / (tile * 0.7), (z1 - z0) / (tile * 0.7));
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(env.x1 - env.x0, z1 - z0), env.keep(new THREE.MeshBasicMaterial({ map: st, transparent: true, opacity: W.streak.opacity, depthWrite: false, fog: true })));
    sm.rotation.x = -Math.PI / 2; sm.position.set((env.x0 + env.x1) / 2, S.y0 + W.y + 0.008, (z0 + z1) / 2);
    sm.userData.flow = "streak";
    env.group.add(sm);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      tex.offset.x = (tex.offset.x + W.speed * dt / tile) % 1;
      st.offset.x = (st.offset.x + W.speed * W.streak.fast * dt / (tile * 0.7)) % 1;
    });
    return m;
  }
  /** 灯带、壁灯在水面上的倒影（TUNNEL.water.shine）：每个 x 一条从管底往前伸的亮纹（中间亮、两边和前头淡掉，加色混合），
   *  贴图是一道道横着的碎光，晃动着往左流（减少动态效果时不动）。平铺在水面上，不算「装饰」（userData.flow） */
  function shine(kit, env, S, xs, seed) {
    const THREE = kit.THREE, W = TUNNEL.water, SH = W.shine, y = S.y0 + W.y + 0.016;
    const tex = farTex(kit, env, 128, (g, s, r) => {
      for (let k = 0; k < 70; k++) {
        const x = r() * s, yy = r() * s, w = 4 + r() * 22, a = 0.3 + r() * 0.7;
        g.fillStyle = `rgba(255,255,255,${a})`;
        [0, -s].forEach(dx => g.fillRect(x + dx, yy, w, 1 + r() * 2));
      }
    }, seed + 41);
    tex.magFilter = THREE.LinearFilter;
    const pos = [], col = [], uv = [], idx = [];
    xs.forEach(x => {
      const b = pos.length / 3;
      // 横着三列（两边 0、中间 1）× 往前五行（越往前越淡）
      for (let j = 0; j <= 4; j++) {
        const z = S.zw + 0.15 + SH.len * j / 4, f = Math.pow(1 - j / 4, 1.4);
        [-1, 0, 1].forEach(sx => {
          pos.push(x + sx * SH.w / 2, y, z); uv.push((x + sx * SH.w / 2) / 2, z / 2);
          const v = sx === 0 ? f : 0; col.push(v, v, v);
        });
      }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { const a = b + j * 3 + i; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, env.keep(new THREE.MeshBasicMaterial({
      map: tex, vertexColors: true, color: new THREE.Color(TUNNEL.lamps.color).multiplyScalar(SH.level), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false
    })));
    m.userData.flow = "shine";
    env.group.add(m);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      tex.offset.x = (tex.offset.x + SH.speed * dt / 2) % 1;
      tex.offset.y = Math.sin(t * 1.7) * 0.04;
    });
    return m;
  }
  /** 排污口（TUNNEL.outfall）：管壁上伸出来一截横着的管子（管口里面是黑的），一股污水从管口往下流进地上的污水里（贴图往下走），
   *  落水的地方一圈浮沫一胀一缩。减少动态效果时都停住 */
  function outfall(kit, env, S, seed) {
    const THREE = kit.THREE, O = TUNNEL.outfall, x = env.cx + O.u * env.hx, yo = S.y0 + O.h;
    const zTop = S.at(O.h + O.r).z, zBot = S.at(Math.max(0.05, O.h - O.r)).z, mouth = zBot + 0.4, len = mouth - (zTop - 0.2);
    const g = new THREE.Group(), metal = env.keep(new THREE.MeshStandardMaterial({ color: 0x4c4a40, roughness: 0.75, metalness: 0.35, flatShading: true, fog: false, side: THREE.DoubleSide }));
    const pipe = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(O.r, O.r, len, 14, 1, true), metal), x, yo, mouth - len / 2);
    pipe.rotation.x = Math.PI / 2; g.add(pipe);
    const lip = kit.put(new THREE.Mesh(new THREE.TorusGeometry(O.r, 0.06, 5, 16), metal), x, yo, mouth); g.add(lip);
    g.add(kit.put(new THREE.Mesh(new THREE.CircleGeometry(O.r * 0.98, 14), env.keep(new THREE.MeshBasicMaterial({ color: 0x050605, fog: false }))), x, yo, mouth - 0.5));
    // 往下流的那一股：竖着的一条，贴图（一道道竖的水纹，左右两边透明）往下走
    const flowTex = farTex(kit, env, 64, (gc, s, r) => {
      for (let k = 0; k < 40; k++) {
        const xx = s * (0.15 + r() * 0.7), a = 0.25 + r() * 0.5;
        gc.fillStyle = `rgba(${150 + Math.floor(r() * 60)},${150 + Math.floor(r() * 50)},${90 + Math.floor(r() * 40)},${a})`;
        gc.fillRect(xx, r() * s, 1 + r() * 3, 8 + r() * 24);
      }
    }, seed + 23);
    flowTex.magFilter = THREE.LinearFilter;
    // 管壁底下往前弯，所以这股水不是直着掉下去，是从管口下沿顺着管壁流到管底（一条贴着管壁往里一点的带子，往下稍微散开）；
    // uv 的 v 按流过的长度算（每 0.8 一张贴图）
    const pos = [], uv = [], idx = [], w = O.r * 1.3, rows = 12, lipH = O.h - O.r - 0.1, phiLip = Math.acos((S.r - lipH) / S.r), step = S.r * phiLip / rows;
    const row = (xw, y, z, v) => { [-1, 1].forEach(s => { pos.push(x + s * xw / 2, y, z); uv.push(s < 0 ? 0 : 1, v); }); };
    row(w * 0.9, yo - O.r * 0.92, mouth, 0.5 / 0.8);   // 管口下沿
    for (let j = 0; j <= rows; j++) { const p = S.point(phiLip * (1 - j / rows)); row(w * (1 + 0.35 * j / rows), p.y + p.ny * 0.04, p.z + p.nz * 0.04, -j * step / 0.8); }
    for (let j = 0; j <= rows; j++) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    fg.setIndex(idx); fg.computeVertexNormals();
    g.add(new THREE.Mesh(fg, env.keep(new THREE.MeshStandardMaterial({ map: flowTex, color: O.color, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide, fog: false }))));
    env.group.add(tag(g, "outfall"));
    // 流到管底的地方：一圈浮沫，平铺在污水上（和污水一样不算「装饰」）
    const foamTex = farTex(kit, env, 64, (gc, s, r) => {
      for (let k = 0; k < 90; k++) {
        const a = r() * 7, d = Math.sqrt(r()) * s * 0.45;
        gc.fillStyle = `rgba(220,224,186,${0.2 + r() * 0.5})`; gc.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d * 0.6, 1 + r() * 3, 1 + r() * 2);
      }
    }, seed + 29);
    const foam = kit.put(new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, 1.0), env.keep(new THREE.MeshBasicMaterial({ map: foamTex, color: 0xb8bc98, transparent: true, depthWrite: false, fog: false }))), x, S.y0 + TUNNEL.water.y + 0.02, S.zw + 0.3);
    foam.rotation.x = -Math.PI / 2; foam.userData.flow = "foam";
    env.group.add(foam);
    env.anims.push((t, dt) => {
      if (!(dt > 0)) return;
      flowTex.offset.y = (flowTex.offset.y + O.fall * dt / 0.8) % 1;
      const k = 1 + Math.sin(t * 3.1) * 0.08; foam.scale.set(k, k, 1);
    });
  }
  /** 下水道：巨大圆管的后半边（管壁、接缝和铆钉、灯带、拱顶、灯照亮的那一片）、管壁上的灯和管子、排污口、地上的污水和倒影。
   *  管子里看不到天：天幕和天边那条远景收起来（没有天光、太阳的光晕、星星、乌云） */
  function tunnelScene(kit, env, art, seed) {
    const S = tunnelShape(env), lamps = tunnelLamps(env, S), joints = tunnelJoints(env);
    env.group.children.forEach(o => { if (o.userData.layer === "sky" || o.userData.layer === "band") o.visible = false; });
    const dimWall = tunnelWall(kit, env, S, lamps, joints);
    const dimLamps = wallLamps(kit, env, lamps);
    wallPipes(kit, env, S);
    outfall(kit, env, S, seed);
    sewage(kit, env, S, seed);
    shine(kit, env, S, joints.rings.concat(lamps.map(l => l.x)), seed);
    // 雷鸣（SHELTER：管子里不劈闪电、不闪白）：外面打雷时管子里的灯跟着闪一下；减少动态效果时不闪
    const w = art.weather && art.weather[env.weather];
    if (w && w.flicker) {
      const TH = AMBIENT.thunder, beat = A.beat(A.rand(seed + 53), TH.every, [TH.dur, TH.dur]);
      env.group.userData.thunder = beat;
      env.anims.push((t, dt) => {
        const k = dt > 0 ? beat.step(dt) : -1;
        let v = 1;
        if (k >= 0) TH.dips.forEach(([at, lv]) => { if (k * TH.dur >= at) v = lv; });
        dimWall(v); dimLamps(v);
      });
    }
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：外城区先借现成的（沙漠的桌山：远处的沙岩悬崖）；下水道没有（被管壁挡住，用以前的那条也看不到） */
  function band(kit, colors, seed, a) {
    return a.art.backdrop.band ? kit.bandTexture(a.art.backdrop.band, colors, seed) : null;
  }
  /** 中景、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge }（地台外面那片地一直铺到天幕 = 不给） */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), seed = seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7);
    const R = A.rand(seed + 17);
    if (art.backdrop.slum) slumScene(kit, env, art, P, b, seed);
    if (art.backdrop.pipes) bigPipes(kit, env, R);
    if (art.backdrop.cliffs) sandCliffs(kit, env, R);
    if (art.backdrop.city) cityScene(kit, env, seed);
    if (art.backdrop.bunker) bunkerScene(kit, env, seed);
    if (art.backdrop.tunnel) tunnelScene(kit, env, art, seed);
    return {};
  }

  const pack = { name: "city", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop };
  A.add(pack);
  return Object.assign({ PALETTE, SLUM, HUT, FAR, CITY, BUNKER, TUNNEL, AMBIENT, SHELTER, PROPS, zonePlan, slumPlan, tunnelShape, seedOf }, pack);
});
