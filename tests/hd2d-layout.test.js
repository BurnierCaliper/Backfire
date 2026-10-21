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
  // 规则文件（和 headless 一个顺序），后面接联机的展示白名单 online-view.js（#204：画面只用它投影过的状态），
  // 再接正式游戏的 2D 演出 attack-fx.js / hit-fx.js（#230：攻击演出和受击粒子，原样加载）
  const tags = [...html.matchAll(/<script src="\.\.\/\.\.\/([^"]+)"><\/script>/g)].map(m => m[1]);
  assert.equal(tags.join(), H.RULE_FILES.filter(f => fs.existsSync(path.join(__dirname, "..", f))).concat(["online-view.js", "attack-fx.js", "hit-fx.js"]).join());
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
/* 和 index.html 的演示一样，区域、光影当成布置战场写进战斗状态（BattleSim.setup 的 region / light，#229） */
const DEMO_SETUPS = {
  mine(S) {
    const st = S.setup({ party: PARTY, zoneMode: 3, seed: "hd2d-mine", region: "第一采矿场", light: "dusk", enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 2 }, { id: "boomcar", lv: 2, zone: 2 }] });
    st.fields[2].acid = true; st.fields[3].highland = true; st.gaps["1-2"] = gapOf("bridge", 12); st.gaps["2-3"] = gapOf("wall", 20, false);
    st.units.find(u => u.kit === "kolt").statuses.burn = 2; st.units.find(u => u.kit === "guard_gun").statuses.shock = true;
    return st;
  },
  desert(S) {
    const st = S.setup({ party: PARTY, board: "square4", weather: "sand", seed: "hd2d-desert", region: "沙漠", light: "day", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 1 }, { id: "sandfish_lead", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 4 }, { id: "sand_human", lv: 2, zone: 4 }] });
    st.fields[1].quicksand = true; st.fields[4].coral = true; st.gaps["1-3"] = gapOf("void"); st.gaps["2-4"] = gapOf("bridge", 10);
    const shark = st.units.find(u => u.kit === "sandfish_ambush"); if (shark) shark.submerged = true;
    return st;
  },
  cross(S) {
    const st = S.setup({ party: PARTY, board: "cross5", weather: "thunder", seed: "hd2d-cross", region: "外城区", light: "night", enemies: [{ id: "crow", lv: 2, zone: 1 }, { id: "buoy", lv: 2, zone: 1 }, { id: "thug_hammer", lv: 2, zone: 3 }, { id: "guard_gun", lv: 2, zone: 4 }] });
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

test("减少动态效果：场景跟着系统设置停住待机动画（铭牌浮动、闪烁、冒泡、光圈旋转、飘浮物、颗粒）；雷击不抖镜头、闪光减弱", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8"), css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  const weather = fs.readFileSync(path.join(dir, "hd2d-weather.js"), "utf8");
  assert.ok(/prefers-reduced-motion: reduce/.test(scene) && /addEventListener\("change"/.test(scene), "场景听系统的「减少动态效果」，中途切换也跟着变");
  assert.ok(/const moving = state\.motion, adt = moving \? dt : 0/.test(scene) && /animT \+= adt/.test(scene), "动画时间只在允许动的时候走（地台动画、远景、天气、颗粒、光圈都按 animT）");
  assert.ok(/if \(state\.motion\)/.test(scene), "路灯只在允许动的时候闪");
  // 雷击按真实时间走（减少动态效果时照样打），要不要减弱交给天气（闪光打折、不给抖动，行为见下面雷击的测试）
  assert.ok(/weather\.update\(adt, animT, \{ dt, reduced: !moving \}\)/.test(scene) && /opts\.reduced/.test(weather), "减少动态效果时雷击照打，但由天气减弱闪光、不抖镜头");
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.pl-bob[^}]*animation: none/.test(css) && /\.still \.pl-bob/.test(css), "铭牌的浮动停掉");
});

/* 场景里的积木（地台 / 间隔 / 远景 / 天气）只建 three.js 的物体，不碰 WebGL：在 Node 里用 vendor 的真 three.js 建一遍、跑几帧动画。
 * canvas 程序纹理用一个什么都接受的假 2D 画布代替（这里只查会不会报错、建出来什么，画得好不好看要在浏览器里看）。
 * protoEnv(t)：把 "three" 指到 vendor 的 three.js，临时放上假的 document / window，import 原型的几个模块；用完 restore() */
let protoHooked = false;
async function protoEnv(t) {
  const mod = require("node:module"), path = require("path"), { pathToFileURL } = require("url");
  if (typeof mod.register !== "function") { t.skip("这个 Node 版本没有 module.register"); return null; }
  const threeUrl = pathToFileURL(path.join(__dirname, "..", "vendor", "three", "three.module.min.js")).href;
  if (!protoHooked) {
    protoHooked = true;
    mod.register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
      if (s === "three") return { url: ${JSON.stringify(threeUrl)}, format: "module", shortCircuit: true };
      const r = await n(s, c);
      return /\\/(prototypes\\/hd2d|vendor\\/three)\\//.test(r.url) ? Object.assign({}, r, { format: "module" }) : r;
    }`));
  }
  const any = () => new Proxy(function () {}, { get: (o, k) => (k === Symbol.toPrimitive ? () => 0 : any()), set: () => true, apply: () => any() });
  const keep = { document: globalThis.document, window: globalThis.window };
  const restore = () => {
    globalThis.document = keep.document; globalThis.window = keep.window;
    if (keep.document === undefined) delete globalThis.document;
    if (keep.window === undefined) delete globalThis.window;
  };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => any() }) };
  globalThis.window = { HD2DLayout: L };
  try {
    const dir = path.join(__dirname, "..", "prototypes", "hd2d"), url = (f) => pathToFileURL(path.join(dir, f)).href;
    const THREE = await import(threeUrl);
    const W = await import(url("hd2d-world.js")), B = await import(url("hd2d-backdrop.js")), WX = await import(url("hd2d-weather.js"));
    return { THREE, W, B, WX, restore };
  } catch (e) { restore(); throw e; }
}

test("场景的积木在 Node 里用真的 three.js 建得出来：各种地台、间隔、远景、天气和飘浮物，动画跑几帧（含「减少动态效果」的停住）不报错", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, W, B, WX } = P;
  try {
    const scene = new THREE.Scene();
    const kinds = ["concrete", "abyss", "acid", "quicksand", "coral", "highland", "fire", "ice", "electric", "energy", "harmonic", "heal"];
    for (const theme of ["day", "dusk", "night"]) {
      const ctx = { anim: [], lamps: [], fxLights: 0, theme };
      kinds.forEach((k, i) => {
        const fk = L.fieldKinds({ [k === "fire" ? "fireOn" : k]: true }), high = k === "highland" || k === "coral";
        scene.add(W.buildZone({ id: i + 1, cx: i * 10, cz: 0, w: 7.2, d: 7.2, h: high ? 1.6 : 0.8, topY: high ? 1.6 : 0.8, kind: fk.kind, effects: fk.effects, highland: high, hole: k === "abyss" ? 1.44 : 0 }, ctx));
      });
      ["bridge", "wall", "door", "void", "open"].forEach((type, i) => scene.add(W.buildGap({ key: "1-2", a: 1, b: 2, type, open: i % 2 === 0, hp: 5, maxHp: 10, x: 0, z: 0, axis: i % 2 ? "z" : "x", length: 2.6, width: 7.2, topY: 0.8 }, ctx)));
      // 各区域的默认地台（含垫高的高地）
      Object.keys(L.GROUNDS).forEach((key, i) => [false, true].forEach(high => {
        const h = high ? 1.6 : 0.8;
        scene.add(W.buildZone({ id: 40 + i * 2 + (high ? 1 : 0), cx: i * 10, cz: 12, w: 7.2, d: 7.2, h, topY: h, kind: high ? "highland" : "concrete", effects: high ? ["highland"] : [], highland: high, hole: 0, ground: key === L.GROUND_DEFAULT ? null : key }, ctx));
      }));
      assert.equal(ctx.lamps.length, 0, "地台上不再放路灯（灯在战场外缘，见下面「路灯」的测试）");
      scene.add(W.buildLamps([{ x: -8, z: -6, kind: "street", color: 0xffd9a0, dir: 1 }, { x: 8, z: -6, kind: "hanging", color: 0xffc06a, dir: -1 }], ctx));
      for (let f = 0; f < 6; f++) ctx.anim.forEach(fn => fn(f * 0.37, 0.016));
      ctx.anim.forEach(fn => fn(1, 0));
      assert.ok(ctx.anim.length >= 6 && ctx.lamps.length === 2, "有待机动画、有灯");
      ctx.lamps.forEach(l => assert.ok(l.bulb && l.bulbColor && l.wait > 0 && l.flick === 0, "路灯带着闪烁要用的数据"));
    }
    const st = DEMO_SETUPS.mine(H.load().BattleSim), out = L.build(st, { view: DESKTOP });
    for (const [kind, theme, storm] of [["mine", "dusk"], ["desert", "day"], ["night", "night"], ["wasteland", "day"], ["night", "night", true], ["mine", "dusk", true], ["desert", "day", true]]) {
      const bd = B.buildBackdrop(kind, out.bounds, theme, out.camera, { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72, storm });
      bd.update(1.2, 0.016); bd.update(1.2, 0); bd.update(1.3, 0.016, { flash: 0.8, x: 2 });
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
  } finally { P.restore(); }
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

/* ---------- 雷鸣不下雨（#202 第二轮截图验收后主人的要求）：雷鸣只有乌云 + 随机雷击，酸雨照旧下雨 ---------- */
/** 雨：雨丝（lines），或者往下落得飞快的粒子（雪每秒只落 1.3，不算） */
const isRain = (c) => !!c && (c.kind === "lines" || (Array.isArray(c.vel) && c.vel[1] < -3));
/** 场景里有几组「雨」：雨丝（LineSegments），或者一半以上的点每秒往下落 3 个单位以上的粒子（按真的顶点位置量） */
function rainIn(scene, fx) {
  fx.update(1 / 60, 1, { dt: 1 / 60 });
  const before = new Map();
  scene.traverse(o => { if ((o.isPoints || o.isLineSegments) && o.geometry.attributes.position) before.set(o, Float32Array.from(o.geometry.attributes.position.array)); });
  fx.update(1 / 60, 1.05, { dt: 1 / 60 });
  let n = 0;
  before.forEach((a, o) => {
    const b = o.geometry.attributes.position.array, dy = [];
    for (let i = 1; i < a.length; i += 3) dy.push((b[i] - a[i]) / 0.05);
    dy.sort((p, q) => p - q);
    if (o.isLineSegments || dy[dy.length >> 1] < -3) n++;
  });
  return n;
}
/** 固定种子的随机数：雷击的间隔、位置每次跑都一样 */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const STORM_BOUNDS = { minX: -13.4, maxX: 13.4, minZ: -13.4, maxZ: 13.4 };
/** 跑 secs 秒雷鸣（每帧 1/60，reduced = 减少动态效果：动画时间停住、真实时间照走），记下每道雷：什么时候打下来、劈在哪、之后每帧的闪光、最大的抖动（像素） */
function runStorm(WX, scene, secs, reduced) {
  const fx = WX.createWeather(scene, { bounds: STORM_BOUNDS, random: seeded(7) });
  fx.set("thunder", "night");
  const dt = 1 / 60, list = [];
  let t = 0, cur = null, n = 0;
  for (let f = 0; f < secs * 60; f++) {
    t += dt;
    fx.update(reduced ? 0 : dt, reduced ? 0 : t, { dt, reduced });
    const s = fx.strike;
    if (s && s.n !== n) { n = s.n; cur = { at: t, edge: s.edge, x: s.x, z: s.z, flash: [], shake: 0 }; list.push(cur); }
    if (cur) { cur.flash.push(fx.flash); cur.shake = Math.max(cur.shake, Math.hypot(fx.shake.x, fx.shake.y)); }
  }
  fx.dispose();
  return list;
}

test("雷鸣不下雨（主人要求）：真的 three.js 场景里雷鸣建不出雨丝，酸雨照旧下雨；天气配置表里雷鸣没有雨粒子，只有乌云 + 随机雷击", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, WX } = P;
  try {
    const scene = new THREE.Scene();
    const fx = WX.createWeather(scene, { bounds: STORM_BOUNDS });
    fx.set("thunder", "night");
    assert.equal(rainIn(scene, fx), 0, "雷鸣的场景里有雨丝 / 往下落的雨");
    fx.set("acid", "night");
    assert.ok(rainIn(scene, fx) >= 1, "酸雨的场景里没有雨丝");
    fx.dispose();
    assert.equal(scene.children.length, 0, "天气拿掉后场景里不留东西");
    // 配置表：雷鸣不生成天气粒子（main = null），飘浮物也不是雨；打开的是乌云 + 雷击（storm）。酸雨还是雨丝、不打雷
    const thunder = WX.weatherPlan("thunder", "night"), acid = WX.weatherPlan("acid", "night");
    assert.equal(thunder.main, null, "雷鸣不生成天气粒子（雨丝）");
    assert.ok(!isRain(WX.WEATHER.thunder) && !isRain(thunder.ambient), "雷鸣的配置里没有雨（飘浮物也不往下落）");
    assert.ok(thunder.storm && WX.WEATHER.thunder.storm && thunder.tint, "雷鸣：乌云 + 雷击，雾压暗");
    assert.ok(acid.main === WX.WEATHER.acid && isRain(acid.main) && !acid.storm, "酸雨照旧下雨，不打雷");
    ["none", "sand", "snow", "heat", "glow", "phase"].forEach(w => {
      const p = WX.weatherPlan(w, "day");
      assert.ok(!p.storm && !isRain(p.main) && p.ambient, w + "：不打雷、不下雨，有飘浮物");
    });
  } finally { P.restore(); }
});

test("雷击：间隔随机、落在配置的范围里，远处和战场边缘都会劈；每道雷全屏闪白 + 镜头轻微抖一下（边缘的比远处的重），一秒内退干净；减少动态效果时照打，但不抖镜头、闪光减弱、只闪一下", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { THREE, WX } = P;
  try {
    const S = WX.STORM;
    assert.ok(S.interval[0] > 0 && S.interval[1] > S.interval[0] && S.first[1] >= S.first[0] && S.first[0] > 0, "间隔（闪光频率）是配置里的一个范围");
    assert.ok(S.shake.edge > S.shake.far && S.shake.far > 0 && S.shake.dur > 0, "抖动幅度、时长在配置里");
    assert.ok(S.reduced.flash > 0 && S.reduced.flash < 1, "减少动态效果时闪光减弱多少在配置里");
    const scene = new THREE.Scene(), secs = 150, frame = 1 / 60 + 1e-6, b = STORM_BOUNDS;
    for (const reduced of [false, true]) {
      const list = runStorm(WX, scene, secs, reduced), tag = reduced ? "减少动态效果：" : "";
      assert.ok(list.length >= Math.floor(secs / S.interval[1]), tag + `${secs} 秒只打了 ${list.length} 道雷`);
      assert.ok(list[0].at >= S.first[0] - frame && list[0].at <= S.first[1] + frame, tag + `第一道雷在 ${list[0].at.toFixed(2)} 秒，不在 first 的范围里`);
      const gaps = list.slice(1).map((s, i) => s.at - list[i].at);
      gaps.forEach(g => assert.ok(g >= S.interval[0] - frame && g <= S.interval[1] + frame, tag + `两道雷隔了 ${g.toFixed(2)} 秒，不在 ${S.interval} 里`));
      assert.ok(new Set(gaps.map(g => Math.round(g * 4))).size >= 4, tag + "间隔是随机的，不是固定节拍");
      assert.ok(list.some(s => s.edge) && list.some(s => !s.edge), tag + "有劈在战场边缘的，也有劈在远处的");
      list.forEach(s => assert.ok(s.edge ? s.z < b.minZ && s.z > b.minZ - 4 && s.x > b.minX && s.x < b.maxX : s.z < b.minZ - 4, tag + `雷劈的位置不对（${s.edge ? "边缘" : "远处"}：${s.x.toFixed(1)}, ${s.z.toFixed(1)}）`));
      list.slice(0, -1).forEach(s => assert.ok(s.flash[60] < 0.02, tag + `闪光一秒后还有 ${s.flash[60]}（要短促）`));
      const peak = (s) => Math.max(...s.flash);
      if (!reduced) {
        list.forEach(s => assert.ok(peak(s) >= 0.6 && peak(s) <= 1 + 1e-9, `闪白的亮度 ${peak(s)}`));
        list.forEach(s => assert.ok(s.shake > 0.5 && s.shake <= (s.edge ? S.shake.edge : S.shake.far) + 1e-9, `镜头抖了 ${s.shake.toFixed(2)}px（要轻微）`));
        const edgeMin = Math.min(...list.filter(s => s.edge).map(s => s.shake)), farMax = Math.max(...list.filter(s => !s.edge).map(s => s.shake));
        assert.ok(edgeMin > farMax, "战场边缘的雷比远处的抖得重");
        assert.ok(list.some(s => s.flash.some((v, i) => i > 0 && v > s.flash[i - 1] + 0.05)), "一道雷里连闪几下");
      } else {
        list.forEach(s => {
          assert.equal(s.shake, 0, "减少动态效果：不抖镜头");
          assert.ok(peak(s) > 0 && peak(s) <= S.reduced.flash + 1e-9, `减少动态效果：闪光减弱（${peak(s)}）`);
          s.flash.forEach((v, i) => assert.ok(i === 0 || v <= s.flash[i - 1] + 1e-9, "减少动态效果：只闪一下，不连闪"));
        });
      }
    }
    // 画面这边：闪白、推亮灯光的强度在 FLASH 配置里；抖动只在渲染这一下挪镜头，渲染完挪回去（OrbitControls 不受影响）
    const fs = require("fs"), path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-scene.js"), "utf8");
    assert.ok(/const FLASH = \{/.test(src) && /grade\.uniforms\.flash\.value = fl \* FLASH\.white/.test(src) && /uniform float flash;/.test(src), "全屏闪白在调色后期里，强度在 FLASH 配置里");
    assert.ok(/weather\.shake/.test(src) && /camera\.position\.add\(shakeV\)/.test(src) && /camera\.position\.sub\(shakeV\)/.test(src), "镜头抖动只挪渲染这一下");
  } finally { P.restore(); }
});

test("乌云：雷鸣时远景的天幕压暗、盖上慢慢飘的厚云（星星被盖住），中景上方再挂一层低云；打雷时云被照亮；远处的雷劈在低云前面、画面里", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B, WX } = P;
  try {
    const out = L.build(DEMO_SETUPS.cross(H.load().BattleSim), { view: DESKTOP }), cam = out.camera, b = out.bounds;
    const night = { sky: ["#2f4673", "#1d2d52", "#101b38", "#060b1a"], fog: 0x1b2742 };
    const calm = B.buildBackdrop("night", b, "night", cam, night);
    const storm = B.buildBackdrop("night", b, "night", cam, Object.assign({ storm: true }, night));
    const skyOf = (bd) => bd.group.children.find(o => o.material && o.material.uniforms && o.material.uniforms.c0).material.uniforms;
    const su = skyOf(storm), cu = skyOf(calm);
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    assert.ok(su.storm.value === 1 && cu.storm.value === 0, "雷鸣的天幕画乌云，平时不画");
    assert.ok(su.stars.value === 0 && cu.stars.value === 1, "乌云把星星盖住");
    ["c0", "c1", "c2", "c3"].forEach(k => assert.ok(lum(su[k].value) < lum(cu[k].value), "天空压暗：" + k));
    const low = storm.group.children.filter(o => o.userData.cloud);
    assert.ok(low.length >= 1 && !calm.group.children.some(o => o.userData.cloud), "雷鸣时中景上方挂着低云，平时没有");
    // 云慢慢飘：跟着动画时间走（减少动态效果时场景传进来的时间停住，云也停住）
    storm.update(10, 0.016, { flash: 0, x: 0 });
    assert.ok(su.time.value === 10 && low.every(o => o.material.uniforms.time.value === 10), "云跟着动画时间飘");
    // 打雷：天幕和低云都被照亮，亮的地方跟着雷走；雷过去就暗回去
    storm.update(10, 0.016, { flash: 0.8, x: 6 });
    const u6 = su.flashU.value;
    assert.ok(su.flash.value > 0.5 && low.every(o => o.material.uniforms.flash.value > 0.5), "打雷时云被照亮");
    storm.update(10, 0.016, { flash: 0.8, x: -6 });
    assert.ok(su.flashU.value < u6, "云亮的地方跟着雷走");
    storm.update(10, 0.016, { flash: 0, x: 0 });
    assert.ok(su.flash.value === 0 && low.every(o => o.material.uniforms.flash.value === 0));
    // 远处的雷：劈在低云前面（天幕、低云都是一圈弧，两边离得近；劈在后面会被挡住），比战场边缘的雷远，横着在画面里
    const S = B.BACKDROP, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const rx = (b.maxX - b.minX) / 2 + S.sideGap, rz = (b.maxZ - b.minZ) / 2 + S.skyGap, lx = rx - S.storm.low.inset, lz = rz - S.storm.low.inset;
    const arcZ = (x, ax, az) => { const k = (x - cx) / ax; return cz - az * Math.sqrt(Math.max(0, 1 - k * k)); };
    [-1, -0.5, 0, 0.5, 1].forEach(r => {
      const p = storm.farPoint(r), skyZ = arcZ(p.x, rx, rz), lowZ = arcZ(p.x, lx, lz);
      assert.ok(p.z > skyZ + 0.05 && p.z > lowZ + 0.05, `远处的雷 r=${r} 在天幕 / 低云后面（z=${p.z.toFixed(2)}，天幕 ${skyZ.toFixed(2)}，低云 ${lowZ.toFixed(2)}）`);
      assert.ok(p.z < b.minZ - WX.STORM.edgeDepth[1], `远处的雷 r=${r} 不比战场边缘的远（z=${p.z.toFixed(2)}）`);
      const s = L.project(cam, { x: p.x, y: 0, z: p.z });
      assert.ok(s.x > 0 && s.x < DESKTOP.width, `远处的雷 r=${r} 在画面外（x=${s.x.toFixed(0)}）`);
    });
    calm.dispose(); storm.dispose();
  } finally { P.restore(); }
});

/* ---------- 路灯大幅减少、默认地台跟着地图换材质（#202 截图验收后主人的反馈）---------- */
/** 游戏里现成的区域名：rogue-data.js 的 regions（单局各幕）+ altRegions（幕间改走的采矿场）；world-data.js 的区域 → 地图地点 id */
function gameRegions() {
  const ctx = H.load(), C = ctx.S.ROGUE_CONFIG;
  return { names: [...new Set(C.regions.concat(Object.values(C.altRegions || {})))], places: require("vm").runInContext("WORLD_REGION_PLACE", ctx) };
}
const MINES = ["第一采矿场", "第二采矿场", "第三采矿场"];
const LIGHTS = ["day", "dusk", "night"];

test("区域 → 地面主题：游戏里的每个区域各有一套地面、互不相同；地图地点 id 和别名对到同一套；认不得的区域兜底成以前的水泥地", () => {
  const { names, places } = gameRegions();
  assert.ok(names.length >= 7 && names.includes("外城区") && MINES.every(n => names.includes(n)), "区域名取自 rogue-data.js：" + names);
  const keys = names.map(n => L.groundOf(n));
  keys.forEach((k, i) => {
    assert.ok(L.GROUNDS[k], names[i] + "：配置表里有这套地面");
    assert.notEqual(k, L.GROUND_DEFAULT, names[i] + "：不该落到兜底");
    assert.equal(L.regionName(names[i]), names[i]);
  });
  assert.equal(new Set(keys).size, names.length, "不同区域选出不同的地面主题：" + keys);
  // 同一个地方的别名：地图地点 id（跑团 LEDGER.place、联机跑团 view.map.place 发的是它）、天网塔 = 天网设施
  Object.entries(places).forEach(([name, id]) => {
    assert.equal(L.groundOf(id), L.groundOf(name), `${id} 和 ${name} 是同一个地方`);
    assert.equal(L.regionName(id), L.regionName(name));
  });
  MINES.forEach((n, i) => assert.equal(L.regionName("mine_" + (i + 1)), n));
  // 认不得的（没给、空的、还没有地面主题的地点、乱写的）：兜底，就是以前的水泥砖 + 油渍
  [undefined, null, "", "月球", "极北禁区", 42, {}].forEach(x => {
    assert.equal(L.groundOf(x), L.GROUND_DEFAULT, "认不得的区域兜底：" + String(x));
    assert.equal(L.regionName(x), null);
  });
  const D = L.GROUNDS[L.GROUND_DEFAULT];
  assert.ok(D.tex === "concrete" && D.side === "brick" && D.decals.oil > 0 && D.decals.crack > 0 && D.ground == null, "兜底 = 以前的水泥砖 + 油渍 / 裂缝，大片地面照旧");
  // 每套地面看得出不同：顶面贴图 / 颜色、侧面、贴花、地台外的大片地面
  const all = Object.keys(L.GROUNDS);
  const sig = (k) => { const g = L.GROUNDS[k]; return [g.tex, g.tint, g.side, g.sideTint, JSON.stringify(g.decals), g.ground].join("|"); };
  assert.equal(new Set(all.map(sig)).size, all.length, "有两套地面长得一样");
  all.filter(k => k !== L.GROUND_DEFAULT).forEach(k => assert.ok(Number.isInteger(L.GROUNDS[k].ground) && L.GROUNDS[k].tex !== D.tex, k + "：自己的顶面贴图、地台外大片地面的颜色"));
  // 主人给的大致对应
  const G = (n) => L.GROUNDS[L.groundOf(n)];
  assert.ok(G("外城区").side === "sheet" && G("外城区").decals.crack > 0, "外城区：开裂沥青 / 水泥、铁皮侧面");
  assert.ok(G("沙漠").side === "strata" && G("沙漠").decals.ripple > 0, "沙漠：沙地 + 沙纹、岩层侧面");
  MINES.forEach(n => assert.ok(G(n).side === "strata" && G(n).decals.slag > 0 && G(n).decals.gravel > 0, n + "：碎石 + 矿渣、岩层侧面"));
  assert.ok(G("第三采矿场").glow && !G("第一采矿场").glow, "三采带一点能量矿的冷光");
  assert.ok(G("巨人城").metal > 0 && G("巨人城").decals.grate > 0, "巨人城：金属地板 / 格栅");
  assert.ok(G("天网设施").glow && G("天网设施").metal > 0 && G("天网设施").decor === "clean", "天网设施：干净的金属面板 + 发光接缝");
  assert.ok(L.regionName("下水道") === "下水道" && G("下水道").decals.puddle > 0, "下水道（游戏里还没有这张图，先放在表里）：湿水泥 + 积水");
});

test("默认地台（没有场地效果的，或者只是垫高的高地）跟着区域换地面；有场地效果的（酸液、电、冰、流沙、珊瑚、深渊……）照旧；不给区域 / 认不得的区域和以前一样", () => {
  const st = setupCase({ opt: { board: "cross5" } }, 1);
  st.fields[1].acid = true; st.fields[2].highland = true; st.fields[4].electric = true; st.fields[5].highland = true; st.fields[5].fire = 2;
  const base = L.build(st, { view: DESKTOP });
  assert.ok(base.region === null && base.ground === L.GROUND_DEFAULT, "不给区域：兜底");
  base.zones.forEach(z => assert.equal(z.ground, null, "不给区域：地台照旧"));
  const { names } = gameRegions();
  names.concat(["下水道", "mine_2", "天网塔"]).forEach(region => {
    const out = L.build(st, { view: DESKTOP, region }), key = L.groundOf(region);
    assert.ok(out.region === L.regionName(region) && out.ground === key, region);
    out.zones.forEach((z, i) => {
      const b = base.zones[i];
      assert.ok(z.kind === b.kind && z.h === b.h && z.effects.join() === b.effects.join(), "地台的样子（kind）、高度不随区域变");
      const plain = z.effects.every(e => e === "highland");
      assert.equal(z.ground, plain ? key : null, `${region} ${z.id} 区（${z.effects.join("+") || "默认"}）`);
    });
    assert.equal(out.zones.filter(z => z.ground).map(z => z.id).join(), "2,3", region + "：只垫高的 2 区、默认的 3 区换了地面");
  });
  // 每一种场地效果，单独放或者和高地叠在一起：都不受区域影响
  const s = setupCase({ opt: { zoneMode: 2 } }, 1);
  L.KIND_ORDER.filter(k => k !== "highland").forEach(k => [{ [k]: true }, { [k]: true, highland: true }].forEach(f => {
    s.fields[1] = Object.assign({}, f);
    ["沙漠", "巨人城", "第三采矿场", "下水道"].forEach(region => {
      const z = L.build(s, { region }).zones[0];
      assert.ok(z.effects.includes(k) && z.ground === null, `${k}${f.highland ? " + 高地" : ""} 在 ${region}：有场地效果，不换地面`);
    });
  }));
  // 认不得的区域：和不给区域一样
  const odd = L.build(st, { view: DESKTOP, region: "月球" });
  assert.ok(odd.region === null && odd.ground === L.GROUND_DEFAULT);
  odd.zones.forEach(z => assert.equal(z.ground, null));
});

test("路灯：整场最多 CONFIG.lamps.max 盏（每张地图放几盏、放什么在 GROUNDS 的 lamps），放在战场后沿外面、不在地台上，默认镜头里看得见；沙漠 / 采矿场没有路灯", () => {
  const max = L.CONFIG.lamps.max;
  assert.ok(max >= 1 && max <= 2, "整场最多 1–2 盏");
  const { names } = gameRegions(), regions = names.concat(["下水道", "月球", null]);
  for (const c of CASES) {
    const st = setupCase(c);
    for (const region of regions) for (const theme of LIGHTS) {
      const out = L.build(st, { view: DESKTOP, region, theme }), tag = `${c.name} ${region} ${theme}`;
      const plan = L.lampPlan(out.ground, theme);
      assert.ok(Array.isArray(out.lamps) && out.lamps.length === plan.count && out.lamps.length <= max, tag + `：${out.lamps && out.lamps.length} 盏`);
      out.lamps.forEach(l => {
        assert.equal(l.kind, plan.kind);
        out.zones.forEach(z => assert.ok(Math.abs(l.x - z.cx) > z.w / 2 + 0.3 || Math.abs(l.z - z.cz) > z.d / 2 + 0.3, `${tag}：灯放在 ${z.id} 区的地台上了`));
        assert.ok(l.z < out.bounds.minZ && l.z > out.bounds.minZ - 3, `${tag}：灯在战场后沿外面（z=${l.z.toFixed(2)}）`);
        const h = L.CONFIG.lamps.h[l.kind];
        assert.ok(h > 1, "灯的高度在配置里");
        [0, h].forEach(y => {
          const s = screenOf(out.camera, { x: l.x, y: L.CONFIG.groundY + y, z: l.z });
          assert.ok(s.x >= 0 && s.x <= DESKTOP.width && s.y >= DESKTOP.top && s.y <= DESKTOP.height - DESKTOP.bottom, `${tag}：灯（${y ? "灯头" : "灯杆底"}）不在画面里（${s.x.toFixed(0)}, ${s.y.toFixed(0)}）`);
        });
      });
    }
  }
  // 沙漠、采矿场默认不放路灯：沙漠什么灯都没有，采矿场最多一盏小矿灯（吊灯）
  const st = setupCase({ opt: { zoneMode: 3 } });
  for (const theme of LIGHTS) {
    assert.equal(L.build(st, { region: "沙漠", theme }).lamps.length, 0, "沙漠没有灯：" + theme);
    MINES.forEach(n => {
      const ls = L.build(st, { region: n, theme }).lamps;
      assert.ok(ls.length <= 1 && ls.every(l => l.kind === "hanging"), `${n}：没有路灯，最多一盏矿灯（${theme}）`);
    });
  }
  // 本来就该有灯的地方：外城区 / 巨人城 / 天网设施 / 下水道，夜里有灯
  ["外城区", "巨人城", "天网设施", "下水道"].forEach(n => assert.ok(L.build(st, { region: n, theme: "night" }).lamps.length >= 1, n + "夜里有灯"));
});

test("真的 three.js 里：默认地台的顶面 / 侧面 / 贴花按区域换，有场地效果的地台和不给区域时是同一套材质和贴花；认不得的区域就是以前的水泥地", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { W } = P;
  try {
    const st = setupCase({ opt: { board: "cross5" } }, 1);
    st.fields[1].acid = true; st.fields[2].highland = true; st.fields[4].electric = true; st.fields[5].ice = true;
    /** 建一遍整个战场的地台，记下每块的顶面 / 侧面材质和贴花的贴图 */
    const looks = (region) => {
      const out = L.build(st, { view: DESKTOP, region, theme: "dusk" }), ctx = { anim: [], lamps: [], fxLights: 0, theme: "dusk" };
      return out.zones.map(z => {
        const g = W.buildZone(z, ctx), body = g.children.find(o => o.isMesh && Array.isArray(o.material));
        const decals = new Set();
        g.traverse(o => { if (o.isMesh && o.geometry.type === "PlaneGeometry" && o.material.transparent && o.material.map) decals.add(o.material.map); });
        W.disposeTree(g);
        return { z, top: body.material[0], side: body.material[1], decals };
      });
    };
    const same = (a, b) => a.top === b.top && a.side === b.side && a.decals.size === b.decals.size && [...a.decals].every(x => b.decals.has(x));
    const none = looks(null);
    assert.ok(none.filter(x => !x.z.effects.length).every(x => x.decals.size > 0), "默认地台上铺着贴花");
    looks("月球").forEach((x, i) => assert.ok(same(x, none[i]), `认不得的区域：${x.z.id} 区和以前一样`));
    const { names } = gameRegions(), tops = new Set();
    names.concat(["下水道"]).forEach(region => {
      looks(region).forEach((x, i) => {
        if (!x.z.ground) { assert.ok(same(x, none[i]), `${region}：有场地效果的 ${x.z.id} 区（${x.z.kind}）不该变`); return; }
        assert.ok(x.top !== none[i].top && x.top.map !== none[i].top.map && x.side !== none[i].side, `${region}：${x.z.id} 区的顶面、侧面跟着区域换了`);
        assert.ok([...x.decals].some(d => !none[i].decals.has(d)) || x.decals.size === 0, `${region}：${x.z.id} 区的贴花跟着区域换了`);
        tops.add(x.top);
      });
    });
    assert.ok(tops.size >= names.length, "不同区域的默认地台顶面不一样");
  } finally { P.restore(); }
});

test("真的 three.js 里：地台和间隔上不再放路灯，整场的灯就是布局给的那 0–2 盏；沙漠没有灯，采矿场只有矿灯", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { W } = P;
  try {
    const { names } = gameRegions();
    for (const c of CASES) {
      const st = setupCase(c);
      for (const region of names.concat(["下水道", null])) for (const theme of ["day", "night"]) {
        const out = L.build(st, { view: DESKTOP, region, theme }), ctx = { anim: [], lamps: [], fxLights: 0, theme }, tag = `${c.name} ${region} ${theme}`;
        const built = out.zones.map(z => W.buildZone(z, ctx)).concat(out.gaps.map(g => W.buildGap(g, ctx)));
        assert.equal(ctx.lamps.length, 0, tag + "：地台 / 间隔上不该有路灯");
        built.push(W.buildLamps(out.lamps, ctx));
        assert.ok(ctx.lamps.length === out.lamps.length && ctx.lamps.length <= L.CONFIG.lamps.max, tag);
        if (region === "沙漠") assert.equal(ctx.lamps.length, 0, tag);
        if (MINES.includes(region)) assert.ok(ctx.lamps.every(l => l.kind === "hanging"), tag + "：采矿场只有矿灯");
        ctx.lamps.forEach(l => assert.ok(l.light && l.bulb && l.bulbColor && l.wait > 0 && l.flick === 0, tag + "：灯会发光、带着闪烁要用的数据"));
        built.forEach(o => W.disposeTree(o));
      }
    }
  } finally { P.restore(); }
});

test("远景跟着区域：沙漠 → 沙丘、采矿场 → 岩壁（矿井架 / 烟囱还在）、城市 → 楼群（白天 / 傍晚 / 夜晚都建得出来）、天网设施 → 沙丘里的高塔；场景按布局给的区域挑远景、地面颜色和灯", async (t) => {
  const P = await protoEnv(t);
  if (!P) return;
  const { B, THREE } = P;
  try {
    const G = (n) => L.GROUNDS[L.groundOf(n)];
    assert.equal(G("沙漠").backdrop, "desert");
    MINES.forEach(n => assert.equal(G(n).backdrop, "mine", n));
    ["外城区", "巨人城", "下水道"].forEach(n => assert.equal(G(n).backdrop, "city", n));
    assert.equal(G("天网设施").backdrop, "skynet");
    assert.equal(L.GROUNDS[L.GROUND_DEFAULT].backdrop, null, "认不得的区域：远景照旧按光影主题挑");
    const out = L.build(DEMO_SETUPS.cross(H.load().BattleSim), { view: DESKTOP });
    const count = (bd, kind) => { let n = 0; bd.group.traverse(o => { if (o.userData && o.userData.kind === kind) n++; }); return n; };
    const colors = { sky: ["#ffc47c", "#f28a5a", "#b9587a", "#4b3368"], fog: 0xc98a72 };
    for (const theme of LIGHTS) for (const storm of [false, true]) {
      const opt = Object.assign({ storm }, colors), tag = theme + (storm ? " 雷鸣" : "");
      const make = (kind, extra) => { const bd = B.buildBackdrop(kind, out.bounds, theme, out.camera, Object.assign({}, opt, extra)); bd.update(1, 0.016, { flash: 0.5, x: 0 }); return bd; };
      const city = make("city"), mine = make("mine"), desert = make("desert"), sky = make("skynet");
      assert.ok(count(city, "tower") >= 8, tag + "：城市远景是楼群");
      assert.ok(count(mine, "cliff") >= 2 && count(mine, "headframe") === 1, tag + "：采矿场远景有岩壁，矿井架还在");
      assert.ok(count(desert, "dune") >= 2, tag + "：沙漠远景有沙丘");
      assert.ok(count(sky, "skynet") === 1 && count(sky, "dune") >= 2, tag + "：天网设施是沙丘里的一座高塔");
      [city, mine, desert, sky].forEach(bd => bd.dispose());
    }
    // 楼群的高低按区域（外城区是矮房子，巨人城是高楼）
    const tallest = (skyline) => {
      const bd = B.buildBackdrop("city", out.bounds, "day", out.camera, Object.assign({ skyline }, colors));
      let h = 0; bd.group.traverse(o => { if (o.userData.kind === "tower") h = Math.max(h, new THREE.Box3().setFromObject(o).max.y); });
      bd.dispose(); return h;
    };
    assert.ok(G("巨人城").skyline > G("外城区").skyline && tallest(G("巨人城").skyline) > tallest(G("外城区").skyline) * 1.2, "巨人城的楼比外城区的高");
    // 场景：远景、地台外大片地面的颜色按布局给的地面主题（layout.ground），灯按布局摆
    const fs = require("fs"), path = require("path");
    const scene = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-scene.js"), "utf8");
    assert.ok(/L\.GROUNDS\[[^\]]*\.ground\]/.test(scene) && /buildLamps\(layout\.lamps/.test(scene), "场景照布局给的地面主题挑远景 / 地面颜色，灯照布局摆");
  } finally { P.restore(); }
});

test("原型页：顶栏可以切换区域（下拉框，或者网址加 ?region=沙漠），三个演示默认分别是采矿场 / 沙漠 / 外城区；布局拿到的就是页面选的区域", () => {
  const fs = require("fs"), path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  assert.ok(html.includes('id="region-select"'), "顶栏有区域下拉框");
  assert.ok(/\.get\("region"\)/.test(html), "网址参数 ?region=");
  assert.ok(/Object\.keys\(L\.REGIONS\)/.test(html), "下拉框列的是配置表里的区域名");
  Object.entries({ mine: "第一采矿场", desert: "沙漠", cross: "外城区" }).forEach(([id, region]) =>
    assert.ok(new RegExp(`id: "${id}",[^\\n]*region: "${region}"`).test(html), `演示 ${id} 默认在 ${region}`));
  // 交给布局的是联机投影过的状态（#204：project() = OnlineView.projectState(st)）
  assert.ok(/L\.build\(project\(\), \{[^}]*region:[^}]*theme:/.test(html), "布局拿到页面选的区域和光影主题（灯的数量看白天 / 夜晚）");
  const css = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d.css"), "utf8");
  assert.ok(/@media \(max-width: 720px\)[\s\S]*#region-select[^{]*\{[^}]*display: none/.test(css), "手机上收起区域下拉框（这一轮不专门调手机，别弄坏）");
});

/* ---------- 第二阶段 · 一（issue #204）：三段镜头（远景 / 中景 / 近景看单个区域）+ 只用联机玩家拿得到的数据来画 ---------- */
const OV = require("../online-view.js");
/** 在规则环境里投影（和原型页一样：online-view.js 和规则文件在同一个页面里，主机的展示函数 statusLine / effectiveAtk 拿得到） */
function projectIn(ctx, st) {
  const fs = require("fs"), path = require("path"), vm = require("vm");
  if (!ctx.OnlineView) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "online-view.js"), "utf8"), ctx, { filename: "online-view.js" });
  return ctx.OnlineView.projectState(st, { itemCatalog: ctx.ITEM_CATALOG || {} });
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test("联机数据：原型页先用 OnlineView.projectState 投影再交给布局；投影后排出来的布局和用房主完整 state 排的一样（只差投影本来就做的名字规范化、ATK 用主机算好的实际值），投影和布局里都没有坚毅生命", () => {
  const fs = require("fs"), path = require("path");
  const SHP = 7771, SHP_MAX = 7772;
  for (const id of Object.keys(DEMO_SETUPS)) {
    const ctx = H.load();
    const raw = DEMO_SETUPS[id](ctx.BattleSim);
    raw.units.forEach(u => { u.shp = SHP; u.shpMax = SHP_MAX; u.baseShp = SHP; });
    raw.units[1].hidden = true;                    // 藏起来的单位：两边都不画
    raw.units[0].bondAtk = 3;                      // 牵挂的 ATK 加成：实际 ATK（effectiveAtk）比 atk 多 3
    const pv = projectIn(ctx, raw);
    // 投影里没有坚毅生命（upOnShp 是给玩家看的「起身」开关，只有 true / false，不是数值）
    const wire = JSON.stringify(pv).replace(/"upOnShp":(true|false)/g, "");
    assert.ok(!/shp/i.test(wire) && !wire.includes(String(SHP)) && !wire.includes(String(SHP_MAX)), id + "：投影里有坚毅生命");
    // 区域名、光影进了白名单（#229）：投影里有，原型页读的就是它们（pv.region / pv.light）
    const want = { mine: ["第一采矿场", "dusk"], desert: ["沙漠", "day"], cross: ["外城区", "night"] }[id];
    assert.deepEqual([pv.region, pv.light], want, id + "：投影的战斗状态里有区域名和光影");
    assert.equal(L.regionName(pv.region), pv.region, "投影里的区域名原型的表认得");
    for (const region of [undefined, "沙漠"]) for (const portrait of [false, true]) {
      const opts = { view: DESKTOP, region, theme: "dusk", portrait };
      const a = L.build(raw, opts), b = L.build(pv, opts), tag = `${id} ${region || "不给区域"}${portrait ? " 竖屏" : ""}`;
      // 按「单独的一个数」找（布局里满是坐标小数，595.8610271177713 这种碰巧含 7771 的不算；#237 高地加高以后坐标变了碰上了）
      const json = JSON.stringify(b), lone = (n) => new RegExp(`(?<![\\d.])${n}(?![\\d.])`).test(json);
      assert.ok(!/shp/i.test(json) && !lone(SHP) && !lone(SHP_MAX), tag + "：布局里有坚毅生命");
      // 地台、间隔、灯、镜头、范围一模一样
      ["zones", "gaps", "lamps", "camera", "bounds", "region", "ground", "plateSize"].forEach(k => assert.deepEqual(plain(b[k]), plain(a[k]), tag + "：" + k + " 不一样"));
      // 单位：站位、抬高、屏幕矩形、铭牌一样；名字是投影规范化过的（全角括号 → 半角：OnlineView.safeText），ATK 是主机算好的实际 ATK（display.atk，联机单位卡也用它）
      assert.deepEqual(b.units.map(u => u.id), a.units.map(u => u.id), tag + "：画出来的单位不一样");
      assert.ok(!b.units.some(u => u.id === raw.units[1].id), "藏起来的单位不画");
      a.units.forEach((ua, i) => {
        const pu = pv.units.find(x => x.id === ua.id), want = plain(ua);
        want.plate.name = OV.safeText(ua.plate.name);
        want.plate.atk = pu.display && Number.isFinite(pu.display.atk) ? pu.display.atk : ua.plate.atk;
        want.plate.text = [want.plate.name, ua.plate.text[1], "ATK " + want.plate.atk].concat(ua.plate.text.slice(3));
        assert.deepEqual(plain(b.units[i]), want, `${tag}：${ua.plate.name} 不一样`);
      });
      const bonded = (l) => l.units.find(u => u.id === raw.units[0].id).plate.atk;
      assert.equal(bonded(b), raw.units[0].atk + 3, tag + "：联机铭牌的 ATK 是主机算好的实际 ATK（和联机单位卡一样，含牵挂的 +3）");
    }
  }
  // 原型页：加载 online-view.js，画面用的是投影（project() = OnlineView.projectState(st)）；布局、顶栏、队伍栏、日志都不直接读房主的 st
  const html = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "index.html"), "utf8");
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(html.indexOf('<script src="../../online-view.js"></script>') > html.indexOf('<script src="../../training.js"></script>'), "规则文件之后加载 online-view.js");
  assert.ok(/pv = OnlineView\.projectState\(st,/.test(mod) && /L\.build\(project\(\),/.test(mod), "先投影再交给布局");
  assert.ok(!/L\.build\(st\b/.test(mod) && !/weather: st\.weather/.test(mod) && !/st\.turnNo/.test(mod) && !/st\.logPages/.test(mod), "画面不绕开白名单读房主的原始 state");
  assert.ok(/OnlineView\.projectLogs\(/.test(mod), "日志也走白名单（projectLogs）");
});

/* 三段镜头的纯函数（hd2d-camera.js）：在 Node 里按布局算，和场景用的是同一套。每条测试里各自 require（缺这个文件时只是这几条失败，别的照跑） */
const cams = () => require("../prototypes/hd2d/hd2d-camera.js");
const usableAt = (s, v) => s.x >= -0.5 && s.x <= v.width + 0.5 && s.y >= v.top - 0.5 && s.y <= v.height - v.bottom + 0.5;
const cornersOf = (z) => { const out = []; [z.cx - z.w / 2, z.cx + z.w / 2].forEach(x => [0, z.topY].forEach(y => [z.cz - z.d / 2, z.cz + z.d / 2].forEach(zz => out.push({ x, y, z: zz })))); return out; };
/** 这个区整块（地台顶面四个角 + 地面四个角）都在顶栏和技能栏之间：用测试里自己写的投影量 */
const framedIn = (pose, z, v) => cornersOf(z).every(p => usableAt(screenOf(pose.cam, p), v));
const centerIn = (pose, z, v) => usableAt(screenOf(pose.cam, { x: z.cx, y: z.topY, z: z.cz }), v);
/** 光影主题里远处糊的上限（hd2d-scene.js 的 THEMES[].dofFar），取最小的那个（最不糊的情况） */
function minDofFar() {
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-scene.js"), "utf8");
  return Math.min(...[...src.matchAll(/dofFar: ([\d.]+)/g)].map(m => Number(m[1])));
}

test("三段镜头：远景就是默认镜头（框住整个战场）；中景框住选中的区 + 相连的区、比远景近、俯角低；近景只框选中的那一个区、比中景近、俯角更低（各种棋盘、每个区，桌面 1440×900）", () => {
  const CAMS = cams(), C = CAMS.CAMERA;
  assert.ok(C.mid.elevation < L.CONFIG.camera.elevation && C.near.elevation < C.mid.elevation, "俯角：远 > 中 > 近（近景抬到 22–28°，见 tests/hd2d-camera-terrain.test.js，#237）");
  for (const c of CASES) {
    const out = L.build(setupCase(c, 4), { view: DESKTOP });
    for (const z of out.zones) {
      const tag = `${c.name} ${z.id} 区`;
      const far = CAMS.pose(out, "far", z.id), mid = CAMS.pose(out, "mid", z.id), near = CAMS.pose(out, "near", z.id);
      // 远景：布局的默认镜头，一个数都不改；整个战场都在画面里
      assert.ok(far.cam === out.camera && far.dist === out.camera.dist && far.elevation === L.CONFIG.camera.elevation && far.fov === L.CONFIG.camera.fov, tag + "：远景不是默认镜头");
      assert.deepEqual(plain(far.zones), plain(out.zones.map(q => q.id)));
      out.zones.forEach(q => assert.ok(framedIn(far, q, DESKTOP), `${tag}：远景没框住 ${q.id} 区`));
      assert.ok(far.dof.shift === 0 && far.fogShift === 0 && far.dof.aperture === C.far.dof.aperture && far.dof.lateral === 0, tag + "：远景的景深 / 雾和以前一样");
      // 中景：选中的区整块在画面里，相连的区都露出中心（框住 2–3 个相邻的区）；比远景近、俯角低
      const links = CAMS.linkedZones(out, z.id);
      assert.deepEqual(plain(mid.zones), plain([z.id].concat(links)), tag + "：中景框住的区");
      assert.ok(framedIn(mid, z, DESKTOP), tag + "：中景没框住选中的区");
      links.forEach(id => assert.ok(centerIn(mid, out.zones.find(q => q.id === id), DESKTOP), `${tag}：中景里相连的 ${id} 区看不到`));
      assert.ok(mid.dist < far.dist * 0.85 && mid.elevation === C.mid.elevation && mid.fov === C.mid.fov, `${tag}：中景要比远景近（${mid.dist.toFixed(1)} / ${far.dist.toFixed(1)}）`);
      // 近景：只框选中的那一个区，它几乎占满画面宽；同一排左右的区不在画面里；比中景近、俯角更低
      assert.deepEqual(plain(near.zones), [z.id]);
      assert.ok(framedIn(near, z, DESKTOP), tag + "：近景没框住选中的区");
      const xs = cornersOf(z).map(p => screenOf(near.cam, p).x);
      assert.ok(Math.max(...xs) - Math.min(...xs) >= DESKTOP.width * 0.6, `${tag}：近景里选中的区只占画面宽的 ${((Math.max(...xs) - Math.min(...xs)) / DESKTOP.width * 100).toFixed(0)}%`);
      out.zones.filter(q => q.id !== z.id && Math.abs(q.cz - z.cz) < 1e-6).forEach(q => assert.ok(!centerIn(near, q, DESKTOP), `${tag}：近景里看得到同一排的 ${q.id} 区`));
      assert.ok(near.dist < mid.dist / 1.5 && near.elevation === C.near.elevation && near.fov === C.near.fov, `${tag}：近景要比中景近（${near.dist.toFixed(1)} / ${mid.dist.toFixed(1)}）`);
      // 景深：近景的焦点落在选中的区（中心不糊、整块只糊一点），画面里露出来的别的区（哪怕只露一个角，包括同一排左右的）都糊掉
      const dofFar = minDofFar(), blur = (p) => CAMS.blurAt(near, p, dofFar);
      assert.ok(blur({ x: z.cx, y: z.topY, z: z.cz }) < 1e-3, tag + "：近景的焦点不在选中的区");
      cornersOf(z).forEach(p => assert.ok(blur(p) <= 0.0045, `${tag}：选中的区自己糊得太厉害（${blur(p).toFixed(4)}）`));
      out.zones.filter(q => q.id !== z.id).forEach(q => {
        const seen = cornersOf(q).concat([{ x: q.cx, y: q.topY, z: q.cz }]).filter(p => usableAt(screenOf(near.cam, p), DESKTOP));
        seen.forEach(p => assert.ok(blur(p) >= 0.004, `${tag}：近景里 ${q.id} 区露出来的地方没糊掉（${blur(p).toFixed(4)}）`));
      });
      // 中景、远景不按横向糊（框住的相邻区要看得清）
      assert.equal(mid.dof.lateral, 0);
    }
  }
  // 场景改 BokehShader 的那两行（远处单独的上限、近景的横向糊）在 vendor 的 three.js 里真的有，改得上
  const fs = require("fs"), path = require("path");
  const shader = fs.readFileSync(path.join(__dirname, "..", "vendor", "three", "addons", "shaders", "BokehShader.js"), "utf8");
  const scene = fs.readFileSync(path.join(__dirname, "..", "prototypes", "hd2d", "hd2d-scene.js"), "utf8");
  ["float factor = ( focus + viewZ );", "vec2 dofblur = vec2 ( clamp( factor * aperture, -maxblur, maxblur ) );", "uniform float maxblur;"].forEach(s => {
    assert.ok(shader.includes(s), "BokehShader 里找不到：" + s);
    assert.ok(scene.includes(JSON.stringify(s).slice(1, -1)), "场景没改这一行：" + s);
  });
  assert.ok(/uniform float lateral;\\n\\t\\tuniform float focusX;\\n\\t\\tuniform float focusHalf;\\n\\t\\tuniform float tanHalf;/.test(scene) && /factor \+= factor >= 0\.0 \? latBlur : - latBlur;/.test(scene), "近景横向糊：声明 uniform、按方向加到 factor 上（和 blurAt 同一个算法）");
});

test("近景：选中的区的铭牌放大（CONFIG.plate.big），别的区的变淡；放大的铭牌两两不重叠、都在顶栏和技能栏之间（三个演示战场每个有人的区、同区挤 6 / 8 人）；中景的铭牌也不重叠", () => {
  const CAMS = cams(), P = L.CONFIG.plate;
  assert.ok(P.big.w >= P.w * 1.5 && P.big.h >= P.h * 2, "放大的铭牌明显比紧凑的大（四行：名字、血条、架势 + ATK、状态）");
  /** 一块铭牌在屏幕上的矩形（独立投影）：这一段的抬高、放大的用 big 尺寸 */
  const boxOf = (out, pose, u) => {
    const s = screenOf(pose.cam, u), q = pose.plates[u.id];
    const k = Math.min(P.maxScale, Math.max(P.minScale, Math.pow(pose.cam.dist / s.dist, P.scaleExp)));
    const size = q.big ? L.plateSize(out.view, true) : out.plateSize;
    return { x0: s.x - size.w * k / 2, x1: s.x + size.w * k / 2, y0: s.y - q.lift - size.h * k - P.bob, y1: s.y - q.lift + P.bob };
  };
  const check = (out, tag) => {
    out.zones.filter(z => out.units.some(u => u.zone === z.id)).forEach(z => {
      for (const tier of ["mid", "near"]) {
        const pose = CAMS.pose(out, tier, z.id), t = `${tag} ${tier} ${z.id} 区`;
        out.units.forEach(u => {
          const q = pose.plates[u.id], b = boxOf(out, pose, u);
          assert.equal(q.big, tier === "near" && u.zone === z.id, t + "：放大的应该正好是近景里选中的区的铭牌");
          assert.equal(q.dim, tier === "near" && u.zone !== z.id, t + "：近景里别的区的铭牌变淡");
          ["x0", "x1", "y0", "y1"].forEach(k => assert.ok(Math.abs(b[k] - q.rect[k]) < 0.5, `${t}：${u.plate.name} 的 ${k}（独立投影 ${b[k].toFixed(1)} / 镜头给的 ${q.rect[k].toFixed(1)}）`));
          if (u.zone === z.id) assert.ok(b.x0 >= 0 && b.x1 <= DESKTOP.width && b.y0 >= DESKTOP.top && b.y1 <= DESKTOP.height - DESKTOP.bottom, `${t}：${u.plate.name} 的铭牌出了画面 / 被顶栏、技能栏挡住`);
        });
        const list = out.units, bad = [];
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (boxesOverlap(boxOf(out, pose, list[i]), boxOf(out, pose, list[j]))) bad.push(list[i].plate.name + " × " + list[j].plate.name);
        assert.deepEqual(bad, [], t + "：铭牌互相压住");
      }
    });
  };
  Object.keys(DEMO_SETUPS).forEach(id => check(L.build(DEMO_SETUPS[id](H.load().BattleSim), { view: DESKTOP }), id));
  for (const c of CASES) for (const n of [2, 4]) check(L.build(crowded(c.opt, n).st, { view: DESKTOP }), `${c.name} 同区 ${4 + n} 人`);
});

test("近景换相邻的区：左右键 / 屏幕箭头按「后排到前排、同一排从左到右」走，到头就停，每个区都走得到；不认得的区、没给区时看当前行动单位所在的区", () => {
  const CAMS = cams();
  const order = (opt, portrait) => plain(CAMS.zoneOrder(L.build(setupCase({ opt }, 2), { view: DESKTOP, portrait })));
  assert.deepEqual(order({ zoneMode: 3 }), [1, 2, 3], "直排：1 → 2 → 3");
  assert.deepEqual(order({ board: "line4" }), [1, 2, 3, 4]);
  assert.deepEqual(order({ board: "square4" }), [1, 2, 3, 4], "2×2：后排 1 → 2，前排 3 → 4");
  assert.deepEqual(order({ board: "cross5" }), [1, 2, 3, 4, 5], "十字：后 1，中间一排 2 → 3 → 4，前 5");
  for (const c of CASES) for (const portrait of [false, true]) {
    const out = L.build(setupCase(c, 2), { view: DESKTOP, portrait }), ids = plain(CAMS.zoneOrder(out));
    assert.deepEqual(ids.slice().sort(), plain(out.zones.map(z => z.id)).sort(), c.name + "：每个区都在顺序里");
    // 从第一个一直按右键：每个区走一遍，到头停住；左键倒着走回来
    let at = ids[0];
    const seen = [at];
    for (let n; (n = CAMS.neighborZone(out, at, 1)) != null;) { seen.push(n); at = n; }
    assert.deepEqual(seen, ids, c.name + "：右键走一遍");
    assert.equal(CAMS.neighborZone(out, ids[ids.length - 1], 1), null, "最后一个区再按右键：不动");
    assert.equal(CAMS.neighborZone(out, ids[0], -1), null, "第一个区再按左键：不动");
    assert.equal(CAMS.neighborZone(out, ids[1], -1), ids[0]);
  }
  // 选中的区：给的认得就用，不然看当前行动单位所在的区，再不然是我方第一个人的区
  const out = L.build(DEMO_SETUPS.cross(H.load().BattleSim), { view: DESKTOP });
  const foe = out.units.find(u => u.side === "foe"), me = out.units.find(u => u.side === "player");
  assert.equal(CAMS.focusZone(out, 2, foe.id), 2);
  assert.equal(CAMS.focusZone(out, 9, foe.id), foe.zone, "认不得的区：看当前行动单位所在的区");
  assert.equal(CAMS.focusZone(out, null, null), me.zone);
  assert.equal(CAMS.pose(out, "near", null, { actorId: foe.id }).zone, foe.zone);
  assert.equal(CAMS.zoneTag(out, 4), "4 区 · 酸液", "镜头条上写区号和场地");
});

test("镜头过渡：0.4–0.6 秒、进出都慢的缓动，位置 / 朝向 / 视野 / 焦点 / 景深 / 雾一起插值，不瞬移也不晃；减少动态效果时不插值，第 0 帧就是终点", () => {
  const CAMS = cams(), T = CAMS.CAMERA.transition, ease = CAMS.EASE[T.ease];
  assert.ok(T.duration >= 0.4 && T.duration <= 0.6, "过渡时长 " + T.duration);
  assert.ok(typeof ease === "function" && ease(0) === 0 && Math.abs(ease(1) - 1) < 1e-12, "缓动从 0 走到 1");
  for (let i = 1; i <= 200; i++) assert.ok(ease(i / 200) >= ease((i - 1) / 200) - 1e-12, "缓动不往回走（不晃）");
  assert.ok(ease(0.05) < 0.02 && 1 - ease(0.95) < 0.02, "起步和停下都慢（没有突变）");
  const out = L.build(DEMO_SETUPS.mine(H.load().BattleSim), { view: DESKTOP });
  const far = CAMS.pose(out, "far", 1), mid = CAMS.pose(out, "mid", 1), near = CAMS.pose(out, "near", 2);
  const keys = (p) => ({ dist: p.dist, elevation: p.elevation, fov: p.fov, tx: p.target.x, ty: p.target.y, tz: p.target.z, px: p.pos.x, py: p.pos.y, pz: p.pos.z,
    aperture: p.dof.aperture, maxblur: p.dof.maxblur, far: p.dof.far, shift: p.dof.shift, fog: p.fogShift, clip: p.clip });
  for (const [a, b] of [[far, near], [near, mid], [mid, far]]) {
    const tw = CAMS.tween(a, b, {}), ka = keys(a), kb = keys(b);
    assert.equal(tw.duration, T.duration);
    const start = keys(CAMS.at(tw, 0)), end = keys(CAMS.at(tw, tw.duration)), half = keys(CAMS.at(tw, tw.duration / 2));
    Object.keys(ka).forEach(k => {
      assert.ok(Math.abs(start[k] - ka[k]) < 1e-9, `${a.tier} → ${b.tier}：第 0 帧的 ${k} 应该还在起点（不瞬移）`);
      assert.ok(Math.abs(end[k] - kb[k]) < 1e-9, `${a.tier} → ${b.tier}：最后 ${k} 到终点`);
      assert.ok(half[k] >= Math.min(ka[k], kb[k]) - 1e-9 && half[k] <= Math.max(ka[k], kb[k]) + 1e-9, `${a.tier} → ${b.tier}：中途的 ${k} 在两头之间`);
    });
    // 每一帧（1/60 秒）只走一小步：最快的时候一帧也不超过全程的一成（0.5 秒走完，缓动最陡的地方大约一帧 5%）
    let prev = keys(CAMS.at(tw, 0));
    for (let t = 1 / 60; t <= tw.duration + 1e-9; t += 1 / 60) {
      const cur = keys(CAMS.at(tw, t));
      Object.keys(ka).forEach(k => { const span = Math.abs(kb[k] - ka[k]); if (span > 1e-6) assert.ok(Math.abs(cur[k] - prev[k]) <= span * 0.1 + 1e-9, `${a.tier} → ${b.tier}：${k} 一帧走了 ${(Math.abs(cur[k] - prev[k]) / span * 100).toFixed(1)}%`); });
      prev = cur;
    }
    // 镜头的位置始终在 target 后上方 dist 远、俯角 elevation（朝向跟着插值，不是直线穿过地台）
    const p = CAMS.at(tw, tw.duration * 0.3), pos = CAMS.posOf(p.target, p.dist, p.elevation, p.azimuth);
    assert.ok(Math.hypot(pos.x - p.pos.x, pos.y - p.pos.y, pos.z - p.pos.z) < 1e-9);
    // 减少动态效果：不插值，直接切过去
    const r = CAMS.tween(a, b, { reduced: true });
    assert.equal(r.duration, 0, "减少动态效果：过渡时长 0");
    [0, 0.1, 1].forEach(t => assert.deepEqual(keys(CAMS.at(r, t)), kb, `减少动态效果：第 ${t} 秒就是终点`));
    assert.equal(CAMS.at(r, 0).k, 1);
  }
  // 从玩家拖动过的镜头出发：起点就是镜头现在的样子（位置、俯角、方位），景深接着上一段的
  const dragged = CAMS.poseFrom({ x: far.pos.x + 6, y: far.pos.y, z: far.pos.z - 2 }, far.target, far.fov, far);
  assert.ok(Math.abs(dragged.azimuth) > 0.05 && dragged.dof === far.dof);
  const s = CAMS.at(CAMS.tween(dragged, near, {}), 0);
  assert.ok(Math.hypot(s.pos.x - dragged.pos.x, s.pos.y - dragged.pos.y, s.pos.z - dragged.pos.z) < 1e-6, "从拖动过的位置平滑出发");
  assert.equal(CAMS.at(CAMS.tween(dragged, near, {}), T.duration).azimuth, 0, "到了以后正对战场");
});

test("滚轮在三段之间跳：一次滚动只跳一段（停顿超过 idle 秒才算下一次，触控板一点一点的也攒够了再跳），往前滚拉近、往后滚拉远，到头就停；按行 / 按页的 deltaY 换成像素", () => {
  const CAMS = cams(), W = CAMS.CAMERA.wheel;
  let s = null, r;
  r = CAMS.wheelStep(s, -100, 10); assert.equal(r.step, 1, "往前滚一下：拉近一段"); s = r.state;
  r = CAMS.wheelStep(s, -100, 10.05); assert.equal(r.step, 0, "同一次滚动里的后几下不再跳"); s = r.state;
  r = CAMS.wheelStep(s, -100, 10.1); assert.equal(r.step, 0); s = r.state;
  r = CAMS.wheelStep(s, 100, 10.1 + W.idle + 0.01); assert.equal(r.step, -1, "停顿一下再往后滚：拉远一段"); s = r.state;
  // 触控板：一下只给几个像素，攒够 step 才跳，而且整段惯性只跳一次
  s = null; let fired = 0;
  for (let i = 0; i < 90; i++) { r = CAMS.wheelStep(s, -3, 20 + i * 0.016); s = r.state; if (r.step) fired++; }
  assert.equal(fired, 1, "一段连续的滚动只跳一段");
  r = CAMS.wheelStep(null, -(W.step - 1), 30); assert.equal(r.step, 0, "滚得太少不跳");
  // 段：远 → 中 → 近，到头停住
  assert.equal(CAMS.stepTier("far", 1), "mid"); assert.equal(CAMS.stepTier("mid", 1), "near"); assert.equal(CAMS.stepTier("near", 1), "near");
  assert.equal(CAMS.stepTier("near", -1), "mid"); assert.equal(CAMS.stepTier("far", -1), "far"); assert.equal(CAMS.tierName("?"), "far");
  assert.equal(CAMS.wheelPixels({ deltaY: 3, deltaMode: 1 }), 3 * W.line);
  assert.equal(CAMS.wheelPixels({ deltaY: -1, deltaMode: 2 }), -W.page);
  assert.equal(CAMS.wheelPixels({ deltaY: -53, deltaMode: 0 }), -53);
});

test("镜头参数都在配置表（hd2d-camera.js 的 CAMERA）；场景照它切（按钮 / 1·2·3 / 滚轮 / 点地台或铭牌选区 / 近景左右键 + 屏幕箭头），镜头是每个人自己的、不写进战斗状态，算镜头不改布局", () => {
  const fs = require("fs"), path = require("path");
  const dir = path.join(__dirname, "..", "prototypes", "hd2d");
  const CAMS = cams(), C = CAMS.CAMERA;
  assert.deepEqual(plain(C.order), ["far", "mid", "near"]);
  ["mid", "near"].forEach(t => ["elevation", "fov", "margin", "clip", "maxLift"].forEach(k => assert.ok(Number.isFinite(C[t][k]), `${t}.${k} 在配置表里`)));
  C.order.forEach(t => {
    assert.ok(Array.isArray(C[t].tilt) && C[t].tilt[0] < C[t].tilt[1], t + "：拖动的俯角范围在配置表里");
    ["aperture", "maxblur", "far"].forEach(k => assert.ok(Number.isFinite(C[t].dof[k]), `${t}：景深 ${k} 在配置表里`));
  });
  assert.ok(C.far.tilt[0] <= L.CONFIG.camera.elevation && L.CONFIG.camera.elevation <= C.far.tilt[1] && C.near.tilt[0] <= C.near.elevation && C.near.elevation <= C.near.tilt[1], "每一段的俯角在自己的拖动范围里（到了以后 OrbitControls 不会把镜头夹走）");
  assert.ok(C.mid.share > 0 && C.mid.dist.near > 1 && C.mid.dist.far < 1 && C.near.big && C.near.dim, "中景框进来多少、远近范围；近景放大 / 变淡");
  assert.ok(Number.isFinite(C.transition.duration) && CAMS.EASE[C.transition.ease], "过渡时长、缓动在配置表里");
  // 算镜头是纯函数：不改布局（布局是用联机投影过的状态排的，镜头也不写回去）
  const out = L.build(DEMO_SETUPS.desert(H.load().BattleSim), { view: DESKTOP }), before = JSON.stringify(out);
  C.order.forEach(t => out.zones.forEach(z => CAMS.pose(out, t, z.id)));
  assert.equal(JSON.stringify(out), before, "算镜头改了布局");
  const camSrc = fs.readFileSync(path.join(dir, "hd2d-camera.js"), "utf8");
  assert.ok(!/document|window\.|THREE|OnlineView|localStorage|\.send\(/.test(camSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "镜头模块不碰 DOM / three.js / 联机");
  // 场景：滚轮不缩放、在三段之间跳；点地台选区；按 CAMERA 插值、减少动态效果时直接切
  const scene = fs.readFileSync(path.join(dir, "hd2d-scene.js"), "utf8");
  assert.ok(/controls\.enableZoom = false/.test(scene) && /C\.wheelStep\(/.test(scene) && /C\.stepTier\(/.test(scene), "滚轮在三段之间跳");
  assert.ok(/C\.pose\(/.test(scene) && /C\.tween\(from, to, \{ reduced: !!opts\.snap \|\| !state\.motion \}\)/.test(scene) && /C\.at\(state\.tween/.test(scene), "按 hd2d-camera.js 的镜头插值；减少动态效果时不插值");
  assert.ok(/userData\.zoneId = z\.id/.test(scene) && /ray\.intersectObjects\(/.test(scene) && /setZone\(zid\)/.test(scene), "点地台选中这个区");
  assert.ok(/select\(id\)[\s\S]{0,200}setZone\(u\.zone\)/.test(scene), "点铭牌也选中它所在的区");
  assert.ok(!/DOF = \{|minElev|zoomIn/.test(scene), "景深 / 俯角范围不再写在场景里");
  // 页面：三段按钮、1 / 2 / 3、左右键、屏幕两边的箭头；网址记住镜头（截图用）；不写进战斗状态
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8"), mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  ["cam-far", "cam-mid", "cam-near", "cam-zone", "zone-prev", "zone-next"].forEach(id => assert.ok(html.includes(`id="${id}"`), "页面上有 #" + id));
  assert.ok(/CAMERA\.keys/.test(mod) && /sc\.setTier\(/.test(mod) && /sc\.stepZone\(/.test(mod) && /addEventListener\("keydown"/.test(mod), "键盘 1 / 2 / 3、左右键");
  assert.ok(/q\.set\("cam"/.test(mod) && /params\.get\("cam"\)/.test(mod), "网址记住镜头（?cam=near&zone=3）");
  assert.ok(!/\b(st|pv)\.(tier|cam|camera|zone|focus)\s*=/.test(mod) && !/publicLogs\.push/.test(mod), "镜头不写进战斗状态");
  // 样式：放大的铭牌按 --bw / --bh，别的区的变淡糊掉
  const css = fs.readFileSync(path.join(dir, "hd2d.css"), "utf8");
  assert.ok(/\.pl-big \{[^}]*width: var\(--bw\); height: var\(--bh\)/.test(css) && /\.hd2d-plate\.big \.pl-big \{ display: flex; \}/.test(css) && /\.hd2d-plate\.dim \.pl-in \{ filter: blur/.test(css));
  assert.ok(/--bw/.test(scene) && /plateSize\(state\.layout\.view \|\| view\(\), true\)/.test(scene), "放大铭牌的尺寸和布局用同一份配置");
  // 放大的铭牌：名字 + 等级、血条 + 血量数字、架势、ATK、状态文字；不碰 shp
  const plate = scene.slice(scene.indexOf("function plateHtml"), scene.indexOf("function makePlate")), big = plate.slice(plate.indexOf('class="pl-big"'), plate.indexOf('class="pl-card"'));
  ["pl-nm", "${esc(p.name)}", "pl-lv", "Lv${p.level}", "pl-bar", "${segs}", "pl-hp", "${p.hp.cur}/${p.hp.max}", "pl-def", "pl-dn", "${defText}", "ATK ${p.atk}", "pl-r4", "${tags}"].forEach(k => assert.ok(big.includes(k), "放大的铭牌上有 " + k));
  assert.ok(/const defText = `架势 /.test(plate) && /const tags = chips\.length/.test(plate), "架势写成文字，状态写成文字标签");
  assert.ok(!/shp/i.test(plate), "铭牌 HTML 不碰 shp");
});

test("原型页面（假网页）：加载 online-view.js、hd2d-camera.js 不报错；页面环境里投影过的演示战场排得出布局和三段镜头", () => {
  const P = require("./hd2d-fake-page");
  const page = P.load();
  assert.deepEqual(page.errors, [], "加载时报错");
  assert.ok(page.ctx.OnlineView && typeof page.ctx.OnlineView.projectState === "function", "页面里有 OnlineView");
  assert.ok(page.ctx.HD2DCamera && page.ctx.HD2DCamera.CAMERA, "页面里有 HD2DCamera");
  Object.keys(DEMO_SETUPS).forEach(id => {
    const st = DEMO_SETUPS[id](page.ctx.BattleSim);
    st.units.forEach(u => { u.shp = 7771; });
    const pv = page.ctx.OnlineView.projectState(st, {});
    const out = page.ctx.HD2DLayout.build(pv, { view: DESKTOP, region: "沙漠", theme: "night" });
    assert.ok(out.units.length >= 8, id);
    const near = page.ctx.HD2DCamera.pose(out, "near", null, { actorId: out.units[0].id });
    assert.equal(near.zone, out.units[0].zone);
    assert.ok(!JSON.stringify(near.plates).includes("7771") && !/shp/i.test(JSON.stringify(out)), id + "：没有 shp");
  });
  assert.deepEqual(page.errors, [], "跑演示战场时报错");
});
