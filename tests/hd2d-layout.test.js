// HD-2D 战场原型（prototypes/hd2d/）的布局：纯函数，只看战斗状态算位置。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./headless");
const L = require("../prototypes/hd2d/hd2d-layout.js");

const PARTY = ["kolt", "helu", "ruby", "yuito"];
const FOES = [{ id: "guard_sword", lv: 2 }, { id: "thug_knife", lv: 2 }, { id: "buoy", lv: 2 }, { id: "crow", lv: 2 }, { id: "thug_hammer", lv: 2 }];

/** 各种棋盘：直排 2 / 3 区（按 zoneMode）、特殊棋盘 4 直排 / 2×2 / 十字 */
const CASES = [
  { name: "两区直排", opt: { zoneMode: 2 }, links: 1 },
  { name: "三区直排", opt: { zoneMode: 3 }, links: 2 },
  { name: "四区直排", opt: { board: "line4" }, links: 3 },
  { name: "2×2", opt: { board: "square4" }, links: 4 },
  { name: "十字五区", opt: { board: "cross5" }, links: 4 }
];

function setupCase(c, nFoes) {
  const ctx = H.load();
  const st = ctx.BattleSim.setup(Object.assign({
    party: PARTY, seed: "HD2D",
    enemies: FOES.slice(0, nFoes == null ? 4 : nFoes).map(f => Object.assign({ zone: 0 }, f))
  }, c.opt));
  // 敌人都放在规则给的敌方区；这里额外把几个摆到别的区，覆盖「多个区都有单位」
  const ids = st.zoneMode;
  st.units.filter(u => !u.isPlayer).forEach((u, i) => { u.zone = ((i + 1) % ids) + 1; });
  return st;
}

const rect = (x, z, w, d) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const overlap = (a, b, eps = 1e-6) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;

for (const portrait of [false, true]) {
  for (const c of CASES) {
    test(`${c.name}${portrait ? "（竖屏）" : ""}：区不重叠、之间留缝，每个区都有位置`, () => {
      const st = setupCase(c);
      const out = L.build(st, { portrait });
      assert.equal(out.zones.length, st.zoneMode);
      for (let i = 0; i < out.zones.length; i++) {
        for (let j = i + 1; j < out.zones.length; j++) {
          const a = out.zones[i], b = out.zones[j];
          const ra = rect(a.cx, a.cz, a.w, a.d), rb = rect(b.cx, b.cz, b.w, b.d);
          assert.ok(!overlap(ra, rb), `区 ${a.id} 和 ${b.id} 重叠`);
          // 缝：两块地台在 x 或 z 方向上至少隔开 zoneGap（挨着的区正好是 zoneGap，对角的更远）
          const gapX = Math.max(rb.x0 - ra.x1, ra.x0 - rb.x1), gapZ = Math.max(rb.z0 - ra.z1, ra.z0 - rb.z1);
          assert.ok(Math.max(gapX, gapZ) >= L.CONFIG.zoneGap - 1e-6, `区 ${a.id} 和 ${b.id} 之间没有留缝`);
        }
      }
      // 每条连接都有一个间隔，摆在两个区中间
      assert.equal(out.gaps.length, c.links);   // state.gaps 里可能留着上一块棋盘的键，以连接数为准
      out.gaps.forEach(g => {
        const a = out.zones.find(z => z.id === g.a), b = out.zones.find(z => z.id === g.b);
        assert.ok(Math.abs(g.x - (a.cx + b.cx) / 2) < 1e-9 && Math.abs(g.z - (a.cz + b.cz) / 2) < 1e-9);
        assert.ok(Math.abs(g.length - L.CONFIG.zoneGap) < 1e-6, "相邻区的缝宽 = zoneGap");
      });
    });

    test(`${c.name}${portrait ? "（竖屏）" : ""}：同一区的单位站位不重叠，也不出地台`, () => {
      const st = setupCase(c, 5);
      const out = L.build(st, { portrait });
      const shown = st.units.filter(u => !u.hidden && !u.dead);
      assert.equal(out.units.length, shown.length, "每个能看见的单位都有站位");
      const byZone = {};
      out.units.forEach(u => { (byZone[u.zone] = byZone[u.zone] || []).push(u); });
      Object.keys(byZone).forEach(zid => {
        const zone = out.zones.find(z => z.id === Number(zid)), list = byZone[zid];
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          assert.ok(Math.abs(a.x - zone.cx) <= zone.w / 2 && Math.abs(a.z - zone.cz) <= zone.d / 2, "站在地台范围里");
          for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            assert.ok(!overlap(rect(a.x, a.z, a.footprint.w, a.footprint.d), rect(b.x, b.z, b.footprint.w, b.footprint.d)),
              `区 ${zid} 里 ${a.plate.name} 和 ${b.plate.name} 重叠`);
          }
        }
      });
    });
  }
}

test("深渊区：地面单位站在黑洞外面，不压在洞上", () => {
  const st = setupCase({ opt: { board: "cross5" } }, 5);
  st.fields[3].abyss = true;
  st.units.forEach(u => { u.zone = 3; });
  const out = L.build(st);
  const z = out.zones.find(q => q.id === 3);
  assert.ok(z.hole > 0 && z.kind === "abyss");
  out.units.forEach(u => {
    const r = Math.hypot(u.x - z.cx, u.z - z.cz);
    assert.ok(Math.abs(u.z - z.cz) >= z.hole || Math.abs(u.x - z.cx) >= z.hole + 0.5, `${u.plate.name} 压在黑洞上（距中心 ${r.toFixed(2)}）`);
  });
});

test("飞行单位比地面单位高；下潜单位沉在地台面以下", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 4);
  const buoy = st.units.find(u => u.kit === "buoy");
  assert.ok(buoy && buoy.flying, "测试用的浮标是飞行单位");
  const shark = st.units.find(u => !u.isPlayer && !u.flying);
  shark.submerged = true;
  const out = L.build(st);
  const fly = out.units.find(u => u.id === buoy.id);
  const ground = out.units.filter(u => !u.flying && !u.submerged);
  assert.ok(fly.flying && ground.length);
  ground.forEach(g => assert.ok(fly.y > g.y, "飞行比地面高"));
  assert.ok(fly.y - fly.groundY >= L.CONFIG.unit.flyLift - 1e-9);
  const dive = out.units.find(u => u.id === shark.id);
  assert.ok(dive.submerged && dive.y < dive.groundY, "下潜的铭牌沉到地台面以下");
});

test("高地 / 沙珊瑚台地的地台更高，单位跟着站高", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 2);
  st.fields[2].highland = true;
  st.fields[3].coral = true;
  const out = L.build(st);
  const h = id => out.zones.find(z => z.id === id).topY;
  assert.ok(h(2) > h(1) && h(3) > h(1));
  assert.equal(out.zones.find(z => z.id === 3).kind, "coral");
  out.units.filter(u => !u.flying).forEach(u => assert.equal(u.y, h(u.zone)));
});

test("场地 → 地台样子：认得的各有各的，认不得的用默认", () => {
  const st = setupCase({ opt: { board: "square4" } }, 1);
  st.fields[1].acid = true; st.fields[2].quicksand = true; st.fields[3].abyss = true;
  const kinds = L.build(st).zones.map(z => z.kind);
  assert.equal(kinds.join(), "acid,quicksand,abyss,concrete");
  st.fields[4].mystery = true;   // 规则以后新增的场地键：不认识
  assert.equal(L.build(st).zones[3].kind, "concrete");
});

test("间隔：桥 / 墙 / 门 / 空隙按 state.gaps 输出", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 1);
  st.gaps["1-2"] = { type: "bridge", hp: 10, maxHp: 10, open: true, lastFrom: null };
  st.gaps["2-3"] = { type: "door", hp: 0, maxHp: 0, open: false, lastFrom: null };
  const g = L.build(st).gaps;
  assert.equal(g.find(x => x.key === "1-2").type, "bridge");
  const door = g.find(x => x.key === "2-3");
  assert.equal(door.type, "door");
  assert.equal(door.open, false);
});

test("铭牌数据：名字 / 等级 / 血 / 架势 / 状态 / ATK 都有，没有坚毅生命（shp）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 3);
  const SHP = 7771, SHP_MAX = 7772;
  st.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.upOnShp = true; });
  st.units[0].statuses.burn = 3;
  st.units[0].statuses.shock = true;
  st.units[1].dying = true;
  const out = L.build(st);
  const p0 = out.units.find(u => u.id === st.units[0].id).plate;
  assert.equal(p0.name, st.units[0].name);
  assert.equal(p0.level, st.units[0].level);
  assert.equal(p0.atk, st.units[0].atk);
  assert.equal(p0.hp.max, st.units[0].layers.reduce((a, l) => a + l.max, 0));
  assert.equal(p0.def.max, st.units[0].defMax);
  assert.ok(p0.statuses.some(s => s.key === "burn" && s.n === 3) && p0.statuses.some(s => s.key === "shock"));
  assert.ok(out.units.find(u => u.id === st.units[1].id).plate.flags.some(f => f.key === "dying"));
  out.units.forEach(u => {
    const dump = JSON.stringify(u.plate);
    assert.ok(!/shp/i.test(dump), "铭牌数据里不出现 shp 字段");
    assert.ok(!dump.includes(String(SHP)) && !dump.includes(String(SHP_MAX)), "铭牌数据里不出现坚毅生命的数值");
    assert.ok(!u.plate.text.join("|").includes(String(SHP)), "铭牌上要显示的文字里没有 shp");
  });
  assert.ok(!/shp/i.test(JSON.stringify(out.units)), "整个站位输出里都没有 shp");
});

test("藏起来的 / 死了的单位不画；不在棋盘上的区号退回到边上的区", () => {
  const st = setupCase({ opt: { zoneMode: 2 } }, 2);
  const foe = st.units.find(u => !u.isPlayer);
  foe.dead = true;
  st.units.find(u => u.isPlayer).hidden = true;
  const stray = st.units.filter(u => u.isPlayer && !u.hidden)[0];
  stray.zone = 3;   // 两区制里留着的旧 3 区
  const out = L.build(st);
  assert.ok(!out.units.some(u => u.id === foe.id));
  const placed = out.units.find(u => u.id === stray.id);
  assert.ok(placed && placed.zone === out.zones[0].id);
});

test("竖屏：直排沿进深排开，我方区在最前面（z 最大）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 3);
  const out = L.build(st, { portrait: true });
  const z = id => out.zones.find(q => q.id === id).cz;
  assert.ok(z(1) > z(2) && z(2) > z(3));
  out.zones.forEach(q => assert.ok(Math.abs(q.cx) < 1e-9));
  const land = L.build(st);
  const x = id => land.zones.find(q => q.id === id).cx;
  assert.ok(x(1) < x(2) && x(2) < x(3), "横屏：1 区在左，3 区在右");
});

/* ---------- 页面脚本的语法检查 ----------
 * 浏览器里的 three.js 部分 Node 跑不了（要 WebGL），这里至少保证几个模块没有语法错误：
 * 去掉 import / export 之后当普通脚本编译一遍（只编译，不运行）。 */
test("原型的浏览器脚本能通过语法检查，规则文件加载顺序和 headless 一致", () => {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const strip = (src) => src.replace(/^\s*import\s[^;]*?from\s+["'][^"']+["'];?\s*$/gm, "").replace(/^export\s+(default\s+)?/gm, "").replace(/^export\s*\{[^}]*\};?\s*$/gm, "");
  ["hd2d-scene.js", "hd2d-world.js", "hd2d-weather.js", "hd2d-backdrop.js"].forEach(f => {
    assert.doesNotThrow(() => new vm.Script(strip(fs.readFileSync(path.join(dir, f), "utf8")), { filename: f }), f);
  });
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(mod, "index.html 里有页面主脚本");
  assert.doesNotThrow(() => new vm.Script(strip(mod[1]), { filename: "index.html" }));
  // importmap 指向的本地 three.js 文件都在
  const base = path.join(__dirname, "..", "vendor", "three");
  ["three.module.min.js", "addons/controls/OrbitControls.js", "addons/postprocessing/BokehPass.js", "addons/postprocessing/UnrealBloomPass.js",
    "addons/postprocessing/OutputPass.js", "addons/postprocessing/ShaderPass.js", "addons/postprocessing/RenderPass.js", "addons/postprocessing/EffectComposer.js", "addons/renderers/CSS2DRenderer.js"]
    .forEach(f => assert.ok(fs.existsSync(path.join(base, f)), f));
  const tags = [...html.matchAll(/<script src="\.\.\/\.\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.equal(tags.join(), H.RULE_FILES.filter(f => fs.existsSync(path.join(__dirname, "..", f))).join());
});

/* ---------- 第一阶段打磨（issue #191）---------- */
test("铭牌前后错开：同一拨单位不排成一条线，错开后仍不重叠、不出地台（上面的站位测试负责检查）", () => {
  const st = setupCase({ opt: { zoneMode: 3 } }, 0);
  st.units.forEach(u => { u.zone = 1; });
  const out = L.build(st, {});
  const mine = out.units.filter(u => u.side === "player");
  assert.ok(mine.length >= 2);
  assert.ok(L.CONFIG.unit.stagger > 0);
  assert.ok(new Set(mine.map(u => u.z.toFixed(3))).size > 1, "铭牌没有前后错开");
});

test("竖起来的铭牌够大：名字一行放得下 8 个 13px 的汉字，取景范围算上了铭牌的高度", () => {
  const U = L.CONFIG.unit, P = L.CONFIG.plate;
  assert.ok(P.w - 2 * (2 + 5) >= 8 * 13, "桌面铭牌的宽（去掉边框和内边距）放得下 8 个 13px 的汉字（机器人看守（剑））");
  assert.ok(U.plateH >= 1.5, "铭牌是竖着的，取景范围要算上它的高度");
  const out = L.build(setupCase({ opt: { zoneMode: 3 } }, 4), {});
  out.units.forEach(u => assert.ok(out.bounds.maxY >= u.groundY + U.plateH - 1e-9, "取景范围包得住铭牌"));
});

test("原型页面：垫片放在规则文件之前，页面自己的元素 id 整个匹配，旧计算器的元素都交给替身（修 app.js init() 的 null 报错）", () => {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  const shim = html.indexOf("Document.prototype.getElementById"), rules = html.indexOf('<script src="../../run.js">');
  assert.ok(shim > 0 && shim < rules, "垫片要在规则文件之前");
  assert.ok(html.includes("window.GAME_MODE = true"), "和 game.html 一样打开 GAME_MODE（也让坚毅生命数值对玩家不可见）");
  const own = new RegExp(/var OWN = \/(.*)\/;/.exec(html)[1]);
  // 页面自己的元素（#calc-core 里放的是旧计算器的元素，不算）都在 OWN 里
  const pageHtml = html.replace(/<div id="calc-core"[\s\S]*?<\/div>/, "");
  const ids = [...html.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]).concat([...pageHtml.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  ids.filter(id => id !== "spray").forEach(id => assert.ok(own.test(id), `页面元素 #${id} 会被垫片当成计算器元素`));
  // app.js 的 init() 用到的每一个元素（以前 partySize 被前缀 party 拦下、拿到 null）都不在 OWN 里
  const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = app.indexOf("\nfunction init() {"), end = app.indexOf("\nif (HAS_DOM) init();");
  assert.ok(start > 0 && end > start, "找得到 app.js 的 init()");
  const used = [...new Set([...app.slice(start, end).matchAll(/uiEl\("([^"]+)"\)/g)].map(m => m[1]))];
  assert.ok(used.length >= 40 && used.includes("partySize") && used.includes("zoneMode"));
  used.forEach(id => assert.ok(!own.test(id), `init() 用到的 #${id} 应该交给替身`));
  ["logPageLabel", "skillBtns", "zones"].forEach(id => assert.ok(!own.test(id), id + " 应该交给替身"));
  // 必须是真下拉框的那个（syncBladeSel 会逐个改 options）放在 #calc-core 里
  assert.ok(/<div id="calc-core"[^>]*>[\s\S]*<select id="bladeSel">[\s\S]*value="niu"[\s\S]*value="naruto"[\s\S]*<\/select>[\s\S]*?<\/div>/.test(html), "bladeSel 是真的下拉框");
});

test("危墙：矮而薄（尺寸在配置表 WALL 里），不会盖住铭牌", () => {
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-world.js"), "utf8");
  const w = /const WALL = \{([^}]*)\}/.exec(src);
  assert.ok(w, "危墙尺寸在配置表 WALL 里");
  const v = k => Number(new RegExp(k + ":\\s*([\\d.]+)").exec(w[1])[1]);
  assert.ok(v("baseH") + 3 * v("varyH") <= L.CONFIG.unit.plateH * 0.9, "墙最高不超过铭牌高度");
  assert.ok(v("maxThick") <= 0.6, "墙要薄");
});

test("手机顶栏：有精简文字和切换小按钮；铭牌 HTML 不碰 shp", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8"), css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  assert.ok(html.includes('id="tb-compact"') && html.includes('id="demo-btn"'));
  assert.ok(/@media \(max-width: 720px\)[\s\S]*#demo-select[^{]*\{[^}]*display: none/.test(css), "手机上下拉框收起来");
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8");
  assert.ok(!/shp/i.test(scene.slice(scene.indexOf("function plateHtml"), scene.indexOf("function makePlate"))), "铭牌 HTML 不碰 shp");
});

/* ---------- 第一阶段打磨第二轮（issue #202）---------- */
const D2R = Math.PI / 180;
const DESKTOP = { width: 1440, height: 900, top: 46, bottom: 160 };   // 桌面 1440×900：顶栏 + 展开的技能栏
/** 独立写的透视投影（不用布局里的 project）：按布局给的默认镜头，把世界坐标投到屏幕像素（左上角为原点，y 向下） */
function screenOf(cam, p) {
  const e = cam.elevation * D2R, t = Math.tan(cam.fov * D2R / 2);
  const dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z;
  const ahead = -(dy * Math.sin(e) + dz * Math.cos(e));      // 沿视线往前多远
  const up = dy * Math.cos(e) - dz * Math.sin(e);             // 镜头的「上」方向
  return { x: (dx / (ahead * t * cam.aspect) + 1) / 2 * cam.width, y: (1 - up / (ahead * t)) / 2 * cam.height, dist: Math.hypot(dx, dy, dz) };
}
/** 一块铭牌在屏幕上的矩形：底边中点 = 脚下的点往上 lift 像素；大小 = 铭牌的像素尺寸 × 按远近的缩放；上下各让出浮动的幅度 */
function plateBox(out, u) {
  const P = L.CONFIG.plate, cam = out.camera, s = screenOf(cam, u);
  const k = Math.min(P.maxScale, Math.max(P.minScale, Math.pow(cam.dist / s.dist, P.scaleExp)));
  const w = out.plateSize.w * k, h = out.plateSize.h * k;
  return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - u.lift - h - P.bob, y1: s.y - u.lift + P.bob };
}
const boxesOverlap = (a, b) => a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01;
/** 两两比一遍，返回重叠的那几对（名字） */
function overlapsOf(out, list) {
  list = list || out.units;
  const bad = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (boxesOverlap(plateBox(out, list[i]), plateBox(out, list[j]))) bad.push(list[i].plate.name + " × " + list[j].plate.name);
  }
  return bad;
}
/** 4 个我方单位都在我方区，nFoes 个敌人也挤进同一区，其余敌人放到别的区 */
function crowded(opt, nFoes) {
  const ctx = H.load();
  const st = ctx.BattleSim.setup(Object.assign({
    party: PARTY, seed: "HD2D", enemies: FOES.slice(0, Math.max(1, nFoes)).map(f => Object.assign({ zone: 0 }, f))
  }, opt));
  const pz = st.units.find(u => u.isPlayer && !u.hidden).zone;
  st.units.filter(u => !u.isPlayer).forEach((u, i) => { u.zone = i < nFoes ? pz : ((i + 1) % st.zoneMode) + 1; });
  return { st, pz };
}

test("默认镜头：布局算的镜头正对目标点，整个战场装在顶栏和技能栏之间（桌面 1440×900；场景直接用这个镜头）", () => {
  for (const c of CASES) {
    const out = L.build(setupCase(c), { view: DESKTOP });
    const cam = out.camera;
    const mid = screenOf(cam, cam.target);
    assert.ok(Math.abs(mid.x - 720) < 0.5 && Math.abs(mid.y - 450) < 0.5, c.name + "：目标点在画面正中");
    const b = out.bounds;
    [b.minX, b.maxX].forEach(x => [0, b.maxY + 0.5].forEach(y => [b.minZ, b.maxZ].forEach(z => {
      const s = screenOf(cam, { x, y, z });
      assert.ok(s.x >= 0 && s.x <= DESKTOP.width && s.y >= DESKTOP.top - 0.5 && s.y <= DESKTOP.height - DESKTOP.bottom + 0.5, `${c.name}：战场的角 (${x}, ${y}, ${z}) 跑出了可用区域`);
    })));
  }
  const fs = require("fs"), path = require("path");
  const scene = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-scene.js"), "utf8");
  assert.ok(/layout\.camera/.test(scene) && /L\.CONFIG\.camera\.fov/.test(scene), "场景用布局算好的镜头（铭牌的屏幕位置才对得上）");
});

test("同一区 4 个我方单位：每两块铭牌在屏幕上的矩形都不重叠（桌面 1440×900，各种棋盘）", () => {
  for (const c of CASES) {
    const { st, pz } = crowded(c.opt, 0);
    const out = L.build(st, { view: DESKTOP });
    const mine = out.units.filter(u => u.zone === pz);
    assert.equal(mine.length, 4, c.name + "：我方 4 人都在同一区");
    assert.deepEqual(overlapsOf(out, mine), [], c.name + "：同一区的铭牌互相压住");
    assert.deepEqual(overlapsOf(out), [], c.name + "：整个战场有铭牌互相压住");
  }
});

test("同一区挤 6 个、8 个、9 个单位（敌我混站，有飞行的）也不重叠；窗口大小、技能栏收起来都一样", () => {
  const views = [DESKTOP, Object.assign({}, DESKTOP, { bottom: 60 }), { width: 1920, height: 1080, top: 46, bottom: 160 }, { width: 1280, height: 720, top: 46, bottom: 160 }];
  for (const c of CASES) {
    for (const n of [2, 4, 5]) {
      const { st, pz } = crowded(c.opt, n);
      views.forEach(v => {
        const out = L.build(st, { view: v });
        assert.equal(out.units.filter(u => u.zone === pz).length, 4 + n);
        assert.deepEqual(overlapsOf(out), [], `${c.name}，同区 ${4 + n} 人，${v.width}×${v.height}`);
        out.units.forEach(u => assert.ok(u.lift >= 0 && u.lift <= L.CONFIG.plate.maxLift, "抬高在 0–maxLift 之间"));
      });
    }
  }
});

test("后排抬高：前后排叠到时整排往上抬（同一排抬得一样高），布局给的屏幕矩形和独立投影一致", () => {
  const { st, pz } = crowded({ zoneMode: 3 }, 2);
  const out = L.build(st, { view: DESKTOP });
  const rows = {};
  out.units.filter(u => u.zone === pz).forEach(u => { (rows[u.row] = rows[u.row] || []).push(u); });
  assert.ok(Object.keys(rows).length >= 2, "6 个人分了几排");
  Object.values(rows).forEach(r => assert.equal(new Set(r.map(u => u.lift)).size, 1, "同一排抬得一样高"));
  assert.ok(out.units.some(u => u.lift > 0), "有一排被抬高了");
  out.units.forEach(u => {
    const b = plateBox(out, u);
    ["x0", "x1", "y0", "y1"].forEach(k => assert.ok(Math.abs(b[k] - u.rect[k]) < 0.5, `${u.plate.name} 的 ${k}：布局 ${u.rect[k]} / 投影 ${b[k]}`));
  });
});

/* 三个演示战场：和 index.html 的 DEMOS 一样的布置 */
const gapOf = (type, hp, open) => ({ type, hp: hp || 0, maxHp: hp || 0, open: open !== false, lastFrom: null });
const DEMO_SETUPS = {
  mine(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    st.units.find(u => u.kit === "kolt").statuses.burn = 2; st.units.find(u => u.kit === "guard_gun").statuses.shock = true;
    return st;
  },
  desert(S) {
    const st = S.setup({ party: PARTY, board: "square4", weather: "sand", seed: "hd2d-desert", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.fields[4].coral = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    const shark = st.units.find(u => u.kit === "sandfish_ambush"); if (shark) shark.submerged = true;
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
    st.fields[1].abyss = true; st.fields[2].highland = true; st.fields[3].electric = true; st.fields[4].acid = true;
    st.gaps["1-3"] = gapOf("void"); st.gaps["2-3"] = gapOf("door", 0, false); st.gaps["3-4"] = gapOf("bridge", 12);
    st.units.find(u => u.kit === "guard_gun").stunned = true;
    return st;
  }
};

test("三个演示战场（桌面 1440×900）：铭牌两两不重叠，都在顶栏和技能栏之间；铭牌文字里没有 shp 数值", () => {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  Object.keys(DEMO_SETUPS).forEach(id => {
    assert.ok(html.includes(`id: "${id}"`), "index.html 里有演示战场 " + id);
    const st = DEMO_SETUPS[id](H.load().BattleSim);
    st.units.forEach(u => { u.shp = 7771; u.shpMax = 7772; });
    const out = L.build(st, { view: DESKTOP });
    assert.ok(out.units.length >= 8, id + "：单位都排上了");
    assert.deepEqual(overlapsOf(out), [], id + "：铭牌互相压住");
    out.units.forEach(u => {
      const b = plateBox(out, u);
      assert.ok(b.y0 >= DESKTOP.top && b.y1 <= DESKTOP.height - DESKTOP.bottom && b.x0 >= 0 && b.x1 <= DESKTOP.width, `${id}：${u.plate.name} 的铭牌被顶栏 / 技能栏 / 画面边缘挡住`);
      assert.ok(!u.plate.text.join("|").includes("7771") && !JSON.stringify(u.plate).includes("7772"), "铭牌文字里没有坚毅生命的数值");
    });
  });
});

test("远景剪影的高度上限：画面上沿那条视线（frameTop）上的点正好投到画面最上沿；剪影只用到它的一部分", () => {
  Object.keys(DEMO_SETUPS).forEach(id => {
    const out = L.build(DEMO_SETUPS[id](H.load().BattleSim), { view: DESKTOP });
    const cam = out.camera;
    [-2, -5, -9, -14].forEach(dz => {
      const z = out.bounds.minZ + dz, s = screenOf(cam, { x: 3, y: L.frameTop(cam, z), z });
      assert.ok(Math.abs(s.y) < 0.5, `${id}：z=${z} 处 frameTop 投到 y=${s.y.toFixed(2)}，应该是画面最上沿`);
    });
  });
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-backdrop.js"), "utf8");
  const fill = Number(/fill:\s*([\d.]+)/.exec(src)[1]);
  assert.ok(fill > 0.5 && fill < 1, "中景剪影最高只到画面上沿视线的 fill 倍（整个轮廓都在画面里）");
  assert.ok(/L\.frameTop\(cam, z\)/.test(src), "远景用布局的 frameTop 算高度上限");
});

test("原型页面：照页面的顺序跑垫片 → 规则文件，app.js 的 init() 跑完不报错；演示战场在页面环境里也排得出来（issue #202）", () => {
  const fs = require("fs"), path = require("path");
  const P = require("./hd2d-fake-page");
  const page = P.load();
  assert.deepEqual(page.errors, [], "加载时报错");
  // 旧计算器的元素都拿到了替身（init() 前后一共几十个），bladeSel 用的是页面里那个真下拉框
  const core = page.document.getElementById("calc-core");
  const ids = core.childNodes.map(c => c.id);
  ["presetSelect", "zoneMode", "partySize", "weather", "phaseStep", "attackerSel", "btnApply"].forEach(id => assert.ok(ids.includes(id), id + " 有替身"));
  assert.equal(page.document.getElementById("bladeSel").tagName, "SELECT");
  // 页面环境里跑演示战场的布置和布局
  Object.keys(DEMO_SETUPS).forEach(id => {
    const out = page.ctx.HD2DLayout.build(DEMO_SETUPS[id](page.ctx.BattleSim), { view: DESKTOP });
    assert.ok(out.units.length >= 8, id);
  });
  assert.deepEqual(page.errors, [], "跑演示战场时报错");
  // 这个假网页抓得到以前的报错：按前缀放行的旧垫片在 partySize 报错（app.js:13680），没有真下拉框时 syncBladeSel 报错
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  const old = P.load({ html: html.replace(/var OWN = \/.*\/;/, "var OWN = /^(stage|vignette|topbar|tb-|demo-|party|log|dock|skills|toast|loading|calc-core)/;") });
  assert.ok(old.errors.some(e => /partySize/.test(e)), "旧垫片：partySize 拿到 null");
  const noSel = P.load({ html: html.replace(/<select id="bladeSel">[\s\S]*?<\/select>/, "") });
  assert.ok(noSel.errors.some(e => /options/.test(e)), "替身 div 没有 options");
});

test("减少动态效果：场景跟着系统设置停住待机动画（铭牌浮动、闪烁、冒泡、光圈旋转、飘浮物、颗粒、闪电）", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8"), css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  const weather = fs.readFileSync(path.join(dir, "hd2d-weather.js"), "utf8");
  assert.ok(/prefers-reduced-motion: reduce/.test(scene) && /addEventListener\("change"/.test(scene), "场景听系统的「减少动态效果」，中途切换也跟着变");
  assert.ok(/const moving = state\.motion, adt = moving \? dt : 0/.test(scene) && /animT \+= adt/.test(scene), "动画时间只在允许动的时候走（地台动画、远景、天气、颗粒、光圈都按 animT）");
  assert.ok(/if \(state\.motion\)/.test(scene), "路灯只在允许动的时候闪");
  assert.ok(/const fl = moving \? weather\.flash : 0/.test(scene) && /dt === 0/.test(weather), "减少动态效果时不打闪电");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.pl-bob[^}]*animation: none/.test(css) && /\.still \.pl-bob/.test(css), "铭牌的浮动停掉");
});

/* 场景里的积木（地台 / 间隔 / 远景 / 天气）只建 three.js 的物体，不碰 WebGL：在 Node 里用 vendor 的真 three.js 建一遍、跑几帧动画。
 * canvas 程序纹理用一个什么都接受的假 2D 画布代替（这里只查会不会报错，画得好不好看要在浏览器里看） */
test("场景的积木在 Node 里用真的 three.js 建得出来：各种地台、间隔、远景、天气和飘浮物，动画跑几帧（含「减少动态效果」的停住）不报错", async (t) => {
  const mod = require("node:module"), path = require("path"), { pathToFileURL } = require("url");
  if (typeof mod.register !== "function") { t.skip("这个 Node 版本没有 module.register"); return; }
  const threeUrl = pathToFileURL(path.join(__dirname, "..", "vendor", "three", "three.module.min.js")).href;
  mod.register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
    if (s === "three") return { url: ${JSON.stringify(threeUrl)}, format: "module", shortCircuit: true };
    const r = await n(s, c);
    return /\\/(prototypes\\/hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
  }`));
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L };
  try {
    const dir = path.join(__dirname, "..", "prototypes", "hd2d"), url = (f) => pathToFileURL(path.join(dir, f)).href;
    const THREE = await import(threeUrl);
    const W = await import(url("hd2d-world.js")), B = await import(url("hd2d-backdrop.js")), WX = await import(url("hd2d-weather.js"));
    const scene = new THREE.Scene();
    const kinds = ["concrete", "abyss", "acid", "quicksand", "coral", "highland", "fire", "ice", "electric", "energy", "harmonic", "heal"];
    for (const theme of ["day", "dusk", "night"]) {
      const ctx = { anim: [], lamps: [], fxLights: 0, theme };
      kinds.forEach((k, i) => {
        const fk = L.fieldKinds({ [k === "fire" ? "fireOn" : k]: true }), high = k === "highland" || k === "coral";
        scene.add(W.buildZone({ id: i + 1, cx: i * 10, cz: 0, w: 7.2, d: 7.2, h: high ? 1.6 : 0.8, topY: high ? 1.6 : 0.8, kind: fk.kind, effects: fk.effects, highland: high, hole: k === "abyss" ? 1.44 : 0 }, ctx));
      });
      ["bridge", "wall", "door", "void", "open"].forEach((type, i) => scene.add(W.buildGap({ key: "1-2", a: 1, b: 2, type, open: i % 2 === 0, hp: 5, maxHp: 10, x: 0, z: 0, axis: i % 2 ? "z" : "x", length: 2.6, width: 7.2, topY: 0.8 }, ctx)));
      for (let f = 0; f < 6; f++) ctx.anim.forEach(fn => fn(f * 0.37, 0.016));
      ctx.anim.forEach(fn => fn(1, 0));
      assert.ok(ctx.anim.length >= 6 && ctx.lamps.length > 0, "有待机动画、有路灯");
      ctx.lamps.forEach(l => assert.ok(l.bulb && l.bulbColor && l.wait > 0 && l.flick === 0, "路灯带着闪烁要用的数据"));
    }
    const st = DEMO_SETUPS.mine(H.load().BattleSim), out = L.build(st, { view: DESKTOP });
    for (const [kind, theme] of [["mine", "dusk"], ["desert", "day"], ["night", "night"], ["wasteland", "day"]]) {
      const bd = B.buildBackdrop(kind, out.bounds, theme, out.camera, { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72 });
      bd.update(1.2, 0.016); bd.update(1.2, 0);
      const box = new THREE.Box3();
      let objects = 0;
      bd.group.children.forEach(o => {
        if (o.isSprite || !o.isObject3D || (o.geometry && !o.geometry.type.endsWith("Geometry"))) return;
        if (o.material && (o.material.type === "ShaderMaterial" || o.material.map)) return;   // 天幕、天边那圈画的远景
        if (o.geometry && o.geometry.type === "BufferGeometry") return;
        if (o.isMesh && o.geometry.type === "SphereGeometry" && o.material.type === "MeshBasicMaterial") return;   // 红灯、远处的炉火
        box.setFromObject(o); objects++;
        if (kind !== "night") assert.ok(box.max.y <= L.frameTop(out.camera, box.max.z) * 0.9, `${kind}：中景剪影冒出画面上沿（${box.max.y.toFixed(1)}）`);
      });
      assert.ok(objects >= 6, kind + "：中景剪影有好几个");
      bd.dispose();
    }
    B.buildGround(); B.skyTexture(["#000", "#111", "#222", "#333"], true);
    const fx = WX.createWeather(scene, { bounds: out.bounds });
    for (const w of ["none", "sand", "snow", "acid", "thunder", "heat", "glow", "phase"]) {
      for (const theme of ["day", "dusk", "night"]) { fx.set(w, theme); fx.update(0.016, 3.3); fx.update(0, 3.3); }
    }
    assert.ok(Object.keys(WX.AMBIENT).length >= 8 && WX.AMBIENT.clear.dusk, "各种天气都有自己的飘浮物，晴天按光影主题");
    fx.dispose(); W.disposeTree(scene);
  } finally {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  }
});

test("铭牌：紧凑版只放名字 + 状态小圆点 + 血条 + 架势，ATK / 血量数字 / 状态文字悬停、选中时才展开；尺寸和布局用同一份配置", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8"), css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  const html = scene.slice(scene.indexOf("function plateHtml"), scene.indexOf("function makePlate"));
  const card = html.slice(html.indexOf('class="pl-card"')), more = html.slice(html.indexOf('class="pl-more"'), html.indexOf('class="pl-card"'));
  assert.ok(/pl-name/.test(card) && /pl-bar/.test(card) && /pl-def/.test(card) && /pl-dots/.test(card), "卡片上：名字、状态小圆点、血条、架势");
  assert.ok(!/ATK/.test(card) && /ATK/.test(more) && /pl-chips/.test(more), "ATK、状态文字在展开的详情里");
  assert.ok(/\.hd2d-plate\.hover \.pl-more, \.hd2d-plate\.sel \.pl-more \{ display: block; \}/.test(css), "悬停 / 选中时展开");
  assert.ok(/--pw/.test(scene) && /plateSize/.test(scene) && /width: var\(--pw\); height: var\(--ph\)/.test(css), "卡片的宽高用布局的 CONFIG.plate");
});
