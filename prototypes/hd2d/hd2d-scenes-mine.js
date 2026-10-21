/* Antlerscale: Backfire · HD-2D 战场原型 · 区域场景的美术包：三个采矿场（#242）
 *
 * 主人试玩反馈 · 五：第一采矿场分矿外 / 矿内 / 矿底三个场景；第二采矿场是它的变体（更红，时不时喷火的管道、橙红发光的岩石）；
 * 第三采矿场的矿坑浅（只有矿外 / 矿底：深色的坑里到处是紫色晶体、背景半截埋在地里发紫光的大陨石、时不时跳紫色电弧）。
 * 每个场景一套：地面（顶面贴图）、地台侧面、地台上的装饰、远景、光照 / 调色、环境动画；数值都在下面的配置表里。
 * 怎么接进画面见 hd2d-scene-art.js（登记处）：这里不 import three.js，three.js 和画贴图 / 拼几何体的小工具由挂钩那边打包成 kit 传进来。
 *
 *   矿外 rim：站在矿坑边上的砂岩地上。战场后面是一个往下陷的巨大坑口——地台外面那片地铺到坑边为止（远景给 groundEdge），坑边一排碎石和栏杆；
 *            坑的对面崖壁推得很远（离坑边 ≈ 镜头到坑边的距离），又远又小：对面坑沿落在顶栏下面一点，上沿亮、被雾吞掉一半，往下很快暗到全黑，
 *            战场后面大半个画面是往下陷的黑；坑壁上零星几盏灯（偶尔闪一下），两部运载电梯（亮着灯的小方块，外面一圈光晕）
 *            沿着竖直的轨道（黑处微微亮着、隔一段一盏小信号灯）慢慢上下；对面坑沿上远远的矿井架、筒仓、烟囱。天幕挪到坑后面（skyGap），不挡住坑
 *   矿内 mid：大矿坑里大约一半深的地方，站在坑壁半腰的运输道上，光压得更暗。运输道的边一排挡车土埂（几个路锥），后面往下还是坑；
 *            近处一面不规则的岩壁（低多边形的崖面，左右两大块一直伸出画面），中间一个大开口：透过开口看得到远处巨大矿坑的内部——
 *            对面的坑壁很远、很暗（和矿外同一种台阶坑壁，往上出了画面），越往下越黑，坑底漆黑；一部运载电梯在开口里上下；前景左右两角几块大石头
 *   矿底 floor：更黑，白天黑夜几乎没区别（光照 fixed），全靠提灯（战场两盏矿灯 + 坑壁上两盏，克制）。战场后面是坑底的岩壁，
 *            脚下两道横管、几根竖管顺着坑壁往上、阀门，横管上的排气口时不时喷气；坑壁脚下几块大石头；地台上石头和一截截管子
 *   第二采矿场：三个场景都是第一采矿场的变体——色调更红（PALETTE.mine2），时不时喷火的金属管道（FIRE），橙红发光的岩石（GLOWROCK、地台上带发光裂纹的石头）
 *
 * 地台上的装饰只摆在左右两条边带和左右矮一截的台子上（站位区以外，见 hd2d-scene-art.js · zoneSpots），不压住站位、铭牌；
 * 战场周围的东西都在战场范围外面（后面先让开灯）。只读布局给的地台 / 战场范围，不碰单位数据（没有坚毅生命）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hd2d-layout.js"), require("./hd2d-scene-art.js"));
  else root.HD2DScenesMine = factory(root.HD2DLayout, root.HD2DSceneArt);
})(typeof self !== "undefined" ? self : this, function (L, A) {
  "use strict";

  /* ---------- 配置 ---------- */
  /** 各采矿场的色调：rock 坑壁 / 石头的几层颜色（一级级台阶轮着用）、wall 坑里近处的岩壁 / 大石头（暗一点）、dark 坑底的黑（带一点雾的颜色）、
   *  metal 钢架 / 栏杆 / 管道、lamp 工作灯 / 提灯、cone 路锥、steam 管道喷的气 */
  const PALETTE = {
    mine1: { rock: [0xc39363, 0xa9784c, 0xd2a571, 0x9b6c45, 0xb88654], wall: [0x6e5843, 0x5c4836, 0x7a634c, 0x524032], dark: 0x0d0b0a, metal: 0x5d4636, lamp: 0xffc46e, cone: 0xe8742a, steam: 0x9a9088 },
    /* 第二采矿场：更红（赭红的岩层、暗红褐的岩壁、坑底的黑带一点红）；glow 发光岩石的橙红、glowBase 它的底色（烧黑的壳）、fire 喷火的芯 / 外焰 */
    mine2: {
      rock: [0xb8664a, 0x9c5038, 0xc77a5a, 0x8a4230, 0xab5c40], wall: [0x5e382a, 0x4c2c20, 0x6c4030, 0x42261c], dark: 0x120706, metal: 0x4e3a32, lamp: 0xffa860, cone: 0xe8742a,
      steam: 0x8a7470, glow: 0xff4a14, glowBase: 0x3a1408, fire: [0xffd27a, 0xff6a24]
    },
    /* 第三采矿场：深色的坑（冷的灰紫岩石）；crystal 紫色晶体发的光（三种：紫 / 品紫 / 蓝紫）、crystalBase 晶体本身的颜色；
     * moon 陨石月球色的几层灰、maria 大片暗一点的「月海」、meteorGlow 陨石发的紫光、arc 电弧、mist 坑里暗的雾 */
    mine3: {
      rock: [0x4c4860, 0x403c52, 0x58546c, 0x383448, 0x4a4660], wall: [0x2e2a3c, 0x26222f, 0x34304a, 0x221e2c], dark: 0x08060e,
      metal: 0x464256, lamp: 0xd8d0ff, cone: 0xe8742a, steam: 0x8a8498,
      crystal: [0x9a4cff, 0xc05cff, 0x6a5cff], crystalBase: 0x2a1648, moon: [0xb6b6be, 0xa8a8b2, 0x9c9ca8], maria: 0x686876, meteorGlow: 0xb06cff, arc: 0xd8a8ff, mist: 0x1c1628
    }
  };
  /** 大矿坑（矿外 rim、矿内 mid 共用一种对面坑壁）：一级级台阶往下（平面上像半个碗：正中最远，往画面两边弯过来），越往下越黑，到底漆黑一片
   *   rim       坑边（矿内是运输道的边）在灯后面再往后多远（地台外面那片地铺到这里为止）
   *   对面坑壁摆多远、多高，两种摆法：
   *     矿外（写了 reach）：推得很远——离坑边 = 镜头到坑边的水平距离 × reach（far 夹住）；对面坑沿落在画面上「顶栏往下 rimAt」处
   *       （× 顶栏和技能栏之间那一块的高度），坑沿多高按镜头倒算（比我们这层低得多：远了、小了，画面里大半是往下陷的黑）；
   *       没有镜头时坑沿比我们这层高 rise
   *     矿内：rise 对面坑壁最上面那级比我们这层高多少（坑壁的上半截，出了画面）；view 远景镜头的画面上沿正好落在对面坑壁上比我们这层高 view 的地方，far 夹住
   *   curve / wide   往两边弯过来多少（× 坑壁离坑边的距离）、弯到哪为止（× 画面在坑壁那里的半宽）；gap 台阶最近到坑边前多远
   *   step / run / benches   每级台阶多高、往前伸多少、一共几级（坑壁陡，看起来深）；riser 立面比台面暗多少（矿外远，横条纹淡一点）
   *   seg / jitter           横着分几段、每段的台阶边随机歪多少
   *   dark      从哪开始变黑、到哪全黑：按「画面里看得到的最上面 → 这边坑沿挡住的地方」那一截的比例（每块棋盘看得到多深不一样，都在挡住之前就漆黑一片）
   *   dim       整面坑壁的亮度（矿内暗）；haze 最上面往远处的雾色靠多少（越往下越少，到 hazeTo 那里没了；不写 = 到开始变黑的地方）、
   *             hazeDark 雾色先往坑底的黑靠多少（坑里的雾是暗的）
   *   bottom    最后一级一直往下到多深；sky 天幕在对面坑壁后面多远（天幕挪到坑后面，不挡住坑）；land 对面坑沿往后那片地往雾色靠多少
   *   shaft     电梯井：那一段台阶不往前伸，竖着切下去（半宽、过渡多宽），电梯的轨道贴着它
   *   lights    坑壁上的灯撒在看得到的那一截的哪一段（比例，同 dark），横着撒多宽（lightSpan × 画面在坑壁那里的半宽）；
   *   px        远处的东西按屏幕上多大来定尺寸（矿外推远了，不放大就看不见）：
   *             { light 灯的半径, lift 罐笼多高, far 对面坑沿上的矿井架多高 }（像素，桌面 900 高的画面）；liftLow 电梯最低开到看得到的那一截的哪里（比例，从挡住的地方往上算） */
  const PIT = {
    rim: {
      rim: 1.4, reach: 1.15, rimAt: 0.06, rise: -10, far: [36, 110], curve: 0.2, wide: 1.2, gap: 1.5, step: 1.2, run: 0.35, benches: 48, riser: 0.82, seg: 96, jitter: 0.07,
      dark: [0.03, 0.17], dim: 1, haze: 0.55, hazeTo: 0.17, hazeDark: 0, bottom: -110, sky: 30, land: 0.82, shaft: [0.6, 1.1],
      lights: [0.24, 0.94], lightSpan: 0.88, px: { light: 2.4, lift: 17, far: 44 }, liftLow: 0.14
    },
    mid: {
      rim: 1.4, rise: 14, view: 1.5, far: [18, 44], curve: 0.35, wide: 1.15, gap: 1.5, step: 1.1, run: 0.32, benches: 52, seg: 96, jitter: 0.07,
      dark: [0.08, 0.55], dim: 0.62, haze: 0.4, hazeDark: 0.55, bottom: -70, sky: 4, land: 0.6, shaft: [0.6, 1.1]
    }
  };
  /** 运载电梯：两根竖轨的间距（半个）、轨道粗细、一格横撑多高；罐笼的宽 / 高 / 深、亮着的窗多高；轨道从坑沿往上伸多少、往下伸到挡住的地方再往下多少。
   *  矿外（对面坑壁很远，按 PIT.px.lift 放大）：黑处的轨道也微微亮着（railGlow：灯色的几成），隔 lampEvery 一盏小信号灯（看得出一条竖的轨道），
   *  罐笼外面一圈光晕（halo：× 罐笼宽、多不透明） */
  const LIFT = { gauge: 0.2, rail: 0.05, tie: 0.55, car: [0.46, 0.4, 0.34], window: 0.16, above: 0.3, below: 5, railGlow: 0.22, lampEvery: 2.2, halo: [3.2, 0.45] };
  /** 矿内：近处那面不规则的岩壁（低多边形的崖面，正对镜头），中间一个大开口。
   *   z        崖面在运输道的边再往后多远；reach 往战场左右再外面铺多远（伸出画面）；below / above 从我们这层往下多深、画面上沿再往上多高
   *   gap      开口的半宽（× 战场半宽，我们这层的高度）；lean 到画面上沿时收成几成（上面窄一点，像一个洞口）；jag 开口的边随机进出多少
   *   cell / bump / thick   崖面一格多大、往里凹多深（坑坑洼洼）、开口的边往后补多厚（转过去看有厚度）
   *   boulders 开口两边贴着几块大石头（每边几块、大小） */
  const WALLS = { mid: { z: 1.5, reach: 16, below: 6, above: 2.5, gap: 0.5, lean: 0.74, jag: 0.85, cell: 0.9, bump: 0.8, thick: 1.8, boulders: [5, 0.45, 1.05] } };
  /** 矿内：坑边的挡车土埂（一排大石头，上面几个路锥）；前景的石头：战场前沿再往前（离前沿 front，按石头大小再让开），
   *  横着在战场左、右两边的 span 那一截（× 战场半宽，中间空出来），镜头前面框住画面的两个下角；矮，挡不到最前排的脚下 */
  const BERM = { size: [0.28, 0.5], spacing: [0.55, 0.9], cones: 5 };
  const FORE = { mid: { n: 4, size: [0.5, 0.9], span: [0.45, 0.95], front: [0.7, 2.6], squash: 0.62 } };
  /** 矿底（坑底的岩石、金属管道、喷气、提灯）：
   *   wall      战场后面的坑壁（低多边形崖面）：在灯后面再往后 z，往左右铺 reach，往下 below、伸出画面上沿 above；两头往前弯一点（bend，围起来，不过灯）
   *   pipes     坑壁脚下两道横管（离地 y、粗细 r、离坑壁 out、横着比战场宽出 span）、几根竖管顺着坑壁往上（risers）、法兰隔多远（flange）、几个阀门（valves）
   *   vents     横管上几个排气口（时不时喷气，频率在 AMBIENT.steam）
   *   lanterns  坑壁上挂几盏提灯（克制：加上战场的两盏矿灯一共四盏）：点光源多亮、照多远，光晕多大；坑壁上提灯附近亮一圈（pool：半径、亮多少）
   *   rocks     坑壁脚下几块大石头、多大 */
  const FLOOR = {
    floor: {
      wall: { z: 3.4, reach: 14, below: 1, above: 3, cell: 0.8, bump: 0.9, thick: 1.4, bend: 2.4 },
      pipes: { y: [0.42, 1.02], r: [0.2, 0.11], out: 0.75, span: 6, risers: 4, flange: 2.6, valves: 3 },
      vents: 4, lanterns: { n: 2, y: 1.9, power: 5, dist: 6.5, halo: 1.5, pool: [2.6, 0.55] }, rocks: { n: 9, size: [0.35, 0.85] }
    }
  };
  /** 会发光的东西有多亮（自发光 > 1 才会被泛光抓到）：rock 地台上带发光裂纹的石头；backdrop 远景里的发光岩石（乘一个 0.6–1.1 的随机数）；
   *  crystal 地台上的紫色晶体、crystalFar 远景里的晶簇 */
  const GLOW = { rock: 1.6, backdrop: 1.5, crystal: 1.5, crystalFar: 1.9 };
  /** 第三采矿场（晶矿）的矿坑：浅（矿外就看得到远处很小的坑底），深色的坑里到处是紫色晶体
   *   rim    矿外：坑边在灯后面再往后 edge，坑底比我们这层低 depth；对面坑壁的脚落在画面上「顶栏往下 wall」那一行（× 顶栏和技能栏之间那一块的高度，下同），
   *          对面坑沿在 rimAt 那一行（坑沿多高按镜头倒算）；几级台阶 benches、每级往前伸 run、往两边弯 curve；坑壁的颜色：haze 往雾色靠多少、
   *          dark 从哪开始暗、到哪全黑（比例：坑沿 → 坑底，> 1 = 到坑底也没全黑）；sky 天幕在对面坑沿后面多远；land 坑沿后面那片地往雾色靠多少；
   *          floor 坑底的颜色：越远越往暗的雾靠多少（mist）、起伏多大（bump）
   *   floor  矿底：灯后面再往后 edge 是陨石砸出来的坑的坑沿（地台外面那片地铺到这里为止），坑里低 depth；
   *          后面远处的坑壁在陨石后面 back，一级级往上出了画面（step 每级多高、run 往前伸多少），颜色同上 */
  const PIT3 = {
    rim: { edge: 1.4, depth: 6.5, wall: 0.17, rimAt: 0.05, benches: 4, run: 0.9, curve: 0.15, wide: 1.2, haze: 0.4, dark: [0.25, 1.7], sky: 24, land: 0.72, seg: 80, jitter: 0.08, floor: { mist: 0.55, bump: 0.18 } },
    floor: { edge: 1.2, depth: 7, back: 10, step: 1.6, run: 0.5, curve: 0.25, wide: 1.2, haze: 0.25, dark: [0.05, 1.1], sky: 14, land: 0.6, seg: 80, jitter: 0.08, floor: { mist: 0.4, bump: 0.12 } }
  };
  /** 陨石（第三采矿场的背景）：近似圆的一块，半截埋在地里（球心就在坑底那么高），月球色、一个个月球坑，发紫光。
   *   rim / floor   摆在哪：画面上球顶在「顶栏往下 top」那一行、球心在 base 那一行（大小按镜头倒算：远景里占满坑的那一截）；u 横着偏多少（× 画面在那里的半宽）；
   *                 front 球最前面离这边坑边 / 陨石坑的坑沿至少多远
   *   detail   球面分多细（低多边形；只留前上方看得到的面）；craters 几个月球坑、角半径范围（弧度）；depth 坑多深（× 角半径）；maria 几大片月海
   *   glow     几成的坑底发紫光（叠一层加色的亮面，泛光会抓到）、多亮；emissive 整块淡淡的紫光；halo 背后一圈紫色光晕（× 半径、多不透明）；
   *   light    前面一盏紫色的点光源照亮附近（多亮、照多远 × 半径）；pulse 发光慢慢一明一暗（周期秒、幅度；减少动态效果时不动）；anchors 电弧打在表面上的几个点 */
  const METEOR = {
    rim: { top: 0.012, base: 0.42, u: 0.3, front: 4 },
    floor: { top: 0.004, base: 0.42, u: 0.06, front: 1.6 },
    detail: 18, craters: [24, 0.07, 0.32], depth: 0.2, maria: 5, glow: [0.55, 1.5], emissive: 0.12, halo: [2.8, 0.32], light: [36, 2.6], pulse: [5.5, 0.18], anchors: 12
  };
  /** 紫色晶体：一丛几根（cluster），每根多粗（radius）、多高（height，× 整丛多高）、最多歪多少度（tilt）、尖多长（tip，× 柱身）；
   *  远景里的晶簇按屏幕上多高定大小（px，像素，桌面 900 高的画面）：
   *   rim    矿外：坑底撒几丛（floor）、对面坑壁台阶上几丛（wall）、这边坑沿几丛（edge）
   *   floor  矿底：陨石坑的坑沿上几丛（lip）、坑里几丛（pit）、战场两边后面几丛（side） */
  const CRYSTAL = {
    cluster: [3, 6], radius: [0.1, 0.17], height: [0.55, 1], tilt: 24, tip: 0.5,
    rim: { floor: 46, wall: 14, edge: 12, px: [9, 24] },
    floor: { lip: 12, pit: 26, side: 10, px: [26, 64] }
  };
  /** 第二采矿场：喷火的管道摆在哪、几根（时不时喷火的频率在 AMBIENT.fire）
   *   rim     坑边（栏杆后面、灯前面）几根立管：横着在战场半宽的几成处（u）、多高（h）
   *   mid     运输道的边后面、开口两边各一根（贴着岩壁的边，火在开口里窜上去）
   *   floor   矿底上面那道横管上几个喷火口
   *  发光岩石（橙红）：rim 坑边几块 + 坑里暗处几处、mid 开口两边的岩壁上几块 + 坑里几处、floor 坑壁脚下 / 坑壁上几块；size 大小 */
  const FIRE = {
    rim: { u: [-0.62, 0.55], h: 1.5 },
    mid: { h: 1.3 },
    floor: { n: 2 }
  };
  const GLOWROCK = {
    rim: { edge: 6, pit: 10, size: [0.18, 0.34], pitSize: [0.25, 0.5] },
    mid: { edge: 6, pit: 8, size: [0.3, 0.6], pitSize: [0.25, 0.5] },
    floor: { edge: 5, wall: 5, size: [0.25, 0.55] }
  };
  /** 环境动画的频率（秒）。减少动态效果时都停住：电梯停在原地，灯不闪
   *   lift    运载电梯：每次停多久、走多慢（每秒走全程的几成：全程要二三十秒）、停在哪几处（0 = 最上面，1 = 这边坑沿挡住的地方再往下，看不见了）
   *   blink   坑壁上的灯：隔多久暗一下、每次暗多久 */
  const AMBIENT = {
    lift: { wait: [3, 8], speed: [0.03, 0.055], stops: [0, 0.3, 0.62, 1] },
    blink: { every: [1.2, 4.5], dur: [0.08, 0.3] },
    /* steam   矿底管道的排气口：隔多久喷一阵、每阵多久；一阵冒几团气、往上飘多高、一团从多大长到多大、多不透明（减少动态效果时不喷） */
    steam: { every: [2.5, 7], dur: [1.4, 2.4], puffs: 6, rise: 1.5, size: [0.25, 1.1], opacity: 0.5 },
    /* fire    第二采矿场喷火的管道：隔多久喷一阵、每阵多久；火焰几团、窜多高、根部 / 顶上一团多大、多亮；平时管口一点小火苗多大（减少动态效果时只剩小火苗） */
    fire: { every: [3, 8], dur: [0.9, 1.8], flames: 7, height: [1.2, 2], size: [0.55, 0.22], opacity: 0.9, pilot: 0.22 },
    /* arc     第三采矿场的紫色电弧（每个场景几处在跳：ART 的 backdrop.arcs）：隔多久跳一道、每道多久；每 flick 秒重新抖一下；
     *         亮带分几段、折点偏多少（× 两头的距离）、多宽（像素）；两头离多远（像素）；几成带一道分叉；两头的亮点多大（像素）（减少动态效果时不跳） */
    arc: { every: [1.4, 4.5], dur: [0.22, 0.55], flick: 0.06, segs: 10, jag: 0.14, width: 2.6, reach: [40, 260], fork: 0.6, spark: 14 }
  };
  /** 每个场景（键 = 地面主题）：
   *   palette / depth（rim 矿外、mid 矿内、floor 矿底；第三采矿场的 rim3 / floor3）/ pit（PIT 的哪一套）
   *   decor     地台上的装饰：band 左右边带上几个、ledge 台子上几个、size 半径范围、tone 用色调里的哪组颜色（rock 砂岩 / wall 暗的岩石）；
   *             glow / crystal / pipes 几成是带发光裂纹的石头 / 紫色晶簇 / 一截截管子（其余是石头）
   *   backdrop  远景：lights 坑壁上几盏灯（blink 几成会闪）、lifts 运载电梯在哪（× 画面在对面坑壁那里的半宽，从中间往左右）、
   *             rail 坑边栏杆、farRim 对面坑沿上的矿井架 / 筒仓 / 烟囱；berm 坑边的挡车土埂、walls 近处的岩壁（WALLS）、fore 前景的石头（FORE）
   *   ambient   有哪些环境动画（AMBIENT 的键）
   *   light     光照 / 调色（写法见 hd2d-scene-art.js · lighting）：矿内压暗（灯更显眼），雾往坑里的暗色靠 */
  const ART = {
    mine1_rim: {
      palette: "mine1", depth: "rim", pit: "rim",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "rock" },
      backdrop: { lights: 12, blink: 0.45, lifts: [-0.48, 0.34], rail: true, farRim: true },
      ambient: ["lift", "blink"],
      light: { all: { tint: { fog: [0xc29466, 0.15], hemiGround: [0x8c6642, 0.3] } } }
    },
    mine1_mid: {
      palette: "mine1", depth: "mid", pit: "mid",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "wall" },
      backdrop: { lights: 14, blink: 0.5, lifts: [0.12], berm: true, walls: "mid", fore: "mid" },
      ambient: ["lift", "blink"],
      light: {
        all: {
          scale: { hemi: 0.55, sunI: 0.42, rimI: 0.75, exposure: 0.9, lamp: 1.8 },
          tint: { fog: [0x221a14, 0.6], sky: [0x261c15, 0.6], ground: [0x2a2018, 0.25], hemiSky: [0xa08c72, 0.35], hemiGround: [0x1c140e, 0.5], sun: [0xffe2b4, 0.25] },
          set: { dofFar: 0.011 }, grade: { vignette: 0.48 }
        }
      }
    },
    mine1_floor: {
      palette: "mine1", depth: "floor",
      decor: { band: 3, ledge: 2, size: [0.12, 0.2], tone: "wall", pipes: 0.45 },
      backdrop: { floor: "floor", fore: "mid" },
      ambient: ["steam"],
      // 矿底：白天黑夜几乎没区别（fixed：都按傍晚那一套画，再压得很暗），全靠提灯——灯 × 3，环境光、主光都压到很低，雾和天是坑底的黑
      light: {
        fixed: "dusk",
        all: {
          scale: { hemi: 0.36, sunI: 0.15, rimI: 0.45, exposure: 0.95, lamp: 3.6 },
          tint: { fog: [0x120d0a, 0.85], sky: [0x100b08, 0.9], hemiSky: [0x5a4c40, 0.55], hemiGround: [0x0a0705, 0.7], sun: [0xffc890, 0.35], rim: [0xffb070, 0.5] },
          set: { dofFar: 0.012 }, grade: { vignette: 0.55 }
        }
      }
    },
    /* 第二采矿场：第一采矿场三个场景的变体——色调更红（PALETTE.mine2，雾 / 天 / 环境光往赭红靠，调色的色温偏红），
     * 地台上几成石头带发光的裂纹（decor.glow），远景加喷火的管道（fire：FIRE 的哪一套）、橙红发光的岩石（glow：GLOWROCK 的哪一套） */
    mine2_rim: {
      palette: "mine2", depth: "rim", pit: "rim",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "rock", glow: 0.35 },
      backdrop: { lights: 10, blink: 0.45, lifts: [-0.48, 0.34], rail: true, farRim: true, fire: "rim", glow: "rim" },
      ambient: ["lift", "blink", "fire"],
      light: {
        all: {
          tint: { fog: [0xa24a2c, 0.3], sky: [0xb0502e, 0.25], hemiGround: [0x8a3420, 0.4], sun: [0xffb08a, 0.2] },
          grade: { temp: [1.09, 0.97, 0.88] }
        }
      }
    },
    mine2_mid: {
      palette: "mine2", depth: "mid", pit: "mid",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "wall", glow: 0.35 },
      backdrop: { lights: 12, blink: 0.5, lifts: [0.12], berm: true, walls: "mid", fore: "mid", fire: "mid", glow: "mid" },
      ambient: ["lift", "blink", "fire"],
      light: {
        all: {
          scale: { hemi: 0.55, sunI: 0.42, rimI: 0.75, exposure: 0.9, lamp: 1.8 },
          tint: { fog: [0x2a1209, 0.62], sky: [0x2e140a, 0.6], ground: [0x2e1a12, 0.25], hemiSky: [0xa07860, 0.35], hemiGround: [0x24100a, 0.5], sun: [0xffc8a0, 0.3] },
          set: { dofFar: 0.011 }, grade: { vignette: 0.48, temp: [1.1, 0.96, 0.88] }
        }
      }
    },
    mine2_floor: {
      palette: "mine2", depth: "floor",
      decor: { band: 3, ledge: 2, size: [0.12, 0.2], tone: "wall", pipes: 0.4, glow: 0.3 },
      backdrop: { floor: "floor", fore: "mid", fire: "floor", glow: "floor" },
      ambient: ["steam", "fire"],
      light: {
        fixed: "dusk",
        all: {
          scale: { hemi: 0.36, sunI: 0.15, rimI: 0.45, exposure: 0.95, lamp: 3.6 },
          tint: { fog: [0x180805, 0.85], sky: [0x140705, 0.9], hemiSky: [0x6a4a3c, 0.55], hemiGround: [0x100503, 0.7], sun: [0xffb080, 0.35], rim: [0xff9a60, 0.5] },
          set: { dofFar: 0.012 }, grade: { vignette: 0.55, temp: [1.1, 0.96, 0.88] }
        }
      }
    },
    /* 第三采矿场（只有矿外 / 矿底）：深色的坑里到处是紫色晶体（地台上几成装饰是晶簇：decor.crystal），背景里半截埋在地里、发紫光的大陨石（meteor：METEOR 的哪一套），
     * 时不时跳紫色电弧（arcs：几处在跳）；坑（pit3：PIT3 的哪一套）、晶簇（crystals：CRYSTAL 的哪一套） */
    mine3_rim: {
      palette: "mine3", depth: "rim3",
      decor: { band: 3, ledge: 2, size: [0.1, 0.17], tone: "rock", crystal: 0.6 },
      backdrop: { pit3: "rim", meteor: "rim", crystals: "rim", arcs: 3 },
      ambient: ["arc"],
      // 露天：跟着光影主题，整体往冷的灰紫靠一点、稍暗（紫光显眼）
      light: {
        all: {
          scale: { hemi: 0.85, sunI: 0.85 },
          tint: { fog: [0x4a3a66, 0.35], sky: [0x5a4280, 0.22], hemiGround: [0x2a1e40, 0.45], sun: [0xe8d8ff, 0.15] },
          grade: { temp: [0.98, 0.96, 1.05] }
        }
      }
    },
    mine3_floor: {
      palette: "mine3", depth: "floor3",
      decor: { band: 3, ledge: 2, size: [0.14, 0.24], tone: "wall", crystal: 0.7 },
      backdrop: { pit3: "floor", meteor: "floor", crystals: "floor", arcs: 4, fore: "mid" },
      ambient: ["arc"],
      // 矿底：白天黑夜几乎没区别（fixed：都按夜晚那一套画，再压暗、往紫靠），亮光靠晶体和陨石的紫光
      light: {
        fixed: "night",
        all: {
          scale: { hemi: 0.6, sunI: 0.4, rimI: 0.6, exposure: 0.95, lamp: 2.2 },
          tint: { fog: [0x140c22, 0.8], sky: [0x120a20, 0.85], hemiSky: [0x6a5a90, 0.5], hemiGround: [0x0c0814, 0.7], sun: [0xc8b0ff, 0.4], rim: [0xb080ff, 0.5] },
          set: { dofFar: 0.012 }, grade: { vignette: 0.5, temp: [0.97, 0.95, 1.06] }
        }
      }
    }
  };
  /** 地面主题（并进布局的 GROUNDS，写法同 hd2d-layout.js 的 GROUNDS）：顶面 / 侧面贴图是这里画的（art 开头），backdrop 指回这一套 */
  const GROUNDS = {
    mine1_rim: {   // 第一采矿场 · 矿外：砂岩地（一块块砂岩板、层理细纹），侧面砂岩层；地台外面是砂岩色的地；一盏矿灯
      tex: "artSandstone", tint: 0xffffff, side: "artSandstoneSide", decals: { crack: 2, gravel: 2, artSandDrift: 3 },
      pebbles: 14, pebble: 0xa98560, rock: 0x9c7752, decor: "art", ground: 0xa27c55, backdrop: "mine1_rim",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 1, night: 1 }
    },
    mine1_mid: {   // 第一采矿场 · 矿内：坑壁半腰的运输道（压实的土、两道车辙、碎石），侧面是爆破过的台阶断面；地台外面是暗褐的土；矿灯傍晚以后两盏
      tex: "artHaulRoad", tint: 0xffffff, side: "artBenchSide", decals: { gravel: 3, slag: 2, crack: 2 },
      pebbles: 22, pebble: 0x7a6856, rock: 0x5c4a3a, decor: "art", ground: 0x5e4c3c, backdrop: "mine1_mid",
      lamps: { kind: "hanging", color: 0xffc46e, day: 1, dusk: 2, night: 2 }
    },
    mine1_floor: {   // 第一采矿场 · 矿底：暗色的岩盘（碎裂的石板、缝里的黑泥、潮湿的地方），侧面暗的爆破断面；地台外面是黑褐的地；两盏提灯（不分白天黑夜）
      tex: "artPitFloor", tint: 0xffffff, side: "artBenchSide", sideTint: 0x8a7c70, decals: { gravel: 2, slag: 2, crack: 2, puddle: 1 },
      pebbles: 18, pebble: 0x4e4440, rock: 0x3e3530, decor: "art", ground: 0x2c241f, backdrop: "mine1_floor",
      lamps: { kind: "hanging", color: 0xffb35c, day: 2, dusk: 2, night: 2 }
    },
    // 第二采矿场：同样的三套贴图乘上偏红的颜色（tint / sideTint），矿渣里带余火（ember 贴花，glow 是它发的光）
    mine2_rim: {   // 第二采矿场 · 矿外：赭红的砂岩地，带余火的矿渣；一盏矿灯
      tex: "artSandstone", tint: 0xf2b8a0, side: "artSandstoneSide", sideTint: 0xe8a088, glow: 0xff5a1e, decals: { crack: 2, ember: 2, artSandDrift: 2 },
      pebbles: 14, pebble: 0x9a5a40, rock: 0x8a4a34, decor: "art", ground: 0x8e4e36, backdrop: "mine2_rim",
      lamps: { kind: "hanging", color: 0xffb060, day: 1, dusk: 1, night: 1 }
    },
    mine2_mid: {   // 第二采矿场 · 矿内：暗红的运输道，带余火的矿渣；矿灯傍晚以后两盏
      tex: "artHaulRoad", tint: 0xeab8a4, side: "artBenchSide", sideTint: 0xd8988a, glow: 0xff5a1e, decals: { gravel: 2, ember: 2, slag: 2, crack: 1 },
      pebbles: 22, pebble: 0x6a4436, rock: 0x543226, decor: "art", ground: 0x4e2c22, backdrop: "mine2_mid",
      lamps: { kind: "hanging", color: 0xffb060, day: 1, dusk: 2, night: 2 }
    },
    mine2_floor: {   // 第二采矿场 · 矿底：暗红的岩盘，到处是带余火的矿渣；两盏提灯（不分白天黑夜）
      tex: "artPitFloor", tint: 0xf0bcaa, side: "artBenchSide", sideTint: 0x8c6052, glow: 0xff5a1e, decals: { ember: 3, slag: 2, crack: 2 },
      pebbles: 18, pebble: 0x4e3430, rock: 0x3e2620, decor: "art", ground: 0x2e1a14, backdrop: "mine2_floor",
      lamps: { kind: "hanging", color: 0xffa860, day: 2, dusk: 2, night: 2 }
    },
    // 第三采矿场：深色的地里夹着会发光的紫色晶屑 / 晶脉（glow 是它发的光，顶面的发光贴图在 …Glow）
    mine3_rim: {   // 第三采矿场 · 矿外：深灰紫的碎石地（夹着细小的紫色晶屑），冷色的爆破断面；地台外面是深灰紫的地；一盏冷光矿灯
      tex: "artDarkGravel", tint: 0xffffff, side: "artBenchSide", sideTint: 0x9a94b0, glow: 0xa060ff, decals: { crystal: 2, gravel: 2, crack: 2 },
      pebbles: 16, pebble: 0x5a5668, rock: 0x4a4658, decor: "art", ground: 0x3a3646, backdrop: "mine3_rim",
      lamps: { kind: "hanging", color: 0xd8d0ff, day: 1, dusk: 1, night: 1 }
    },
    mine3_floor: {   // 第三采矿场 · 矿底：暗色的岩盘，一道道发紫光的晶脉；地台外面是黑紫的地；一盏冷光矿灯（亮光靠晶体）
      tex: "artVeinRock", tint: 0xffffff, side: "artBenchSide", sideTint: 0x7a7090, glow: 0xa060ff, decals: { crystal: 3, slag: 1, crack: 2 },
      pebbles: 18, pebble: 0x4a4658, rock: 0x3a3646, decor: "art", ground: 0x24202e, backdrop: "mine3_floor",
      lamps: { kind: "hanging", color: 0xd0c8ff, day: 1, dusk: 1, night: 1 }
    }
  };
  /** 区域 → 场景 id（world-data.js · BATTLE_SCENES）→ 地面主题 */
  const SCENES = {
    "第一采矿场": { rim: "mine1_rim", mid: "mine1_mid", floor: "mine1_floor" },
    "第二采矿场": { rim: "mine2_rim", mid: "mine2_mid", floor: "mine2_floor" },
    "第三采矿场": { rim: "mine3_rim", floor: "mine3_floor" }
  };

  /* ---------- 小工具 ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const D2R = Math.PI / 180;
  /** 字符串 → 种子（同一个场景每次一样） */
  const seedOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100003; };
  const named = (t, name) => { t.name = name; return t; };
  /** 一块低多边形的石头：二十面体的每个顶点沿半径随机往里收一点（同一个位置的顶点一起动，面不裂开；不超出 rad），再压扁一点 */
  function rockGeo(kit, rad, r, squash) {
    const geo = new kit.THREE.IcosahedronGeometry(rad, 0), p = geo.attributes.position, seen = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = p.getX(i).toFixed(3) + "," + p.getY(i).toFixed(3) + "," + p.getZ(i).toFixed(3);
      if (!seen.has(key)) seen.set(key, 0.68 + r() * 0.32);
      const k = seen.get(key);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (squash || 1), p.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  /** 一根晶体的形状（单位尺寸：底半径 1、柱身高 1，上面一个尖 CRYSTAL.tip）：六棱柱 + 六棱锥的尖，非索引（低多边形，一面一个颜色） */
  function crystalGeo(kit) {
    const THREE = kit.THREE, n = 6, pos = [];
    const ring = (y, r) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
    const b = ring(0, 1), u = ring(1, 0.92), apex = [0, 1 + CRYSTAL.tip, 0];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pos.push(...b[i], ...u[j], ...b[j], ...b[i], ...u[i], ...u[j], ...u[i], ...apex, ...u[j]);   // 柱面两个三角形 + 尖
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }
  /** 一丛晶体里每一根怎么摆（纯函数）：整丛高 s，几根（CRYSTAL.cluster），第一根在中间、最高、几乎直立，别的根部离中心 0.1–0.28 s、往外歪（最多 CRYSTAL.tilt 度）。
   *  返回 [{ x, z, r 半径, h 总高, rx, ry, rz }]（旋转按 "XZY" 的顺序：先绕自己的轴转、再歪）；整丛横着不超出 0.95 s（外框也不超出） */
  function crystalPoses(R, s) {
    const C = CRYSTAL, n = C.cluster[0] + Math.floor(R() * (C.cluster[1] - C.cluster[0] + 1)), out = [];
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = i ? s * (0.1 + R() * 0.18) : 0, t = (i ? 0.4 + R() * 0.6 : R() * 0.3) * C.tilt * D2R;
      out.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: s * A.span(R, C.radius) * (i ? 1 : 1.12), h: s * (i ? A.span(R, C.height) : 1), rx: t * Math.sin(a), ry: R() * Math.PI, rz: -t * Math.cos(a) });
    }
    return out;
  }
  /** 战场范围（远景的 env 给的是中心和半宽） */
  const boundsOf = (env) => ({ minX: env.cx - env.hx, maxX: env.cx + env.hx, minZ: env.cz - env.hz, maxZ: env.cz + env.hz });
  /** 关掉阴影、打上标签（测试按 userData.art 认是什么） */
  function tag(o, what) {
    o.userData.art = what;
    o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    return o;
  }

  /* ---------- 贴图（canvas 程序贴图，没有图片文件）---------- */
  /** 一张美术包的贴图：kit.canvasTex 画（按名字缓存），贴图的 name 就是它在包里的名字（测试按它认） */
  const paint = (name, size, draw, opt) => (kit) => named(kit.canvasTex("art-" + name, size, (g, s, r) => draw(g, s, r, kit), opt), name);
  /** 碎裂的石板（矿底的岩盘、第三采矿场的晶脉岩）：5 × 5 块四边形，角点随机挪（按 i % n、j % n 取：贴图首尾相接），每块颜色随机，接缝暗、带一道细亮边 */
  function plates(g, s, r, tones, seam, shine) {
    const n = 5, cell = s / n, ox = [], oy = [];
    for (let i = 0; i < n; i++) { ox.push([]); oy.push([]); for (let j = 0; j < n; j++) { ox[i].push((r() - 0.5) * cell * 0.55); oy[i].push((r() - 0.5) * cell * 0.55); } }
    const pt = (i, j) => [i * cell + ox[i % n][j % n], j * cell + oy[i % n][j % n]];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)], col = tones[Math.floor(r() * tones.length)];
      [[0, 0], [-s, 0], [0, -s], [-s, -s]].forEach(([dx, dy]) => {   // 跨过边的那一截绕回来画
        g.beginPath(); q.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.closePath();
        g.fillStyle = col; g.fill();
        g.strokeStyle = seam; g.lineWidth = 3; g.stroke();
        g.strokeStyle = shine; g.lineWidth = 1; g.stroke();
      });
    }
  }
  /** 第三采矿场的地里的晶屑、晶脉：位置按固定的种子算，贴图和它的发光贴图（…Glow）画同一批，对得上；跨过边的绕回来画（贴图首尾相接，256 见方） */
  const SHARDS = (() => { const r = A.rand(4242), out = []; for (let i = 0; i < 46; i++) out.push({ x: r() * 256, y: r() * 256, len: 4 + r() * 8, w: 1.4 + r() * 1.8, a: r() * Math.PI }); return out; })();
  const VEINS = (() => {
    const r = A.rand(5151), out = [];
    for (let i = 0; i < 7; i++) {
      let x = r() * 256, y = r() * 256, a = r() * Math.PI * 2;
      const pts = [[x, y]], n = 8 + Math.floor(r() * 8);
      for (let k = 0; k < n; k++) { a += (r() - 0.5) * 1.1; x += Math.cos(a) * (6 + r() * 9); y += Math.sin(a) * (6 + r() * 9); pts.push([x, y]); }
      out.push({ pts, w: 1.2 + r() * 1.6 });
    }
    return out;
  })();
  const around9 = (fn) => [-256, 0, 256].forEach(dx => [-256, 0, 256].forEach(dy => fn(dx, dy)));
  /** 一片晶屑（细长的菱形）：glow = 画在发光贴图上（亮的淡紫 + 一圈软光） */
  function shard(g, sh, glow) {
    around9((dx, dy) => {
      const x = sh.x + dx, y = sh.y + dy;
      if (x < -24 || x > 280 || y < -24 || y > 280) return;
      if (glow) {
        const grd = g.createRadialGradient(x, y, 0, x, y, sh.len * 1.7);
        grd.addColorStop(0, "rgba(200,170,255,.4)"); grd.addColorStop(1, "rgba(200,170,255,0)");
        g.fillStyle = grd; g.fillRect(x - sh.len * 1.7, y - sh.len * 1.7, sh.len * 3.4, sh.len * 3.4);
      }
      g.save(); g.translate(x, y); g.rotate(sh.a);
      g.beginPath(); g.moveTo(-sh.len, 0); g.lineTo(0, -sh.w); g.lineTo(sh.len, 0); g.lineTo(0, sh.w); g.closePath();
      g.fillStyle = glow ? "rgba(240,230,255,1)" : "rgba(150,104,232,.9)"; g.fill();
      if (!glow) { g.strokeStyle = "rgba(230,214,255,.7)"; g.lineWidth = 0.8; g.stroke(); }
      g.restore();
    });
  }
  /** 一道晶脉（弯弯曲曲的一条）：glow = 画在发光贴图上（外面一圈宽的软光，中间一道亮的） */
  function vein(g, v, glow) {
    around9((dx, dy) => {
      const line = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.beginPath(); v.pts.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.stroke(); };
      if (glow) { line(v.w * 4, "rgba(190,150,255,.22)"); line(v.w, "rgba(240,228,255,1)"); }
      else { line(v.w * 2.2, "rgba(20,10,36,.6)"); line(v.w, "rgba(140,96,220,.9)"); }
    });
  }
  const TEXTURES = {
    /** 砂岩地（矿外）：一行行砂岩板（高低、宽窄不一，接缝在贴图边上首尾相接），每块颜色略不同、带交错层理的细纹，接缝里积着沙，零星的裂缝和碎石 */
    artSandstone: paint("artSandstone", 256, (g, s, r, kit) => {
      const hues = ["#c39465", "#b88859", "#cfa173", "#ad7d50", "#c99a69", "#b48356", "#d6ab7c"];
      g.fillStyle = hues[0]; g.fillRect(0, 0, s, s);
      const joints = [];
      for (let y = 0; y < s;) {
        let h = 40 + Math.floor(r() * 42);
        if (s - y - h < 34) h = s - y;
        let x = Math.floor(r() * 60);
        const x0 = x;
        while (x < x0 + s) {
          let w = 52 + Math.floor(r() * 64);
          if (x0 + s - x - w < 36) w = x0 + s - x;
          const col = hues[Math.floor(r() * hues.length)], ang = (r() - 0.5) * 0.7, layers = 3 + Math.floor(r() * 5);
          [0, -s].forEach(dx => {   // 跨过右边的那一截绕回左边画
            g.save(); g.beginPath(); g.rect(x + dx, y, w, h); g.clip();
            g.fillStyle = col; g.fillRect(x + dx, y, w, h);
            g.strokeStyle = "rgba(110,70,36,.22)"; g.lineWidth = 1;
            for (let k = 0; k < layers; k++) {   // 交错层理：斜着的几道细纹
              const yy = y + (k + 0.5) * h / layers;
              g.beginPath(); g.moveTo(x + dx, yy); g.lineTo(x + dx + w, yy + Math.tan(ang) * w); g.stroke();
            }
            g.fillStyle = r() < 0.5 ? "rgba(255,236,200,.07)" : "rgba(60,34,16,.07)"; g.fillRect(x + dx, y, w, h);
            g.restore();
          });
          joints.push([x % s, y, h]);
          x += w;
        }
        joints.push([null, y, 0]);
        y += h;
      }
      kit.speckle(g, s, r, 2200, "rgba(255,240,214,.16)", "rgba(80,48,22,.18)");
      g.strokeStyle = "rgba(48,28,14,.55)"; g.lineWidth = 2.5;   // 接缝（横的一整行、竖的一块块）
      joints.forEach(([x, y, h]) => {
        g.beginPath();
        if (x == null) { g.moveTo(0, y + 1); g.lineTo(s, y + 1); } else { g.moveTo(x + 1, y); g.lineTo(x + 1, y + h); }
        g.stroke();
      });
      g.strokeStyle = "rgba(255,232,196,.14)"; g.lineWidth = 1;   // 接缝的亮边
      joints.forEach(([x, y, h]) => { g.beginPath(); if (x == null) { g.moveTo(0, y + 3); g.lineTo(s, y + 3); } else { g.moveTo(x + 3, y); g.lineTo(x + 3, y + h); } g.stroke(); });
      g.strokeStyle = "rgba(52,30,14,.5)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 6), 1.2, 1);
      for (let k = 0; k < 3; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 7, 8 + Math.floor(r() * 8));
    }),
    /** 地台侧面（矿外）：砂岩层——一层层暖色的砂岩（厚薄不一、上沿被风化得坑坑洼洼），厚的几层里有斜的层理，竖着几道裂缝 */
    artSandstoneSide: paint("artSandstoneSide", 128, (g, s, r, kit) => {
      const cols = ["#c8925c", "#b07a4a", "#d8a874", "#9c6a40", "#c08654", "#e0b684", "#a8723f"];
      for (let y = 0; y < s;) {
        const h = 5 + r() * 15, col = cols[Math.floor(r() * cols.length)];
        g.fillStyle = col; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= s; x += 8) g.lineTo(x, y + Math.sin(x * 0.09 + y) * 1.4 + (r() - 0.5) * 1.2);
        g.lineTo(s, y + h); g.lineTo(0, y + h); g.fill();
        if (h > 12) { g.strokeStyle = "rgba(90,52,24,.25)"; g.lineWidth = 1; for (let k = 0; k < 5; k++) { const x = r() * s; g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + h * 0.9, y + h - 2); g.stroke(); } }
        g.fillStyle = "rgba(40,22,10,.28)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      kit.speckle(g, s, r, 800, "rgba(255,236,206,.14)", "rgba(40,22,10,.22)");
      g.strokeStyle = "rgba(40,22,10,.4)";
      for (let k = 0; k < 4; k++) { const x = r() * s; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 10, s * (0.3 + r() * 0.7)); g.stroke(); }
    }),
    /** 运输道（矿内）：压实的土（深浅不一、潮的几块），两道车辙横着穿过（一格格斜的胎纹，压痕边上翻起来的土），密密的碎石和几块小石头 */
    artHaulRoad: paint("artHaulRoad", 256, (g, s, r, kit) => {
      g.fillStyle = "#6b5a47"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 16; i++) {
        g.fillStyle = r() < 0.55 ? `rgba(28,18,10,${0.06 + r() * 0.08})` : `rgba(255,236,206,${0.03 + r() * 0.05})`;
        g.beginPath(); g.ellipse(r() * s, r() * s, 22 + r() * 54, 14 + r() * 34, r() * 3, 0, 7); g.fill();
      }
      kit.speckle(g, s, r, 2600, "rgba(255,236,210,.10)", "rgba(20,12,6,.22)");
      [s * 0.2, s * 0.6].forEach(y0 => [0, 44].forEach(off => {   // 车辙：两个轮子各压一道
        const y = y0 + off;
        g.fillStyle = "rgba(24,16,8,.3)"; g.fillRect(0, y, s, 17);
        g.fillStyle = "rgba(0,0,0,.18)";
        for (let x = 0; x < s; x += 9) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + 5, y + 2); g.lineTo(x + 2, y + 15); g.lineTo(x - 3, y + 15); g.fill(); }
        g.fillStyle = "rgba(255,232,200,.08)"; g.fillRect(0, y - 2, s, 2); g.fillRect(0, y + 17, s, 2);
      }));
      for (let i = 0; i < 520; i++) {
        const x = r() * s, y = r() * s, w = 1.2 + r() * 3, h = 1 + r() * 2.2, v = 96 + Math.floor(r() * 64);
        g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + 1, y + 1, w, h);
        g.fillStyle = `rgb(${v + 14},${v + 4},${v - 10})`; g.fillRect(x, y, w, h);
      }
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 6 + r() * 8, 10 + Math.floor(r() * 10));
    }),
    /** 地台侧面（矿内）：爆破过的台阶断面——暗的岩层，一道道竖着的半个钻孔（左边亮、右边暗），几道裂缝 */
    artBenchSide: paint("artBenchSide", 128, (g, s, r, kit) => {
      const cols = ["#6e5a48", "#5e4c3c", "#7a6450", "#54443a", "#685444"];
      for (let y = 0; y < s;) {
        const h = 8 + r() * 18;
        g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(0, y, s, h);
        g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(0, y + h - 1, s, 1.5);
        y += h;
      }
      for (let x = 5 + r() * 6; x < s; x += 13 + r() * 8) {
        const y0 = r() * s * 0.3, grd = g.createLinearGradient(x - 3, 0, x + 3, 0);
        grd.addColorStop(0, "rgba(255,240,220,.18)"); grd.addColorStop(0.5, "rgba(0,0,0,.28)"); grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd; g.fillRect(x - 3, y0, 6, s * (0.45 + r() * 0.55));
      }
      kit.speckle(g, s, r, 700, "rgba(255,236,206,.10)", "rgba(0,0,0,.25)");
      g.strokeStyle = "rgba(10,6,2,.45)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5, 1, 0);
    }),
    /** 矿底的地：暗色的岩盘——一块块碎裂的石板（四边形，深浅不一，接缝在贴图边上首尾相接），缝里积着黑泥，几摊潮湿发暗的地方，零星的碎矿渣和亮一点的碎石 */
    artPitFloor: paint("artPitFloor", 256, (g, s, r, kit) => {
      g.fillStyle = "#3b322b"; g.fillRect(0, 0, s, s);
      plates(g, s, r, ["#3f362f", "#352d27", "#463c34", "#2f2823", "#40372f"], "rgba(12,8,5,.75)", "rgba(255,230,200,.06)");
      for (let i = 0; i < 7; i++) {   // 潮湿发暗的地方
        const x = r() * s, y = r() * s, rad = 14 + r() * 30, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, "rgba(8,6,4,.38)"); grd.addColorStop(1, "rgba(8,6,4,0)");
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      kit.speckle(g, s, r, 2400, "rgba(255,236,210,.07)", "rgba(0,0,0,.25)");
      g.strokeStyle = "rgba(6,4,2,.6)";
      for (let k = 0; k < 5; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 5), 1.1, 1);
      for (let k = 0; k < 4; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 8, 8 + Math.floor(r() * 8));
    }),
    /** 发光的裂纹（自发光贴图，第二采矿场的石头）：黑底上一道道会分叉的亮橙色裂纹，几处烧得发亮的小点；当 emissiveMap 用，只有裂纹亮 */
    artLavaVein: paint("artLavaVein", 128, (g, s, r, kit) => {
      g.fillStyle = "#000"; g.fillRect(0, 0, s, s);
      g.strokeStyle = "rgba(255,150,60,.95)";
      for (let k = 0; k < 7; k++) kit.crack(g, r, r() * s, r() * s, 6 + Math.floor(r() * 6), 1.6 + r() * 1.4, 2);
      for (let k = 0; k < 6; k++) {
        const x = r() * s, y = r() * s, rad = 3 + r() * 6, grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, "rgba(255,210,120,1)"); grd.addColorStop(1, "rgba(255,90,20,0)");
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }),
    /** 深色的碎石地（第三采矿场 · 矿外）：深灰紫的底、深浅不一的大片，密密的棱角碎石（亮面 + 暗面），夹着一片片细长的紫色晶屑（SHARDS），几道裂缝 */
    artDarkGravel: paint("artDarkGravel", 256, (g, s, r, kit) => {
      g.fillStyle = "#3b3946"; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 18; i++) {
        g.fillStyle = r() < 0.55 ? `rgba(10,8,20,${0.08 + r() * 0.1})` : `rgba(200,190,230,${0.03 + r() * 0.04})`;
        g.beginPath(); g.ellipse(r() * s, r() * s, 20 + r() * 50, 14 + r() * 30, r() * 3, 0, 7); g.fill();
      }
      kit.speckle(g, s, r, 2600, "rgba(220,214,240,.12)", "rgba(6,4,12,.3)");
      for (let i = 0; i < 700; i++) {
        const x = r() * s, y = r() * s, w = 1.5 + r() * 3.5, h = 1.2 + r() * 2.5, v = 60 + Math.floor(r() * 46);
        g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(x + 1, y + 1, w, h);
        g.fillStyle = `rgb(${v},${v - 4},${v + 12})`; g.fillRect(x, y, w, h);
      }
      SHARDS.forEach(sh => shard(g, sh, false));
      g.strokeStyle = "rgba(4,2,10,.55)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 5), 1.1, 1);
    }),
    /** 上面那张的发光贴图（自发光，地面主题的 glow 色）：黑底上只有晶屑亮 */
    artDarkGravelGlow: paint("artDarkGravelGlow", 256, (g, s) => { g.fillStyle = "#000"; g.fillRect(0, 0, s, s); SHARDS.forEach(sh => shard(g, sh, true)); }),
    /** 晶脉岩（第三采矿场 · 矿底）：冷色的暗岩盘（碎裂的石板），一道道弯弯曲曲的紫色晶脉（VEINS），细碎的斑点和裂缝 */
    artVeinRock: paint("artVeinRock", 256, (g, s, r, kit) => {
      g.fillStyle = "#2c2a36"; g.fillRect(0, 0, s, s);
      plates(g, s, r, ["#312e3b", "#2a2731", "#37333f", "#26232d", "#33303d"], "rgba(6,4,12,.75)", "rgba(220,210,255,.06)");
      kit.speckle(g, s, r, 2200, "rgba(226,220,255,.07)", "rgba(0,0,0,.25)");
      VEINS.forEach(v => vein(g, v, false));
      g.strokeStyle = "rgba(4,2,10,.6)";
      for (let k = 0; k < 4; k++) kit.crack(g, r, r() * s, r() * s, 5 + Math.floor(r() * 5), 1.1, 1);
      for (let k = 0; k < 3; k++) kit.gravel(g, r, r() * s, r() * s, 5 + r() * 8, 8 + Math.floor(r() * 8));
    }),
    /** 上面那张的发光贴图：黑底上只有晶脉亮 */
    artVeinRockGlow: paint("artVeinRockGlow", 256, (g, s) => { g.fillStyle = "#000"; g.fillRect(0, 0, s, s); VEINS.forEach(v => vein(g, v, true)); }),
    /** 贴花：一摊被风吹积的浮沙（浅色、软边，几道细沙纹） */
    artSandDrift: paint("artSandDrift", 128, (g, s, r, kit) => {
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.46);
      grd.addColorStop(0, "rgba(226,196,148,.75)"); grd.addColorStop(0.6, "rgba(220,188,140,.45)"); grd.addColorStop(1, "rgba(220,188,140,0)");
      g.fillStyle = grd; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.46, s * 0.3, 0, 0, 7); g.fill();
      g.strokeStyle = "rgba(150,108,62,.3)"; g.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { g.beginPath(); for (let x = s * 0.2; x <= s * 0.8; x += 5) g.lineTo(x, s * (0.38 + k * 0.08) + Math.sin(x * 0.12 + k) * 2.5); g.stroke(); }
      kit.speckle(g, s, r, 120, "rgba(255,240,210,.3)", "rgba(120,80,40,.2)");
    }, { clamp: true, smooth: true })
  };
  /** 贴花（写法同 hd2d-world.js 的 DECALS） */
  const DECALS = {
    artSandDrift: { tex: "artSandDrift", size: [1.2, 2.1] }
  };

  /* ---------- 地台上的装饰 ---------- */
  /**
   * 一块地台上摆什么、摆在哪（纯函数，测试用同一份）：左右边带上 decor.band 个、左右的台子上 decor.ledge 个（hd2d-scene-art.js · zoneSpots），
   * 两两隔开。返回 [{ kind, x, z, y（摆在多高的台面上）, size（半径）, on }]（局部坐标）
   */
  function zonePlan(z, key) {
    const art = ART[key];
    if (!art) return [];
    const D = art.decor, R = A.rand(z.id * 977 + seedOf(key)), spots = A.zoneSpots(z, D.size[0]);
    const band = A.pick(spots.filter(s => s.on === "band"), D.band, R, 1.4);
    const ledge = A.pick(spots.filter(s => s.on === "ledge"), D.ledge, R, 0.8);
    // kind：rock 石头；pipe 一截管子（矿底）；glow 带发光裂纹的石头（第二采矿场）；crystal 一丛紫色晶体（第三采矿场）——每块地台上各占几成按 decor.glow / crystal / pipes
    // （发光的、晶簇至少一个；挑出来的点本来就是打乱过的，前面几个当发光的、再几个当晶簇、再几个当管子）
    const all = band.concat(ledge), atLeast = (k) => (k ? Math.max(1, Math.round(all.length * k)) : 0);
    const counts = [["glow", atLeast(D.glow)], ["crystal", atLeast(D.crystal)], ["pipe", D.pipes ? Math.round(all.length * D.pipes) : 0]];
    const kindOf = (i) => { for (const [k, n] of counts) { if (i < n) return k; i -= n; } return D.kind || "rock"; };
    return all.map((s, i) => ({ kind: kindOf(i), x: s.x, z: s.z, y: s.y, size: Math.min(A.span(R, D.size), s.r), on: s.on }));
  }
  /** 挂钩：地台上的装饰（hd2d-world.js · buildZone 交过来；地台本体、贴花、小石子已经画好了）。
   *  管子顺着边带（沿 z）躺着，两头一圈法兰，有的上面一个阀门轮；整个在装饰的半径里（四个角离中心不到 size） */
  function zone(kit, g, z, ctx, r, look, a) {
    const art = a.art, P = PALETTE[art.palette], R = A.rand(z.id * 131 + seedOf(a.key)), tones = P[art.decor.tone] || P.rock, THREE = kit.THREE;
    zonePlan(z, a.key).forEach(d => {
      const col = tones[Math.floor(R() * tones.length)];
      let m;
      if (d.kind === "pipe") {
        const rr = d.size * 0.26, len = d.size * 1.7, metal = kit.mat("art-pipe-" + art.palette, P.metal, { roughness: 0.5, metalness: 0.55 });
        m = new THREE.Group();
        m.add(kit.mesh(new THREE.CylinderGeometry(rr, rr, len, 10), metal));
        [-1, 1].forEach(s => m.add(kit.mesh(new THREE.CylinderGeometry(rr * 1.4, rr * 1.4, 0.05, 10), metal, 0, s * (len / 2 - 0.03), 0)));
        m.rotation.x = Math.PI / 2;
        if (R() < 0.5) { const w = kit.mesh(new THREE.TorusGeometry(rr * 0.9, rr * 0.18, 4, 10), metal, 0, 0, -rr * 1.5); m.add(w); }
        const holder = new THREE.Group();
        holder.add(m); holder.position.set(d.x, d.y + rr, d.z); holder.rotation.y = (R() - 0.5) * 0.4;
        m = holder;
      } else if (d.kind === "glow") {
        m = kit.mesh(rockGeo(kit, d.size, R, 0.62), kit.mat("art-glowrock-" + art.palette, col, { roughness: 0.9, emissive: P.glow, emissiveIntensity: GLOW.rock, emissiveMap: kit.tex("artLavaVein") }), d.x, d.y + d.size * 0.32, d.z);
        m.rotation.y = R() * Math.PI * 2;
      } else if (d.kind === "crystal") {
        // 一丛紫色晶体：整丛在半径 size 里（高 ≈ size），几根各用一种紫（材质按色调缓存）
        m = new THREE.Group();
        crystalPoses(R, d.size).forEach((s, i) => {
          const k = i % P.crystal.length, c = kit.mesh(crystalGeo(kit), kit.mat("art-crystal-" + art.palette + "-" + k, P.crystalBase, { emissive: P.crystal[k], emissiveIntensity: GLOW.crystal, roughness: 0.3, metalness: 0.15 }), s.x, -0.02, s.z);
          c.rotation.set(s.rx, s.ry, s.rz, "XZY"); c.scale.set(s.r, s.h / (1 + CRYSTAL.tip), s.r);
          m.add(c);
        });
        m.position.set(d.x, d.y, d.z);
      } else {
        m = kit.mesh(rockGeo(kit, d.size, R, 0.62), kit.mat("art-rock-" + art.palette, col, { roughness: 1 }), d.x, d.y + d.size * 0.32, d.z);
        m.rotation.y = R() * Math.PI * 2;
      }
      m.userData.art = d.kind; m.userData.size = d.size;
      g.add(m);
    });
  }

  /* ---------- 远景：大矿坑（矿外）---------- */
  /**
   * 矿坑摆在哪（纯函数，天幕挪多远也用它）：坑边（这边）在灯后面再往后 Q.rim；对面坑壁按镜头摆（两种摆法见 PIT）。
   * 返回 { rimZ 坑边, zFar 对面坑壁（正中，最上面那级的边）, D 两边隔多远, top 对面坑壁最上面那级多高,
   *   ref 画面里看得到的最上面（变黑从这里往下算）, cx, halfW 画面在对面坑壁那里的半宽, W 坑壁弯到哪,
   *   yOcc 从镜头看过来，这边的坑沿把对面坑壁挡到多深（再往下看不见）, sky 天幕离战场后沿多远, px 对面坑壁那里一个像素多大 }
   */
  function pitDims(Q, b, cam) {
    const gY = L.CONFIG.groundY, rimZ = b.minZ - L.CONFIG.lamps.back - Q.rim, cx = (b.minX + b.maxX) / 2;
    const ok = !!(cam && cam.pos && Number.isFinite(cam.elevation) && Number.isFinite(cam.fov));
    const tan = ok ? Math.tan((cam.elevation - cam.fov / 2) * D2R) : 0;
    let D, top;
    if (Q.reach) {   // 矿外：推得很远，对面坑沿落在顶栏下面一点（坑沿多高按镜头倒算）
      D = clamp(ok ? (cam.pos.z - rimZ) * Q.reach : Q.far[1], Q.far[0], Q.far[1]);
      top = ok ? rowHeight(cam, rimZ - D, Q.rimAt) : gY + Q.rise;
    } else {
      D = clamp(tan > 1e-3 ? rimZ - (cam.pos.z - (cam.pos.y - (gY + Q.view)) / tan) : Q.far[1], Q.far[0], Q.far[1]);
      top = gY + Q.rise;
    }
    const zFar = rimZ - D;
    let halfW = (b.maxX - b.minX) / 2 + D * 0.4;
    if (ok && cam.right && cam.tanHalf && cam.aspect) {
      const p = L.toNdc(cam, { x: cx, y: top, z: zFar }), q = L.toNdc(cam, { x: cx + 1, y: top, z: zFar });
      if (q.x - p.x > 1e-6) halfW = 1 / (q.x - p.x);
    }
    const ref = Math.min(top, ok ? cam.pos.y - (cam.pos.z - zFar) * tan : gY + Q.view), occ = ok && cam.pos.z > rimZ + 1 ? gY - D * (cam.pos.y - gY) / (cam.pos.z - rimZ) : ref - 12;
    // 对面坑壁那里一个像素多大（世界单位；按桌面 900 高的画面算，手机竖屏视角一样、像素数差不多）：推远了的灯、电梯按屏幕上多大放大
    const depth = ok ? Math.hypot(cam.pos.y - top, cam.pos.z - zFar) : D + 45, px = 2 * depth * Math.tan((ok ? cam.fov : 22) * D2R / 2) / 900;
    // 进深 z 处这边坑沿挡到多高（碗的两边近，挡得浅）：比它低的看不见
    const occAt = (z) => (ok && cam.pos.z > rimZ + 1 ? gY - (rimZ - z) * (cam.pos.y - gY) / (cam.pos.z - rimZ) : -Infinity);
    return { rimZ, zFar, D, top, ref, cx, halfW, W: halfW * Q.wide, yOcc: Math.min(occ, ref - 2), sky: b.minZ - zFar + Q.sky, px, occAt };
  }
  /** 画面上「顶栏往下 frac」（× 顶栏和技能栏之间那一块的高度）那一行的视线方向 { dy, dz }（镜头正对 −z，和布局的镜头同一种；没给画面大小 = 整个画面） */
  function rowRay(cam, frac) {
    const H = cam.height || 1, v = cam.view || {}, t = (v.top || 0) / H, bt = (v.bottom || 0) / H;
    const yN = 1 - 2 * (t + frac * (1 - t - bt)), e = cam.elevation * D2R, th = Math.tan(cam.fov * D2R / 2) * yN;
    return { dy: -Math.sin(e) + Math.cos(e) * th, dz: -Math.cos(e) - Math.sin(e) * th };   // 视线：往前 + 往上 th
  }
  /** 那一行的视线在进深 z 处多高 */
  const rowHeight = (cam, z, frac) => { const r = rowRay(cam, frac); return cam.pos.y + (z - cam.pos.z) / r.dz * r.dy; };
  /** 那一行的视线碰到高 y 的平面在哪（z） */
  const rowHit = (cam, frac, y) => { const r = rowRay(cam, frac); return cam.pos.z + (y - cam.pos.y) / r.dy * r.dz; };
  /** 半截埋在地里的球摆多远、多大（纯函数）：球心在高 y 的地面上，画面上球心在 fBase 那一行、球的上沿在 fTop 那一行；
   *  球最前面（z + r）不过 zMax（太近就往后挪、跟着变小）。返回 { z, r } */
  function domeOf(cam, y, fTop, fBase, zMax) {
    const tr = rowRay(cam, fTop), thTop = Math.atan2(-tr.dy, -tr.dz), h = cam.pos.y - y;
    const rOf = (z) => { const L = cam.pos.z - z; return Math.hypot(h, L) * Math.sin(Math.max(0, Math.atan2(h, L) - thTop)); };
    let z = rowHit(cam, fBase, y);
    if (z + rOf(z) > zMax) {
      let lo = z - 200, hi = z;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (m + rOf(m) > zMax) hi = m; else lo = m; }
      z = lo;
    }
    return { z, r: rOf(z) };
  }
  /**
   * 对面的坑壁：一级级台阶往下（第 k 级的台面在 top − k × step，台阶边在 zFar + 弯过来的那一点 + k × run，越往下越靠近这边，最近到坑边前 gap），
   * 平面上像半个碗（bowl：画面两边的台阶更近，一级级台阶在画面上是往两边垂下去的弧）；电梯井那一段竖着切下去（cut）。横着分 seg 段，每段的台阶边随机歪一点。
   * 拼成一个几何体，颜色按顶点给：一层层岩石的颜色，台面亮、立面暗；上面往远处的雾色靠，往下越来越黑（按看得到的那一截算，挡住之前就漆黑一片）。
   * 对面坑沿往后一片地，慢慢升到天幕前（低镜头时接上天）。不吃场景的雾（雾会把坑底也抹亮），自己按远近调颜色。
   * 返回 { mesh, d, Q, n, edgeAt(k, x) → { y, z }, faceAt(x) 电梯井那里的竖壁在哪（z）, darkAt(y) 0–1 多黑, landAt(z) 对面那片地多高 }
   */
  function pitWall(kit, env, Q, P, R, d, shafts) {
    const THREE = kit.THREE, n = Q.benches, seg = Q.seg, xs = [], ys = [], zs = [];
    for (let i = 0; i <= seg; i++) xs.push(env.x0 + (env.x1 - env.x0) * i / seg);
    const cut = (x) => shafts.reduce((m, s) => Math.max(m, 1 - smooth(Q.shaft[0], Q.shaft[0] + Q.shaft[1], Math.abs(x - s))), 0);
    const bowl = (x) => { const u = Math.min(1, Math.abs(x - d.cx) / d.W); return d.D * Q.curve * (1 - Math.sqrt(1 - u * u)); };
    const zMax = d.rimZ - Q.gap;
    for (let k = 0; k < n; k++) {
      ys.push(xs.map(() => d.top - k * Q.step + (k ? (R() - 0.5) * 2 * Q.jitter : 0)));
      zs.push(xs.map(x => { const c = cut(x); return Math.min(zMax, d.zFar + bowl(x) + k * Q.run * (1 - c) + (R() - 0.5) * 2 * Q.jitter * (1 - c)); }));
    }
    const back = env.skyZ + 0.3, gY = L.CONFIG.groundY, backY = Math.max(d.top, gY + 0.2);
    const landAt = (z) => d.top + (backY - d.top) * clamp((d.zFar - z) / Math.max(1e-3, d.zFar - back), 0, 1);
    const mist = new THREE.Color(P.dark), haze = env.hazeOf(1).lerp(mist, Q.hazeDark || 0);
    const d0 = d.ref - (d.ref - d.yOcc) * Q.dark[0], d1 = d.ref - (d.ref - d.yOcc) * Q.dark[1];
    const darkAt = (y) => smooth(0, 1, (d0 - y) / Math.max(1e-3, d0 - d1));
    const h0 = Q.hazeTo != null ? d.ref - (d.ref - d.yOcc) * Q.hazeTo : d0;   // 雾到哪没了（矿外：和变黑一起收，上沿被雾吞掉一半、往下没进黑里）
    const hazeAt = (y) => Q.haze * (1 - smooth(0, 1, (d.ref - y) / Math.max(1e-3, d.ref - h0)));
    const colorOf = (k, lit, v) => {   // 立面按它下半截的高度算黑不黑（一整面同一个颜色）
      const y = d.top - (k + (lit ? 0 : 0.6)) * Q.step, c = new THREE.Color(P.rock[k % P.rock.length]).multiplyScalar((lit ? 1.06 : Q.riser || 0.7) * v * Q.dim);
      return c.lerp(haze, hazeAt(y)).lerp(mist, darkAt(y));
    };
    const pos = [], col = [];
    const quad = (a, b, c, e, color) => [a, b, c, a, c, e].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); });
    const land = new THREE.Color(P.rock[0]).multiplyScalar(Q.dim).lerp(haze, Q.land);
    for (let i = 0; i < seg; i++) {
      const xa = xs[i], xb = xs[i + 1], v = 0.92 + R() * 0.16;
      // 对面坑沿往后那片地：慢慢升到天幕前
      quad([xa, backY, back], [xa, ys[0][i], zs[0][i]], [xb, ys[0][i + 1], zs[0][i + 1]], [xb, backY, back], land.clone().multiplyScalar(v));
      for (let k = 0; k < n; k++) {
        const yb = k + 1 < n ? ys[k + 1] : null, lo = (j) => (yb ? yb[j] : Q.bottom);
        quad([xa, ys[k][i], zs[k][i]], [xa, lo(i), zs[k][i]], [xb, lo(i + 1), zs[k][i + 1]], [xb, ys[k][i + 1], zs[k][i + 1]], colorOf(k, false, v));   // 立面
        if (yb) quad([xa, yb[i], zs[k][i]], [xa, yb[i], zs[k + 1][i]], [xb, yb[i + 1], zs[k + 1][i + 1]], [xb, yb[i + 1], zs[k][i + 1]], colorOf(k + 1, true, v));   // 下一级的台面
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = tag(new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, fog: false }))), "pitWall");
    const edgeAt = (k, x) => {
      const kk = clamp(Math.round(k), 0, n - 1), t = clamp((x - env.x0) / (env.x1 - env.x0) * seg, 0, seg - 1e-6), i = Math.floor(t), f = t - i;
      return { y: ys[kk][i] + (ys[kk][i + 1] - ys[kk][i]) * f, z: zs[kk][i] + (zs[kk][i + 1] - zs[kk][i]) * f };
    };
    return { mesh, d, Q, n, edgeAt, faceAt: (x) => Math.min(zMax, d.zFar + bowl(x)), darkAt, landAt };
  }
  /** 坑壁上零星的灯：落在看得到的那一截台阶边上（Q.lights 那一段：对面坑沿往下、这边坑沿挡住之前，大多在暗处），横着在画面里，让开电梯井；
   *  推远了的（矿外）按屏幕上多大放大。一部分偶尔暗一下（AMBIENT.blink；减少动态效果时一直亮着） */
  function pitLights(kit, env, wall, art, P, R, shafts, xr) {
    const THREE = kit.THREE, d = wall.d, Q = wall.Q, BD = art.backdrop, cfg = AMBIENT.blink, rad = Math.max(0.075, Q.px ? d.px * Q.px.light : 0);
    const mat = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.6), toneMapped: false, fog: false }));
    const geo = new THREE.SphereGeometry(rad, 6, 5), span = xr || d.halfW * (Q.lightSpan || 1.05);   // xr：横着只撒在这么宽里（矿内只在开口里看得到）
    const [f0, f1] = Q.lights || [0.1, 1], kOf = (f) => (d.top - d.ref + (d.ref - d.yOcc) * f) / Q.step;
    const k0 = Math.max(1, Math.ceil(kOf(f0))), k1 = Math.max(k0 + 1, Math.floor(kOf(f1) - 0.4 / Q.step));
    for (let i = 0, tries = 0; i < BD.lights && tries < BD.lights * 20; tries++) {
      const x = d.cx + (R() * 2 - 1) * span;
      if (shafts.some(s => Math.abs(x - s) < Q.shaft[0] + Q.shaft[1] + 0.3)) continue;
      const k = k0 + Math.floor(R() * (k1 - k0 + 1)), e = wall.edgeAt(k, x);
      if (e.y < d.occAt(e.z) + rad * 3) continue;   // 被这边的坑沿挡住了（碗的两边近，挡得浅）
      const m = tag(kit.put(new THREE.Mesh(geo, mat), x, e.y + rad, e.z + rad * 0.8), "pitLight");
      env.group.add(m);
      if ((i * 0.618034 + 0.3) % 1 < BD.blink) {   // 几成会闪：按序号均匀挑（不靠运气，少几盏灯也照样有几盏会闪）
        const beat = A.beat(A.rand(i * 59 + 3), cfg.every, cfg.dur);
        m.userData.ambient = { kind: "blink", beat };
        env.anims.push((t, dt) => { if (dt === 0) { m.visible = true; return; } m.visible = beat.step(dt) < 0; });
      }
      i++;
    }
  }
  /** 运载电梯：贴着对面坑壁竖着切下去的那一道（电梯井），两根竖轨 + 一格格横撑，从坑沿一直下到这边坑沿挡住的地方再往下；
   *  亮着灯的小方块（罐笼）沿着轨道慢慢上下（AMBIENT.lift：停一阵、挑另一个停靠点、慢慢开过去）。
   *  矿内：轨道越往下越黑（实例颜色），最下面那处在挡住的地方下面，开下去就看不见了。
   *  矿外（对面坑壁推得很远，Q.px）：整个按屏幕上多大放大；黑处的轨道微微亮着、隔一段一盏小信号灯（看得出一条竖的轨道），
   *  罐笼外面一圈光晕，最低开到看得到的黑处（Q.liftLow），一直看得见。罐笼的外壳跟着暗下去，亮着的窗一直亮着。x = 电梯井在哪 */
  function lift(kit, env, wall, P, R, x, i) {
    const THREE = kit.THREE, d = wall.d, Q = wall.Q, far = !!Q.px, k = far ? Math.max(1, d.px * Q.px.lift / LIFT.car[1]) : 1;
    const gauge = LIFT.gauge * k, rail = LIFT.rail * k, tie = LIFT.tie * k;
    const z = wall.faceAt(x) + 0.12 * k, yTop = d.top + LIFT.above * k, yBot = d.yOcc - LIFT.below;
    const yo = Math.max(d.yOcc, d.occAt(z));   // 电梯井那里这边坑沿挡到多高
    const nT = Math.ceil((yTop - yBot) / tie), metal = new THREE.Color(P.metal), dark = new THREE.Color(P.dark), c = new THREE.Color();
    const low = far ? new THREE.Color(P.lamp).multiplyScalar(LIFT.railGlow) : dark;   // 黑处的轨道：矿外微微亮着，矿内跟着暗下去
    const mat = env.keep(far ? new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, flatShading: true, fog: false }));
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(rail, tie, rail), mat, nT * 2);
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(gauge * 2 + rail * 2, rail * 0.8, rail), mat, nT);
    const o = new THREE.Object3D();
    for (let j = 0; j < nT; j++) {
      const y = yTop - (j + 0.5) * tie;
      c.copy(metal).lerp(low, wall.darkAt(y));
      [-1, 1].forEach((s, h) => { o.position.set(x + s * gauge, y, z); o.updateMatrix(); rails.setMatrixAt(j * 2 + h, o.matrix); rails.setColorAt(j * 2 + h, c); });
      o.position.set(x, y + tie / 2, z - 0.02 * k); o.updateMatrix(); ties.setMatrixAt(j, o.matrix); ties.setColorAt(j, c);
    }
    const g = new THREE.Group();
    g.add(rails, ties);
    const glow = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.2), toneMapped: false, fog: false }));
    if (far) {   // 矿外：轨道边上隔一段一盏小信号灯
      const lampM = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(1.3), toneMapped: false, fog: false }));
      const ys = [], step = Math.min(LIFT.lampEvery * k, (d.top - yo) / 4);   // 看得到的那一截短（小棋盘）也至少三四盏
      for (let y = yTop - step * 0.5; y > yo; y -= step) ys.push(y);
      const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(d.px * 1.1, 5, 4), lampM, Math.max(1, ys.length));
      ys.forEach((y, j) => { o.position.set(x + gauge + rail * 2, y, z + rail); o.updateMatrix(); dots.setMatrixAt(j, o.matrix); });
      dots.count = ys.length;
      g.add(dots);
    }
    // 罐笼：外壳 + 正面一条亮着的窗 + 顶上一盏小灯（矿外再加一圈光晕）
    const [cw, ch, cd] = LIFT.car.map(v => v * k), shell = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.6, metalness: 0.4, flatShading: true, fog: false }));
    const car = new THREE.Group();
    car.add(new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), shell));
    car.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(cw * 0.8, LIFT.window * k, 0.02 * k), glow), 0, ch * 0.12, cd / 2 + 0.01 * k));
    car.add(kit.put(new THREE.Mesh(new THREE.SphereGeometry(0.04 * k, 6, 5), glow), 0, ch / 2 + 0.04 * k, cd * 0.2));
    if (far) {
      const halo = new THREE.Sprite(env.keep(new THREE.SpriteMaterial({ map: env.keep(kit.smokeTexture()), color: P.lamp, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: LIFT.halo[1], fog: false })));
      halo.scale.setScalar(cw * LIFT.halo[0]); halo.position.z = cd / 2 + 0.05 * k;
      car.add(halo);
    }
    const cfg = AMBIENT.lift, mv = A.mover(A.rand(i * 733 + 29), cfg, cfg.stops[Math.floor(R() * cfg.stops.length)]);
    const y0 = Math.min(d.top - 0.05 + ch / 2, d.ref + 3);   // 最上面：对面坑沿（矿外）/ 画面上沿外面（矿内）
    const y1 = far && Q.liftLow != null ? yo + (d.top - yo) * Q.liftLow + ch / 2 : d.yOcc - 1.5;   // 最下面：矿外在看得到的黑处，矿内在挡住的地方下面
    const place = () => {
      const y = y0 + (y1 - y0) * mv.s;
      car.position.set(x, y, z + cd / 2 + 0.06 * k);
      shell.color.copy(metal).lerp(dark, wall.darkAt(y) * 0.85);
    };
    place();
    car.userData.ambient = { kind: "lift", mover: mv, y0, y1 };
    g.add(tag(car, "lift"));
    env.group.add(tag(g, "liftShaft"));
    env.anims.push((t, dt) => { if (dt > 0) { mv.step(dt); place(); } });
  }
  /** 对面坑沿上远远的东西：电梯井口的矿井架、几座筒仓 / 小厂房、一根冒烟的烟囱（远景剪影的材质：远的偏向雾色）；推远了的（矿外）按屏幕上多大放大 */
  function farRim(kit, env, wall, P, R, shafts) {
    const d = wall.d, Q = wall.Q, M = env.mats(1), k = Q.px ? Math.max(1, d.px * Q.px.far / 1.3) : 1;
    const at = (x, back) => { const z = wall.edgeAt(0, x).z - back * k; return { x, y: wall.landAt(z) - 0.02 * k, z }; };
    const add = (o, p, what) => { o.position.set(p.x, p.y, p.z); env.group.add(tag(o, what)); return o; };
    shafts.forEach(x => add(kit.headframe(M, 1.3 * k), at(x + 0.3 * k, 0.5), "farHeadframe"));
    [[-0.85, "silos"], [-0.25, "shed"], [0.12, "silos"], [0.68, "shed"]].forEach(([u, what]) => {
      const x = d.cx + u * d.halfW + (R() - 0.5) * 2 * k;
      add(what === "silos" ? kit.silos(M, (0.9 + R() * 0.5) * k, 2 + Math.floor(R() * 2)) : kit.shed(M, (1.1 + R() * 0.8) * k, (0.5 + R() * 0.3) * k), at(x, 0.9 + R() * 0.6), "farRim");
    });
    const p = at(d.cx + 0.5 * d.halfW, 1.2), ch = kit.chimney(M, 1.9 * k, 0.16 * k);
    add(ch.group, p, "farRim");
    env.smoke(p.x, p.y + ch.top, p.z, 0.35 * k);
    env.blinker(p.x, p.y + ch.top + 0.12 * k, p.z, 0.4);
  }
  /** 矿外：战场后面往下陷的大矿坑。返回 groundEdge（坑边：地台外面那片地铺到这里为止） */
  function rimScene(kit, env, art, P, R, b) {
    const Q = PIT[art.pit], BD = art.backdrop, d = pitDims(Q, b, env.cam);
    const shafts = (BD.lifts || []).map(u => d.cx + u * d.halfW);
    const wall = pitWall(kit, env, Q, P, R, d, shafts);
    env.group.add(wall.mesh);
    rimLip(kit, env, P, R, d.rimZ);
    if (BD.rail) railing(kit, env, P, R, b, d.rimZ);
    pitLights(kit, env, wall, art, P, R, shafts);
    shafts.forEach((x, i) => lift(kit, env, wall, P, R, x, i));
    if (BD.farRim) farRim(kit, env, wall, P, R, shafts);
    // 第二采矿场：坑边（栏杆后面、灯前面）几根喷火的立管；坑边几块、坑里暗处几处橙红发光的岩石
    if (BD.fire) { const FI = FIRE[BD.fire], tex = env.keep(kit.smokeTexture()); FI.u.forEach((u, i) => firePipe(kit, env, P, R, d.cx + u * (env.hx + 1), d.rimZ + 0.75, FI.h, i, tex)); }
    if (BD.glow) {
      const G = GLOWROCK[BD.glow], list = [], k = Math.max(1, d.px * Q.px.light / 0.075);   // 坑里的发光岩石跟着坑壁的灯一起放大
      for (let i = 0; i < G.edge; i++) { const s = A.span(R, G.size); list.push({ x: d.cx + (R() * 2 - 1) * (env.hx + 6), y: L.CONFIG.groundY + s * 0.15, z: d.rimZ + (R() - 0.5) * 0.3, s, fog: true }); }
      glowRocks(kit, env, P, R, list.concat(pitGlows(wall, R, G.pit, G.pitSize.map(v => v * k), d.halfW)));
    }
    return d.rimZ;
  }

  /** 这边的坑沿：地台外面那片地到这里为止，沿着断口一排半埋的碎石（盖住地面的直边），几个实例网格 */
  function rimLip(kit, env, P, R, rimZ) {
    const THREE = kit.THREE, x0 = env.x0 + 4, x1 = env.x1 - 4, groups = 3, list = [[], [], []];
    for (let x = x0; x < x1; x += 0.5 + R() * 0.45) list[Math.floor(R() * groups)].push(x);
    list.forEach((xs, gi) => {
      const geo = rockGeo(kit, 1, R, 0.7), m = new THREE.InstancedMesh(geo, env.keep(new THREE.MeshStandardMaterial({ color: P.rock[gi % P.rock.length], roughness: 1, flatShading: true })), xs.length);
      const o = new THREE.Object3D();
      xs.forEach((x, i) => {
        const s = 0.2 + R() * 0.2;
        o.position.set(x, L.CONFIG.groundY - s * 0.25, rimZ + (R() - 0.5) * 0.3); o.rotation.set((R() - 0.5) * 0.5, R() * 3, (R() - 0.5) * 0.5); o.scale.set(s * (1 + R() * 0.4), s * 0.75, s);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      });
      env.group.add(tag(m, "rimLip"));
    });
  }
  /** 坑边的栏杆：一根根柱子 + 上下两道横杆（锈铁），横着比战场两边各宽出 9 */
  function railing(kit, env, P, R, b, rimZ) {
    const THREE = kit.THREE, mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.7, metalness: 0.4, flatShading: true }));
    const z = rimZ + 0.4, y0 = L.CONFIG.groundY, from = b.minX - 9, to = b.maxX + 9, posts = [];
    for (let x = from; x <= to; x += 1.35) posts.push(x);
    const g = new THREE.Group(), pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat, posts.length), o = new THREE.Object3D();
    posts.forEach((x, i) => { o.position.set(x, y0 + 0.3, z + (R() - 0.5) * 0.06); o.rotation.set((R() - 0.5) * 0.12, 0, (R() - 0.5) * 0.12); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); });
    g.add(pm);
    const a = posts[0], c = posts[posts.length - 1];
    [0.55, 0.3].forEach(h => g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(c - a, 0.035, 0.035), mat), (a + c) / 2, y0 + h, z)));
    env.group.add(tag(g, "rail"));
  }

  /* ---------- 远景：矿内 ---------- */
  /** 运输道边上的挡车土埂：一排半埋的大石头（几个实例网格），上面立几个路锥 */
  function berm(kit, env, P, R, b, rimZ) {
    const THREE = kit.THREE, x0 = env.x0 + 4, x1 = env.x1 - 4, list = P.wall.map(() => []), y0 = L.CONFIG.groundY;
    for (let x = x0; x < x1; x += A.span(R, BERM.spacing)) list[Math.floor(R() * list.length)].push(x);
    const top = [];
    list.forEach((xs, gi) => {
      const m = new THREE.InstancedMesh(rockGeo(kit, 1, R, 0.8), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[gi], roughness: 1, flatShading: true })), xs.length), o = new THREE.Object3D();
      xs.forEach((x, i) => {
        const s = A.span(R, BERM.size);
        o.position.set(x, y0 + s * 0.15, rimZ + 0.1 + (R() - 0.5) * 0.25); o.rotation.set((R() - 0.5) * 0.4, R() * 3, (R() - 0.5) * 0.4); o.scale.set(s * (1 + R() * 0.3), s * 0.8, s);
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        if (x > b.minX - 6 && x < b.maxX + 6) top.push({ x, y: y0 + s * 0.85 });
      });
      env.group.add(tag(m, "berm"));
    });
    // 路锥：橘色的锥 + 一道白反光带，立在土埂上（挑几块石头顶上）
    const cm = env.keep(new THREE.MeshStandardMaterial({ color: P.cone, roughness: 0.6, flatShading: true })), wm = env.keep(new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, flatShading: true }));
    A.pick(top, BERM.cones, R, 2.5).forEach(p => {
      const c = new THREE.Group();
      c.add(kit.put(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8), cm), 0, 0.15, 0));
      c.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.05, 8), wm), 0, 0.15, 0));
      c.position.set(p.x, p.y - 0.05, rimZ + 0.1);
      env.group.add(tag(c, "cone"));
    });
  }
  /**
   * 一面岩壁（低多边形的崖面，正对镜头；矿内的岩壁、矿底的坑壁都用它）：在 x0–x1、y0–y1 里铺一格格（cell 大），inside(x, y) 里面的格子才要；
   * 顶点随机挪一点（边是参差的，不是一格格的台阶）、往后凹一点（bump：崖面坑坑洼洼）；露在外面的边往后补一圈侧面（thick，转过去看也有厚度）。
   * 颜色按顶点给：tones 几种岩石颜色随机，每个三角形亮暗不一，再乘 shade(x, y)（0–1）。fog = 吃不吃场景的雾。返回 Mesh
   */
  function rockFace(kit, env, R, o) {
    const THREE = kit.THREE, cell = o.cell, nx = Math.ceil((o.x1 - o.x0) / cell), ny = Math.ceil((o.y1 - o.y0) / cell), V = [];
    for (let i = 0; i <= nx; i++) {
      V.push([]);
      for (let j = 0; j <= ny; j++) {
        const x = o.x0 + i * cell + (R() - 0.5) * cell * 0.7;
        V[i].push([x, o.y0 + j * cell + (R() - 0.5) * cell * 0.7, (o.zAt ? o.zAt(x) : o.z) - R() * o.bump]);   // zAt：崖面平面上弯一点（矿底两头往前围）
      }
    }
    const at = (i, j) => [o.x0 + (i + 0.5) * cell, o.y0 + (j + 0.5) * cell];
    const inCell = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && o.inside(...at(i, j));
    const pos = [], col = [], c = new THREE.Color();
    const tri = (a, b, e, color) => [a, b, e].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(color.r, color.g, color.b); });
    const tone = (x, y, k) => c.set(o.tones[Math.floor(R() * o.tones.length)]).multiplyScalar((0.82 + R() * 0.3) * k * o.shade(x, y));
    const back = (p) => [p[0], p[1], p[2] - o.thick];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (!inCell(i, j)) continue;
      const a = V[i][j], b = V[i + 1][j], e = V[i + 1][j + 1], f = V[i][j + 1], [x, y] = at(i, j);
      tri(a, b, e, tone(x, y, 1)); tri(a, e, f, tone(x, y, 1));
      [[i - 1, j, f, a], [i + 1, j, b, e], [i, j - 1, a, b], [i, j + 1, e, f]].forEach(([ii, jj, p, q]) => {   // 露在外面的边：往后补一圈侧面
        if (inCell(ii, jj)) return;
        const s = tone(x, y, 0.6);
        tri(p, q, back(q), s); tri(p, back(q), back(p), s);
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, side: THREE.DoubleSide, fog: !!o.fog })));
  }
  /** 矿内：运输道边后面那面不规则的岩壁，左右两大块一直伸出画面，中间一个大开口（我们这层最宽，往上收一点，像一个洞口；边参差不齐）。
   *  开口两边再贴几块大石头（立体一点）。整个在运输道的边后面（灯后面）。返回 { half(y) 开口在 y 高处的半宽, z 崖面在哪 } */
  function midWalls(kit, env, P, R, b, rimZ, W) {
    const THREE = kit.THREE, gY = L.CONFIG.groundY, z = rimZ - W.z, cx = env.cx, yTop = env.topY(z) + W.above, y0 = gY - W.below;
    const g0 = env.hx * W.gap, g1 = g0 * W.lean, ph = [0, 1, 2, 3].map(() => R() * 6.3);
    const half = (y, right) => g0 + (g1 - g0) * clamp((y - gY) / Math.max(1, yTop - gY), 0, 1)
      + W.jag * (0.6 * Math.sin(y * 1.3 + ph[right ? 0 : 1]) + 0.4 * Math.sin(y * 3.1 + ph[right ? 2 : 3]));
    const face = rockFace(kit, env, R, {
      x0: cx - env.hx - W.reach, x1: cx + env.hx + W.reach, y0, y1: yTop, z, cell: W.cell, bump: W.bump, thick: W.thick, fog: true,
      inside: (x, y) => Math.abs(x - cx) > half(y, x > cx), tones: P.wall,
      shade: (x, y) => 0.7 + 0.3 * smooth(gY - 2, gY + 3, y)   // 坑里那截暗一点
    });
    env.group.add(tag(face, "rockWall"));
    // 开口两边贴着的大石头
    const [n, s0, s1] = W.boulders;
    [-1, 1].forEach(side => {
      for (let i = 0; i < n; i++) {
        const y = gY + (yTop - gY) * (i + R() * 0.6) / n * 0.9, s = s0 + R() * (s1 - s0), m = new THREE.Mesh(rockGeo(kit, s, R, 0.9), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[i % P.wall.length], roughness: 1, flatShading: true })));
        m.position.set(cx + side * (half(y, side > 0) + s * 0.15), y, z - s * 0.2 - 0.1); m.rotation.set(R() * 3, R() * 3, R() * 3);
        env.group.add(tag(m, "rockWall"));
      }
    });
    return { half, z };
  }
  /** 前景的石头：战场前沿再往前、左右两边各几块，镜头前面框住画面的两个下角（近景里景深把它们糊掉） */
  function foreRocks(kit, env, P, R, b, F) {
    const THREE = kit.THREE;
    for (let i = 0; i < F.n; i++) {
      const side = i % 2 ? 1 : -1, s = A.span(R, F.size);
      const x = env.cx + side * env.hx * A.span(R, F.span), z = b.maxZ + s + A.span(R, F.front);
      const m = new THREE.Mesh(rockGeo(kit, s, R, F.squash), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[i % P.wall.length], roughness: 1, flatShading: true })));
      m.position.set(x, L.CONFIG.groundY + s * 0.25, z); m.rotation.y = R() * 3;
      env.group.add(tag(m, "foreRock"));
    }
  }
  /** 矿内：站在坑壁半腰的运输道上。运输道的边（地台外面那片地到这里为止）一排挡车土埂；后面近处一面不规则的岩壁，中间一个大开口，
   *  透过开口看得到远处巨大矿坑的内部：对面坑壁很远、很暗（往上出了画面），越往下越黑，坑底漆黑；坑壁上的灯、运载电梯只摆在开口里看得到的那一截。
   *  前景几块大石头。返回 groundEdge */
  function midScene(kit, env, art, P, R, b) {
    const Q = PIT[art.pit], BD = art.backdrop, d = pitDims(Q, b, env.cam);
    const shafts = (BD.lifts || []).map(u => d.cx + u * d.halfW);
    const wall = pitWall(kit, env, Q, P, R, d, shafts);
    env.group.add(wall.mesh);
    if (BD.berm) berm(kit, env, P, R, b, d.rimZ);
    const W = BD.walls ? midWalls(kit, env, P, R, b, d.rimZ, WALLS[BD.walls]) : null;
    if (BD.fore) foreRocks(kit, env, P, R, b, FORE[BD.fore]);
    // 开口在对面坑壁上能看到多宽：按镜头到崖面、到对面坑壁的远近放大（近大远小）
    const cz = env.cam && env.cam.pos ? env.cam.pos.z : env.cz + 45, open = W ? W.half(L.CONFIG.groundY, true) * (cz - d.zFar) / Math.max(1, cz - W.z) : null;
    pitLights(kit, env, wall, art, P, R, shafts, open ? open * 0.9 : null);
    shafts.forEach((x, i) => lift(kit, env, wall, P, R, x, i));
    // 第二采矿场：开口两边贴着岩壁各一根喷火的立管（火在开口里窜上去）；开口两边的岩壁上几块、坑里暗处几处橙红发光的岩石
    if (BD.fire && W) {
      const FI = FIRE[BD.fire], tex = env.keep(kit.smokeTexture()), gY = L.CONFIG.groundY;
      [-1, 1].forEach((s, i) => firePipe(kit, env, P, R, d.cx + s * (W.half(gY, s > 0) - 0.5), W.z + 0.6, FI.h, i, tex));
    }
    if (BD.glow && W) {
      const G = GLOWROCK[BD.glow], gY = L.CONFIG.groundY, list = [];
      for (let i = 0; i < G.edge; i++) {
        const s = A.span(R, G.size), side = i % 2 ? 1 : -1, y = gY + 0.3 + R() * (env.topY(W.z) - gY) * 0.7;
        list.push({ x: d.cx + side * (W.half(y, side > 0) + s * 0.4 + R() * 3), y, z: W.z - s * 0.3, s, fog: true });
      }
      glowRocks(kit, env, P, R, list.concat(pitGlows(wall, R, G.pit, G.pitSize, open ? open * 0.9 : d.halfW)));
    }
    return d.rimZ;
  }

  /* ---------- 远景：矿底 ---------- */
  /** 坑壁脚下的管道：两道横管（法兰、支架），几根竖管顺着坑壁往上（出画面），几个阀门轮。返回 { run: 上面那道横管 { y, z, r, x0, x1 }, risers: [x] } */
  function pipeRuns(kit, env, P, R, F, zAt) {
    const THREE = kit.THREE, PP = F.pipes, gY = L.CONFIG.groundY, cx = env.cx, x0 = cx - env.hx - PP.span, x1 = cx + env.hx + PP.span;
    const mat = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.5, metalness: 0.55, flatShading: true }));
    const dark = env.keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(P.metal).multiplyScalar(0.55), roughness: 0.6, metalness: 0.5, flatShading: true }));
    const g = new THREE.Group(), zw = zAt(cx), runs = [];
    PP.y.forEach((h, i) => {
      const r = PP.r[i], y = gY + h, z = zw + PP.out - i * 0.25;
      const pipe = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 12), mat), (x0 + x1) / 2, y, z); pipe.rotation.z = Math.PI / 2; g.add(pipe);
      for (let x = x0 + 0.6; x < x1; x += PP.flange) { const f = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.07, 12), dark), x, y, z); f.rotation.z = Math.PI / 2; g.add(f); }
      for (let x = x0 + 1.4; x < x1; x += 3.1) g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.14, y - gY, r * 1.6), dark), x, (y + gY) / 2, z));   // 支架
      runs.push({ y, z, r, x0, x1 });
    });
    const top = runs[runs.length - 1], risers = [], yUp = env.topY(top.z) + 3;
    for (let i = 0; i < PP.risers; i++) {
      const x = cx + ((i + 0.5) / PP.risers - 0.5) * 2 * (env.hx + 2) + (R() - 0.5) * 1.6, r = top.r * 0.9;
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r, r, yUp - top.y, 10), mat), x, (yUp + top.y) / 2, top.z - 0.05));
      g.add(kit.put(new THREE.Mesh(new THREE.SphereGeometry(r * 1.3, 10, 8), dark), x, top.y, top.z - 0.05));   // 接头
      for (let y = top.y + 1.2; y < yUp; y += 1.6 + R()) { const f = kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.06, 10), dark), x, y, top.z - 0.05); g.add(f); }
      risers.push(x);
    }
    const low = runs[0];
    for (let i = 0; i < PP.valves; i++) {   // 阀门：下面那道横管上，短的阀杆 + 正对镜头的手轮
      const x = x0 + 3 + R() * (x1 - x0 - 6);
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 6), dark), x, low.y + low.r + 0.12, low.z));
      g.add(kit.put(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 4, 12), mat), x, low.y + low.r + 0.28, low.z + 0.02));
    }
    env.group.add(tag(g, "pipes"));
    return { run: top, risers };
  }
  /** 横管上的排气口：一截短管 + 帽子；时不时喷一阵气（AMBIENT.steam：一阵冒几团，越飘越高越大越淡；减少动态效果时不喷） */
  function steamVents(kit, env, P, R, F, pipes) {
    const THREE = kit.THREE, S = AMBIENT.steam, run = pipes.run, tex = env.keep(kit.smokeTexture()), out = [];
    const metal = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.5, metalness: 0.55, flatShading: true }));
    for (let i = 0, tries = 0; i < F.vents && tries < 60; tries++) {
      const x = run.x0 + 2 + R() * (run.x1 - run.x0 - 4);
      if (pipes.risers.some(q => Math.abs(q - x) < 1.2) || out.some(q => Math.abs(q - x) < 3)) continue;
      out.push(x);
      const g = new THREE.Group(), y = run.y + run.r;
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(run.r * 0.55, run.r * 0.55, 0.26, 8), metal), x, y + 0.13, run.z));
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(run.r * 0.8, run.r * 0.6, 0.06, 8), metal), x, y + 0.28, run.z));
      const puffs = [];
      for (let k = 0; k < S.puffs; k++) {
        const m = env.keep(new THREE.SpriteMaterial({ map: tex, color: P.steam, transparent: true, depthWrite: false, opacity: 0 }));
        const sp = new THREE.Sprite(m); sp.visible = false; sp.position.set(x, y + 0.32, run.z + 0.05); sp.scale.setScalar(S.size[0]); g.add(sp); puffs.push(sp);
      }
      const beat = A.beat(A.rand(i * 211 + 17), S.every, S.dur, 0.5 + R() * S.every[1]), drift = (R() - 0.5) * 0.6;
      g.userData.ambient = { kind: "steam", beat, puffs };
      env.anims.push((t, dt) => {
        const p = dt > 0 ? beat.step(dt) : -1;
        puffs.forEach((sp, k) => {
          const q = p < 0 ? -1 : (p - (k / S.puffs) * 0.6) / 0.4;
          sp.visible = q >= 0 && q <= 1;
          if (!sp.visible) return;
          sp.position.set(x + drift * q, y + 0.32 + q * S.rise, run.z + 0.05);
          sp.scale.setScalar(S.size[0] + (S.size[1] - S.size[0]) * q);
          sp.material.opacity = S.opacity * Math.sin(Math.PI * q);
        });
      });
      env.group.add(tag(g, "vent"));
      i++;
    }
    return out;
  }
  /** 坑壁上挂的提灯（克制，就 F.lanterns.n 盏）：铁支架伸出来，吊一盏带罩子的灯 + 光晕 + 一个点光源（照亮附近的坑壁和管道），火苗轻轻晃（减少动态效果时不晃） */
  function lanterns(kit, env, P, R, F, spots) {
    const THREE = kit.THREE, LN = F.lanterns, tex = env.keep(kit.smokeTexture());
    const iron = env.keep(new THREE.MeshStandardMaterial({ color: 0x2e2824, roughness: 0.6, metalness: 0.5, flatShading: true }));
    const glow = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.lamp).multiplyScalar(2.4), toneMapped: false }));
    spots.forEach((s, i) => {
      const g = new THREE.Group();
      g.add(kit.put(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), iron), s.x, s.y + 0.3, s.z - 0.25));   // 支架
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 4), iron), s.x, s.y + 0.21, s.z));
      g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.06, 8), iron), s.x, s.y + 0.12, s.z));   // 罩子
      g.add(kit.put(new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), glow), s.x, s.y, s.z));
      const halo = new THREE.Sprite(env.keep(new THREE.SpriteMaterial({ map: tex, color: P.lamp, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 })));
      halo.position.set(s.x, s.y, s.z + 0.05); halo.scale.setScalar(LN.halo); g.add(halo);
      const light = new THREE.PointLight(P.lamp, LN.power, LN.dist, 2);
      light.position.set(s.x, s.y - 0.05, s.z + 0.15); g.add(light);
      const ph = R() * 6;
      env.anims.push((t, dt) => { light.intensity = LN.power * (dt > 0 ? 0.9 + 0.1 * Math.sin(t * 11 + ph) * Math.sin(t * 6.7 + ph * 2) : 1); });
      env.group.add(tag(g, "lantern"));
    });
  }
  /** 矿底：战场后面是坑底的岩壁（一直伸出画面上沿，两头往前围一点），脚下两道横管、几根竖管顺着坑壁往上、阀门；横管上的排气口时不时喷气；
   *  坑壁上挂两盏提灯（附近的崖面亮一圈）；坑壁脚下几块大石头；前景左右两角几块大石头。地台外面的地一直铺到坑壁脚下（不返回 groundEdge） */
  function floorScene(kit, env, art, P, R, b) {
    const THREE = kit.THREE, F = FLOOR[art.backdrop.floor], W = F.wall, gY = L.CONFIG.groundY, lampZ = b.minZ - L.CONFIG.lamps.back, cx = env.cx;
    const z0 = lampZ - W.z, bendFrom = env.hx + F.pipes.span;
    const zAt = (x) => z0 + W.bend * smooth(bendFrom, env.hx + W.reach, Math.abs(x - cx));
    const LN = F.lanterns, spots = [];
    for (let i = 0; i < LN.n; i++) { const x = cx + (LN.n > 1 ? (i / (LN.n - 1) - 0.5) * 2 : 0) * env.hx * 0.55 + (R() - 0.5); spots.push({ x, y: gY + LN.y, z: zAt(x) + 0.55 }); }
    const yTop = env.topY(z0) + W.above;
    const face = rockFace(kit, env, R, {
      x0: cx - env.hx - W.reach, x1: cx + env.hx + W.reach, y0: gY - W.below, y1: yTop, zAt, cell: W.cell, bump: W.bump, thick: W.thick, fog: true,
      inside: () => true, tones: P.wall,
      // 坑底暗：整面压一点；提灯附近亮一圈（灯光照到的地方）
      shade: (x, y) => 0.55 + LN.pool[1] * Math.max(0, ...spots.map(s => Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (LN.pool[0] ** 2))))
    });
    env.group.add(tag(face, "pitFloorWall"));
    const pipes = pipeRuns(kit, env, P, R, F, zAt);
    const vents = steamVents(kit, env, P, R, F, pipes);
    lanterns(kit, env, P, R, F, spots);
    // 第二采矿场：上面那道横管上几个喷火口（让开竖管、排气口、提灯）；坑壁脚下、坑壁上几块橙红发光的岩石
    if (art.backdrop.fire) {
      const FI = FIRE[art.backdrop.fire], run = pipes.run, tex = env.keep(kit.smokeTexture()), used = pipes.risers.concat(vents, spots.map(s => s.x)), soot = env.keep(new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.8, flatShading: true }));
      for (let i = 0, tries = 0; i < FI.n && tries < 80; tries++) {
        const x = run.x0 + 2 + R() * (run.x1 - run.x0 - 4);
        if (used.some(q => Math.abs(q - x) < 1.6)) continue;
        used.push(x);
        const g = new THREE.Group(), y = run.y + run.r;
        g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(run.r * 0.7, run.r * 0.55, 0.22, 8), soot), x, y + 0.11, run.z));
        g.add(fireJet(kit, env, P, R, x, y + 0.22, run.z, i, tex));
        env.group.add(tag(g, "firePipe"));
        i++;
      }
    }
    if (art.backdrop.glow) {
      const G = GLOWROCK[art.backdrop.glow], list = [];
      for (let i = 0; i < G.edge; i++) { const x = cx + (R() * 2 - 1) * (env.hx + 4), s = A.span(R, G.size); list.push({ x, y: gY + s * 0.2, z: zAt(x) + 0.25, s, fog: true }); }
      for (let i = 0; i < G.wall; i++) { const x = cx + (R() * 2 - 1) * (env.hx + 6), s = A.span(R, G.size); list.push({ x, y: gY + 1.6 + R() * (yTop - gY - 3), z: zAt(x) - 0.1, s, fog: true }); }
      glowRocks(kit, env, P, R, list);
    }
    // 坑壁脚下的大石头（在管道前面一点，不过灯）
    const RK = F.rocks;
    for (let i = 0; i < RK.n; i++) {
      const x = cx + (R() * 2 - 1) * (env.hx + W.reach - 3), z = zAt(x) + F.pipes.out + 0.5 + R() * 0.5, s = Math.min(A.span(R, RK.size), lampZ - 0.35 - z);
      if (s < 0.2) continue;
      const m = new THREE.Mesh(rockGeo(kit, s, R, 0.75), env.keep(new THREE.MeshStandardMaterial({ color: P.wall[i % P.wall.length], roughness: 1, flatShading: true })));
      m.position.set(x, gY + s * 0.3, z); m.rotation.y = R() * 3;
      env.group.add(tag(m, "floorRock"));
    }
    if (art.backdrop.fore) foreRocks(kit, env, P, R, b, FORE[art.backdrop.fore]);
  }

  /* ---------- 远景：第二采矿场的喷火管道、发光岩石 ---------- */
  /** 管口的火（AMBIENT.fire）：平时一点小火苗；时不时一阵火从管口窜上去（几团加色混合的火，下面黄、上面橙，越往上越小越淡），烧一阵就熄；
   *  减少动态效果时只剩小火苗（不喷、不晃）。返回 Group（userData.ambient.puffs = 那几团火） */
  function fireJet(kit, env, P, R, x, y, z, i, tex) {
    const THREE = kit.THREE, S = AMBIENT.fire, g = new THREE.Group();
    const mk = (color, op) => env.keep(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: op }));
    const pilot = new THREE.Sprite(mk(new THREE.Color(P.fire[1]).multiplyScalar(1.6), 0.85));
    pilot.position.set(x, y + 0.05, z); pilot.scale.setScalar(S.pilot); g.add(pilot);
    const flames = [];
    for (let k = 0; k < S.flames; k++) {
      const f = new THREE.Sprite(mk(new THREE.Color(k < S.flames / 2 ? P.fire[0] : P.fire[1]).multiplyScalar(2), 0));
      f.visible = false; f.position.set(x, y, z); f.scale.setScalar(S.size[1]); g.add(f); flames.push(f);
    }
    const H = A.span(R, S.height), beat = A.beat(A.rand(i * 389 + 71), S.every, S.dur, 1 + R() * S.every[1]), ph = R() * 6;
    g.userData.ambient = { kind: "fire", beat, puffs: flames };
    env.anims.push((t, dt) => {
      const p = dt > 0 ? beat.step(dt) : -1, k1 = p < 0 ? 0 : smooth(0, 0.15, p) * (1 - smooth(0.7, 1, p));   // 窜上去 → 烧一阵 → 熄
      flames.forEach((f, k) => {
        f.visible = k1 > 0.01;
        if (!f.visible) return;
        const q = k / (S.flames - 1), w = 0.85 + 0.3 * Math.sin(t * 23 + k * 1.7 + ph);
        f.position.set(x + Math.sin(t * 9 + k) * 0.05 * q, y + 0.08 + q * H * k1, z);
        f.scale.setScalar((S.size[0] + (S.size[1] - S.size[0]) * q) * w * (0.4 + 0.6 * k1));
        f.material.opacity = S.opacity * k1 * (1 - q * 0.5);
      });
      pilot.scale.setScalar(S.pilot * (dt > 0 ? 0.85 + 0.25 * Math.sin(t * 17 + ph) : 1));
    });
    return tag(g, "fire");
  }
  /** 一根喷火的立管：锈铁的管子（下面一圈法兰）、烧黑的管口，管口的火见 fireJet */
  function firePipe(kit, env, P, R, x, z, h, i, tex) {
    const THREE = kit.THREE, gY = L.CONFIG.groundY, r = 0.1, g = new THREE.Group();
    const metal = env.keep(new THREE.MeshStandardMaterial({ color: P.metal, roughness: 0.5, metalness: 0.55, flatShading: true }));
    const soot = env.keep(new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.8, metalness: 0.3, flatShading: true }));
    g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 10), metal), x, gY + h / 2, z));
    g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.5, r * 1.5, 0.08, 10), soot), x, gY + 0.25, z));
    g.add(kit.put(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.3, r * 0.95, 0.14, 10), soot), x, gY + h + 0.07, z));
    g.add(fireJet(kit, env, P, R, x, gY + h + 0.14, z, i, tex));
    env.group.add(tag(g, "firePipe"));
  }
  /** 橙红发光的岩石（烧黑的壳 + 整块发橙红的光，泛光会抓到）：list = [{ x, y, z, s, fog }] */
  function glowRocks(kit, env, P, R, list) {
    const THREE = kit.THREE;
    list.forEach(q => {
      const m = new THREE.Mesh(rockGeo(kit, q.s, R, 0.8), env.keep(new THREE.MeshStandardMaterial({ color: P.glowBase, emissive: P.glow, emissiveIntensity: GLOW.backdrop * (0.6 + R() * 0.5), roughness: 0.9, flatShading: true, fog: !!q.fog })));
      m.position.set(q.x, q.y, q.z); m.rotation.set(R() * 3, R() * 3, R() * 3);
      env.group.add(tag(m, "glowRock"));
    });
  }
  /** 坑里暗处的发光岩石：落在看得到的那一截里、已经开始变黑的台阶边上（像坑底透上来的熔岩光），横着在 xr 里 */
  function pitGlows(wall, R, n, size, xr) {
    const d = wall.d, Q = wall.Q, out = [];
    const kA = Math.ceil((d.top - d.ref + (d.ref - d.yOcc) * 0.35) / Q.step), kB = Math.max(kA + 1, Math.floor((d.top - d.yOcc) / Q.step));
    for (let i = 0; i < n; i++) {
      const x = d.cx + (R() * 2 - 1) * xr, e = wall.edgeAt(kA + Math.floor(R() * (kB - kA + 1)), x), s = A.span(R, size);
      out.push({ x, y: e.y + s * 0.3, z: e.z + s * 0.4, s, fog: false });
    }
    return out;
  }

  /* ---------- 远景：第三采矿场（浅坑、紫色晶体、半埋的陨石、紫色电弧）---------- */
  /**
   * 第三采矿场的坑摆在哪（纯函数，天幕挪多远也用它）。s = "rim" 矿外 / "floor" 矿底（PIT3、METEOR 的哪一套）：
   *   矿外：坑边 rimZ（灯后面再往后 edge），坑底 floorY；对面坑壁的脚 zBase（画面上 wall 那一行看过去碰到坑底的地方），坑沿 zFar / top（rimAt 那一行，按镜头倒算）
   *   矿底：rimZ 是陨石砸出来的坑的坑沿，坑底 floorY；后面的坑壁在陨石后面 back，一级级往上出了画面
   *   陨石 meteor：{ x, y（球心，就在坑底那么高：半截埋在地里）, z, r }（按 METEOR 的 top / base 两行倒算，最前面离 rimZ 至少 front）
   * 返回 { rimZ, floorY, zBase, zFar, top, n 几级台阶, step 每级多高, D, cx, halfW, W, ref, yOcc, sky, px, pxAt(p) 那里一个像素多大, occAt(z), meteor }
   */
  function mine3Dims(s, b, cam) {
    const Q = PIT3[s], MT = METEOR[s], gY = L.CONFIG.groundY, lampZ = b.minZ - L.CONFIG.lamps.back, cx = (b.minX + b.maxX) / 2;
    const c = cam && cam.pos && Number.isFinite(cam.elevation) && Number.isFinite(cam.fov) ? cam : { pos: { x: cx, y: 25, z: (b.minZ + b.maxZ) / 2 + 45 }, elevation: 30, fov: 22 };
    const rimZ = lampZ - Q.edge, floorY = gY - Q.depth;
    const pxAt = (p) => 2 * Math.hypot(p.x - (c.pos.x || 0), p.y - c.pos.y, p.z - c.pos.z) * Math.tan(c.fov * D2R / 2) / 900;
    const halfAt = (z, y) => {
      if (c.right && c.tanHalf && c.aspect) { const p = L.toNdc(c, { x: cx, y, z }), q = L.toNdc(c, { x: cx + 1, y, z }); if (q.x - p.x > 1e-6) return 1 / (q.x - p.x); }
      return (b.maxX - b.minX) / 2 + (rimZ - z) * 0.4;
    };
    const occK = c.pos.z > rimZ + 1 ? (c.pos.y - gY) / (c.pos.z - rimZ) : 0, occAt = (z) => (occK ? gY - (rimZ - z) * occK : -Infinity);
    const m = domeOf(c, floorY, MT.top, MT.base, rimZ - MT.front);
    const meteor = { x: cx + MT.u * halfAt(m.z, floorY + m.r * 0.5), y: floorY, z: m.z, r: m.r };
    let zFar, top, n, step, zBase;
    if (s === "rim") {
      zBase = Math.min(rowHit(c, Q.wall, floorY), m.z - m.r * 0.6);
      zFar = zBase - (Q.benches - 1) * Q.run;
      top = Math.max(floorY + 1.5, rowHeight(c, zFar, Q.rimAt));
      n = Q.benches; step = (top - floorY) / n;
    } else {
      zFar = m.z - m.r - Q.back;
      top = Math.max(floorY + 4, rowHeight(c, zFar, 0) + 3);   // 出了画面上沿
      step = Q.step; n = Math.ceil((top - floorY) / step) + 1;
      zBase = zFar + (n - 1) * Q.run;
    }
    const halfW = halfAt(zFar, top);
    return {
      rimZ, floorY, zBase, zFar, top, n, step, D: rimZ - zFar, cx, halfW, W: halfW * Q.wide, ref: Math.min(top, rowHeight(c, zFar, 0)), yOcc: floorY,
      sky: b.minZ - zFar + Q.sky, px: pxAt({ x: cx, y: top, z: zFar }), pxAt, occAt, meteor
    };
  }
  /** 第三采矿场的坑壁交给 pitWall 画：几级台阶从坑沿（矿底是画面上沿外面）下到坑底，颜色往暗的雾靠，越往下越暗 */
  const wall3Q = (Q, d) => ({
    step: d.step, run: Q.run, benches: d.n, bottom: d.floorY - 1, seg: Q.seg, jitter: Q.jitter, curve: Q.curve, wide: Q.wide, gap: 1.5, shaft: [0.6, 1.1],
    dim: 1, haze: Q.haze, hazeTo: 1, hazeDark: 0.35, land: Q.land, riser: 0.8, dark: Q.dark
  });
  /** 一片坑底（平的、微微起伏的低多边形地面）：x0–x1、z0（近）–z1（远），高 y；颜色按三角形：tones 随机深浅，越远越往 mist 靠 k；不吃场景的雾 */
  function flatFloor(kit, env, R, o) {
    const THREE = kit.THREE, nx = o.nx || 64, nz = o.nz || 16, V = [], pos = [], col = [], c = new THREE.Color(), mist = new THREE.Color(o.mist);
    for (let i = 0; i <= nx; i++) {
      V.push([]);
      for (let j = 0; j <= nz; j++) {
        const inner = i > 0 && i < nx && j > 0 && j < nz;
        V[i].push([o.x0 + (o.x1 - o.x0) * (i + (inner ? (R() - 0.5) * 0.6 : 0)) / nx, o.y + (j > 0 ? (R() - 0.5) * o.bump : 0), o.z0 + (o.z1 - o.z0) * (j + (inner ? (R() - 0.5) * 0.6 : 0)) / nz]);
      }
    }
    const tri = (a, b, e) => {
      const k = clamp((o.z0 - (a[2] + b[2] + e[2]) / 3) / Math.max(1e-3, o.z0 - o.z1), 0, 1);
      c.set(o.tones[Math.floor(R() * o.tones.length)]).multiplyScalar(0.8 + R() * 0.3).lerp(mist, o.k * k);
      [a, b, e].forEach(p => { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); });
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = V[i][j], b = V[i + 1][j], e = V[i + 1][j + 1], f = V[i][j + 1]; tri(a, b, e); tri(a, e, f); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, fog: false })));
  }
  /** 远景里的一片晶簇（按三种紫分成三个实例网格，标签 what）：list = [{ x, y, z, s（整丛多高）}]，每丛几根（crystalPoses）。返回每丛尖上的点（电弧打在这里） */
  function crystalField(kit, env, P, R, list, what) {
    const THREE = kit.THREE, geo = crystalGeo(kit), o = new THREE.Object3D(), poses = P.crystal.map(() => []), tips = [];
    list.forEach(q => {
      const k0 = Math.floor(R() * P.crystal.length);   // 每丛从哪种紫开始轮
      crystalPoses(R, q.s).forEach((s, i) => poses[(k0 + i) % P.crystal.length].push({ q, s }));
      tips.push({ x: q.x, y: q.y + q.s * 0.95, z: q.z, s: q.s });
    });
    poses.forEach((list2, k) => {
      if (!list2.length) return;
      const im = new THREE.InstancedMesh(geo, env.keep(new THREE.MeshStandardMaterial({ color: P.crystalBase, emissive: P.crystal[k], emissiveIntensity: GLOW.crystalFar, roughness: 0.3, metalness: 0.15, flatShading: true, fog: false })), list2.length);
      list2.forEach(({ q, s }, j) => { o.position.set(q.x + s.x, q.y - q.s * 0.04, q.z + s.z); o.rotation.set(s.rx, s.ry, s.rz, "XZY"); o.scale.set(s.r, s.h / (1 + CRYSTAL.tip), s.r); o.updateMatrix(); im.setMatrixAt(j, o.matrix); });
      env.group.add(tag(im, what || "crystal"));
    });
    return tips;
  }
  /**
   * 陨石：近似圆的一块（球面上一个个月球坑：坑底往下凹、坑沿凸起一圈，再加几大片暗一点的「月海」），月球的灰；半截埋在地里（球心在地面那么高），
   * 只留前上方看得到的面（低多边形）。几成的坑底发紫光（叠一层加色的亮面，泛光会抓到），整块淡淡发紫，背后一圈紫色光晕，前面一盏紫色的点光源照亮附近；
   * 发光慢慢一明一暗（减少动态效果时不动）。m = { x, y, z, r }。返回 表面上朝镜头的几个点（电弧打在这里）
   */
  function meteor(kit, env, P, R, m) {
    const THREE = kit.THREE, MT = METEOR, src = new THREE.IcosahedronGeometry(1, MT.detail).attributes.position, v = new THREE.Vector3();
    const [nC, a0, a1] = MT.craters, craters = [], maria = [];
    for (let i = 0; i < nC; i++) {
      const dir = new THREE.Vector3(R() * 2 - 1, 0.05 + R() * 0.9, R() * 1.3 - 0.3).normalize(), a = a0 + (a1 - a0) * Math.pow(R(), 1.6);
      craters.push({ dir, a, d: a * MT.depth, glow: R() < MT.glow[0] });
    }
    for (let i = 0; i < MT.maria; i++) maria.push({ dir: new THREE.Vector3(R() * 2 - 1, R(), R() * 2 - 1).normalize(), a: 0.35 + R() * 0.45 });
    /** 方向 → 半径倍数 k、在坑里多深 pit（0–1）、发光多亮 glow（0–1）、坑沿 rim、月海 mar（纯函数：同一个方向每次一样，面不裂开） */
    const shape = (dir) => {
      let k = 1, pit = 0, glow = 0, rim = 0, mar = 0;
      craters.forEach(c => {
        const t = dir.angleTo(c.dir) / c.a;
        if (t < 1) { k -= c.d * (1 - t * t); if (1 - t > pit) { pit = 1 - t; glow = c.glow && t < 0.62 ? 1 - t / 0.62 : 0; } }
        else if (t < 1.4) { const u = (t - 1) / 0.4; k += c.d * 0.35 * (1 - u * u); rim = Math.max(rim, 1 - u); }
      });
      maria.forEach(q => { const t = dir.angleTo(q.dir) / q.a; if (t < 1) mar = Math.max(mar, 1 - t * t); });
      return { k: k * (1 + 0.025 * Math.sin(dir.x * 7.1 + dir.y * 3.3) * Math.sin(dir.z * 5.7 - dir.y * 2.1)), pit, glow, rim, mar };
    };
    const pos = [], col = [], gpos = [], gcol = [], c = new THREE.Color(), moon = P.moon.map(x => new THREE.Color(x)), maC = new THREE.Color(P.maria), glowC = new THREE.Color(P.meteorGlow);
    for (let f = 0; f < src.count; f += 3) {
      const ds = [0, 1, 2].map(j => v.fromBufferAttribute(src, f + j).clone().normalize()), cen = ds[0].clone().add(ds[1]).add(ds[2]).normalize();
      if (cen.y < -0.22 || cen.z < -0.45) continue;   // 埋在地下的、背面的不要
      const sh = shape(cen), pts = ds.map(d => d.clone().multiplyScalar(m.r * shape(d).k));
      c.copy(moon[Math.floor(R() * moon.length)]).lerp(maC, sh.mar * 0.65).multiplyScalar((1 - 0.28 * sh.pit) * (1 + 0.12 * sh.rim) * (0.95 + R() * 0.1));
      pts.forEach(p => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); });
      if (sh.glow > 0.05) { const g = glowC.clone().multiplyScalar(MT.glow[1] * (0.35 + 0.65 * sh.glow)); pts.forEach(p => { gpos.push(p.x, p.y, p.z); gcol.push(g.r, g.g, g.b); }); }
    }
    const mk = (p, cl) => { const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(cl, 3)); geo.computeVertexNormals(); return geo; };
    const g = new THREE.Group();
    g.add(new THREE.Mesh(mk(pos, col), env.keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0, emissive: P.meteorGlow, emissiveIntensity: MT.emissive, fog: false }))));
    const glowM = env.keep(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, fog: false }));
    if (gpos.length) g.add(new THREE.Mesh(mk(gpos, gcol), glowM));
    const haloM = env.keep(new THREE.SpriteMaterial({ map: env.keep(kit.smokeTexture()), color: P.meteorGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: MT.halo[1], fog: false }));
    const halo = new THREE.Sprite(haloM);
    halo.scale.setScalar(m.r * MT.halo[0]); halo.position.set(0, m.r * 0.2, -m.r * 0.35); g.add(halo);
    const light = new THREE.PointLight(P.meteorGlow, MT.light[0], m.r * MT.light[1], 2);
    light.position.set(0, m.r * 0.55, m.r * 1.1); g.add(light);
    g.position.set(m.x, m.y, m.z);
    env.group.add(tag(g, "meteor"));
    const [per, amp] = MT.pulse, ph = R() * 6;
    env.anims.push((t, dt) => { const k = dt > 0 ? 1 + amp * Math.sin((t / per) * Math.PI * 2 + ph) : 1; glowM.opacity = k; haloM.opacity = MT.halo[1] * k; light.intensity = MT.light[0] * k; });
    // 电弧打在表面上的几个点：朝镜头、偏上
    const out = [];
    for (let i = 0; i < MT.anchors; i++) {
      const dir = new THREE.Vector3(R() * 1.6 - 0.8, 0.15 + R() * 0.65, 0.5 + R() * 0.5).normalize(), k = shape(dir).k;
      out.push({ x: m.x + dir.x * m.r * k, y: m.y + dir.y * m.r * k, z: m.z + dir.z * m.r * k, meteor: true });
    }
    return out;
  }
  /**
   * 一处紫色电弧（AMBIENT.arc）：时不时在两个点之间跳一道锯齿形的电弧——正对镜头的一条亮带（两头细、中间粗）+ 一道分叉 + 两头的亮点，
   * 一道持续 dur 秒、每 flick 秒重新抖一下；两个点由 pick(r) 挑（晶簇的尖 ↔ 陨石的表面 / 晶簇 ↔ 晶簇），宽窄按那里一个像素多大（pxAt）。
   * 减少动态效果时不跳。返回 Group（userData.ambient.puffs = 亮带和亮点：跳的时候看得见）
   */
  function arcEmitter(kit, env, P, i, pick, pxAt, tex) {
    const THREE = kit.THREE, S = AMBIENT.arc, g = new THREE.Group(), r = A.rand(i * 977 + 41);
    const mat = env.keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(P.arc).multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    const strip = (n) => {
      const idx = [];
      for (let k = 0; k < n; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((n + 1) * 6), 3)); geo.setIndex(idx);
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.visible = false; g.add(m);
      return m;
    };
    const main = strip(S.segs), fork = strip(Math.ceil(S.segs / 2));
    const sparks = [0, 1].map(() => {
      const sp = new THREE.Sprite(env.keep(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(P.arc).multiplyScalar(2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false })));
      sp.visible = false; g.add(sp); return sp;
    });
    /** 亮带的顶点：p0 → p1 一路折几下（中间偏 jag × 长度，两头不偏），宽 w（中间最宽） */
    const lay = (m, p0, p1, w, jag) => {
      const P3 = m.geometry.attributes.position, n = P3.count / 2 - 1, dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
      for (let k = 0; k <= n; k++) {
        const t = k / n, off = k && k < n ? (r() - 0.5) * 2 * jag * len * Math.sin(Math.PI * t) : 0, hw = w * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.1)));
        const x = p0.x + dx * t + nx * off, y = p0.y + dy * t + ny * off, z = p0.z + (p1.z - p0.z) * t;
        P3.setXYZ(k * 2, x - nx * hw, y - ny * hw, z); P3.setXYZ(k * 2 + 1, x + nx * hw, y + ny * hw, z);
      }
      P3.needsUpdate = true; m.geometry.computeBoundingSphere();
      return { x: p0.x + dx * 0.5, y: p0.y + dy * 0.5, z: (p0.z + p1.z) / 2, len };
    };
    let ends = pick(r), acc = 0;
    const shake = () => {
      const [a, b] = ends, w = S.width * pxAt(a), mid = lay(main, a, b, w, S.jag);
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.7), fl = mid.len * (0.3 + r() * 0.25);
      lay(fork, mid, { x: mid.x + Math.cos(ang) * fl, y: mid.y + Math.sin(ang) * fl, z: mid.z }, w * 0.6, S.jag * 1.3);
      [a, b].forEach((p, k) => { sparks[k].position.set(p.x, p.y, p.z); sparks[k].scale.setScalar(S.spark * pxAt(p) * (0.7 + r() * 0.6)); });
    };
    shake();   // 先摆好（没跳的时候藏着）：外框在两个点之间
    const beat = A.beat(r, S.every, S.dur, 0.3 + r() * S.every[1]);
    g.userData.ambient = { kind: "arc", beat, puffs: [main, fork].concat(sparks) };
    env.anims.push((t, dt) => {
      const p = dt > 0 ? beat.step(dt) : -1;
      if (p < 0) { main.visible = fork.visible = false; sparks.forEach(s => { s.visible = false; }); return; }
      if (p === 0) { ends = pick(r); acc = S.flick; }
      if ((acc += dt) >= S.flick) { acc = 0; shake(); main.material.opacity = 0.65 + r() * 0.35; fork.visible = r() < S.fork; }
      main.visible = true; sparks.forEach(s => { s.visible = true; });
    });
    env.group.add(tag(g, "arc"));
    return g;
  }
  /** 电弧的两头怎么挑：随便挑一丛晶体的尖，另一头在离它 reach（像素）以内——先找陨石表面上的点，没有就找别的晶簇；都太远就挑最近的 */
  function arcPicker(tips, anchors, pxAt) {
    const S = AMBIENT.arc, all = tips.concat(anchors);
    return (r) => {
      const a = tips[Math.floor(r() * tips.length)], u = pxAt(a), near = (q) => { const d = Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z) / u; return q !== a && d >= S.reach[0] && d <= S.reach[1]; };
      const m = anchors.filter(near), c = tips.filter(near), list = m.length && (r() < 0.6 || !c.length) ? m : c;
      if (list.length) return [a, list[Math.floor(r() * list.length)]];
      const b = all.filter(q => q !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) - Math.hypot(q.x - a.x, q.y - a.y, q.z - a.z))[0] || a;
      return [a, b];
    };
  }
  /** 矿外（第三采矿场）：站在浅坑的坑边。坑底就在下面不远，看得到它一直铺到远处（越远越暗、越小），对面几级台阶的坑壁和坑沿；
   *  坑底偏右半截埋着巨大的陨石（发紫光）；坑底、坑壁台阶上、这边坑沿上到处是紫色晶簇；几处时不时跳紫色电弧。返回 groundEdge（坑边） */
  function rim3Scene(kit, env, art, P, R, b) {
    const Q = PIT3.rim, CR = CRYSTAL.rim, d = mine3Dims("rim", b, env.cam), M = d.meteor;
    const wall = pitWall(kit, env, wall3Q(Q, d), P, R, d, []);
    env.group.add(wall.mesh);
    env.group.add(tag(flatFloor(kit, env, R, { x0: env.x0, x1: env.x1, z0: d.rimZ, z1: d.zBase - 0.5, y: d.floorY, tones: P.wall, mist: P.mist, k: Q.floor.mist, bump: Q.floor.bump }), "pitFloor"));
    rimLip(kit, env, P, R, d.rimZ);
    const anchors = meteor(kit, env, P, R, M);
    // 晶簇：坑底（看得到的那一截：这边坑沿挡住的地方往后，让开陨石）、对面坑壁的台阶边上、这边坑沿上（灯后面）
    const sz = (p) => A.span(R, CR.px) * d.pxAt(p), list = [], wallList = [], edge = [];
    const zSee = Math.min(d.rimZ - 2, d.rimZ - (L.CONFIG.groundY - d.floorY) / Math.max(0.05, (env.cam && env.cam.pos ? (env.cam.pos.y - L.CONFIG.groundY) / (env.cam.pos.z - d.rimZ) : 0.5)));
    for (let i = 0, tries = 0; list.length < CR.floor && tries < CR.floor * 30; tries++) {
      const z = d.zBase + (zSee - d.zBase) * Math.pow(R(), 0.8), x = d.cx + (R() * 2 - 1) * (d.halfW * 0.95), p = { x, y: d.floorY, z };
      if (Math.hypot(x - M.x, z - M.z) < M.r * 1.08) continue;   // 不长在陨石里
      list.push(Object.assign(p, { s: sz(p) }));
    }
    for (let i = 0; i < CR.wall; i++) { const x = d.cx + (R() * 2 - 1) * d.halfW * 0.9, e = wall.edgeAt(1 + Math.floor(R() * Math.max(1, d.n - 1)), x), p = { x, y: e.y, z: e.z + 0.1 }; wallList.push(Object.assign(p, { s: sz(p) * 0.8 })); }
    for (let i = 0; i < CR.edge; i++) { const s = 0.35 + R() * 0.45; edge.push({ x: d.cx + (R() * 2 - 1) * (env.hx + 8), y: L.CONFIG.groundY, z: d.rimZ - 0.1 - s * 0.5, s }); }   // 整丛都在坑边后面（灯后面）
    const tips = crystalField(kit, env, P, R, list.concat(wallList), "crystal");
    crystalField(kit, env, P, R, edge, "crystal");
    // 电弧：在坑底的晶簇和陨石之间跳
    const tex = env.keep(kit.smokeTexture()), pickArc = arcPicker(tips, anchors, d.pxAt);
    for (let i = 0; i < (art.backdrop.arcs || 0); i++) arcEmitter(kit, env, P, i, pickArc, d.pxAt, tex);
    return d.rimZ;
  }
  /** 矿底（第三采矿场）：站在坑底。战场后面不远就是陨石砸出来的坑（坑沿一排碎石和晶簇，地台外面那片地铺到这里为止），
   *  巨大的陨石半截埋在坑里，几乎占满画面上半截（发紫光）；坑里、坑沿上、战场两边后面到处是紫色晶簇；陨石后面远处是一级级往上的坑壁（暗）；
   *  前景左右两角几块石头；几处时不时跳紫色电弧（晶簇 ↔ 陨石）。返回 groundEdge（陨石坑的坑沿） */
  function floor3Scene(kit, env, art, P, R, b) {
    const Q = PIT3.floor, CR = CRYSTAL.floor, d = mine3Dims("floor", b, env.cam), M = d.meteor, gY = L.CONFIG.groundY;
    const wall = pitWall(kit, env, wall3Q(Q, d), P, R, d, []);
    env.group.add(wall.mesh);
    env.group.add(tag(flatFloor(kit, env, R, { x0: env.x0, x1: env.x1, z0: d.rimZ, z1: d.zBase - 0.5, y: d.floorY, tones: P.wall, mist: P.mist, k: Q.floor.mist, bump: Q.floor.bump }), "pitFloor"));
    rimLip(kit, env, { rock: P.wall }, R, d.rimZ);
    const anchors = meteor(kit, env, P, R, M);
    const sz = (p) => A.span(R, CR.px) * d.pxAt(p), pit = [], lip = [], side = [];
    for (let i = 0, tries = 0; pit.length < CR.pit && tries < CR.pit * 30; tries++) {   // 坑里：陨石周围（不长在陨石里，不过坑沿）
      const a = R() * Math.PI * 2, dist = M.r * (1.1 + R() * 1.4), p = { x: M.x + Math.cos(a) * dist * 1.4, y: d.floorY, z: M.z + Math.sin(a) * dist * 0.7 }, s = sz(p);
      if (p.z + s > d.rimZ - 0.6 || p.z < d.zBase || Math.hypot(p.x - M.x, p.z - M.z) < M.r * 1.04 + s * 0.6) continue;
      pit.push(Object.assign(p, { s }));
    }
    // 坑沿上、战场两边后面（横着在战场外面）：整丛都在坑沿后面（灯后面）
    for (let i = 0; i < CR.lip; i++) { const x = env.cx + (R() * 2 - 1) * (env.hx + 6), s = Math.min(1.1, sz({ x, y: gY, z: d.rimZ }) * 0.7); lip.push({ x, y: gY, z: d.rimZ - 0.2 - s * 0.95, s }); }
    for (let i = 0; i < CR.side; i++) { const sd = i % 2 ? 1 : -1, s = 0.5 + R() * 0.6; side.push({ x: env.cx + sd * (env.hx + 1.6 + R() * 5), y: gY, z: d.rimZ - 0.2 - s * 0.95 - R() * 0.6, s }); }
    const tips = crystalField(kit, env, P, R, pit, "crystal");
    crystalField(kit, env, P, R, lip.concat(side), "crystal");
    if (art.backdrop.fore) foreRocks(kit, env, P, R, b, FORE[art.backdrop.fore]);
    const tex = env.keep(kit.smokeTexture()), pickArc = arcPicker(tips, anchors, d.pxAt);
    for (let i = 0; i < (art.backdrop.arcs || 0); i++) arcEmitter(kit, env, P, i, pickArc, d.pxAt, tex);
    return d.rimZ;
  }

  /* ---------- 挂钩：远景 ---------- */
  /** 天边画的远景：矿外用以前采矿场的那条（远处的厂区 + 坑壁），在对面坑沿后面露出来（低镜头时）；矿内 / 矿底被坑壁整个挡住，用以前的 */
  function band(kit, colors, seed, a) {
    return a.art.depth === "rim" || a.art.depth === "rim3" ? kit.bandTexture("mine", colors, seed) : null;
  }
  /** 中景、矿坑、战场周围的装饰、环境动画（hd2d-backdrop.js · buildBackdrop 交过来）：返回 { groundEdge } */
  function backdrop(kit, env, a) {
    const art = a.art, P = PALETTE[art.palette], b = boundsOf(env), R = A.rand(seedOf(a.key) + Math.round(env.hx * 10) + Math.round(env.hz * 7));
    if (art.depth === "rim") return { groundEdge: rimScene(kit, env, art, P, R, b) };
    if (art.depth === "mid") return { groundEdge: midScene(kit, env, art, P, R, b) };
    if (art.depth === "floor") floorScene(kit, env, art, P, R, b);
    if (art.depth === "rim3") return { groundEdge: rim3Scene(kit, env, art, P, R, b) };
    if (art.depth === "floor3") return { groundEdge: floor3Scene(kit, env, art, P, R, b) };
    return {};
  }
  /** 天幕挪到多远（hd2d-backdrop.js 建天幕前问）：大矿坑的天幕在对面坑壁后面 PIT.sky、第三采矿场的在坑壁后面 PIT3.sky；别的场景照旧（null） */
  function skyGap(bounds, cam, a) {
    if (a.art.backdrop && a.art.backdrop.pit3) return mine3Dims(a.art.backdrop.pit3, bounds, cam).sky;
    return PIT[a.art.pit] ? pitDims(PIT[a.art.pit], bounds, cam).sky : null;
  }

  const pack = { name: "mine", scenes: SCENES, grounds: GROUNDS, art: ART, textures: TEXTURES, decals: DECALS, zone, band, backdrop, skyGap };
  A.add(pack);
  return Object.assign({ PALETTE, PIT, LIFT, WALLS, BERM, FORE, FLOOR, GLOW, PIT3, METEOR, CRYSTAL, AMBIENT, zonePlan, seedOf, pitDims, mine3Dims, crystalPoses, domeOf }, pack);
});
