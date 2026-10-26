/* Antlerscale: Backfire · 角色专属仪表 + 状态 / 效果图标（画法照设计稿「角色专属仪表」）
 * HudIcons.unitBadges(unit) → [{ key, stack }]：单位身上该挂的徽章（属性状态六边形、通用状态圆角方块、
 *   即时效果圆形、自我效果菱形、挂着的攻击效果箭头）。unit 可以是规则里的单位，也可以是联机投影过的单位。
 * HudIcons.badge(key, stack) → 一个徽章的 HTML（span.hi-badge[data-fx=key]）。
 * HudIcons.proc(el) / procIn(box, key)：效果生效时让图标放大一下并用自己的颜色发光。
 * HudIcons.gaugeState(unit, units) → 角色仪表要的数据（纯数据，联机可以直接发）；HudIcons.gauge(state) → 仪表 HTML。
 * HudIcons.covered(token)：状态文字里这个词已经有图标了（单位卡上就不再重复写字）。 */
(function (root) {
  "use strict";
  let seq = 0;
  const uid = (p) => p + "-" + (++seq);
  const C = n => `var(--hi-${n})`;
  const svg = (body, vb = "0 0 40 40") => `<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;
    /* ---- 角色仪表图标（照设计稿） ---- */
  const I = {
    // 夕夏：仪表盘上的「发动机故障灯」形状
    engine: on => svg(`<path d="M6 16h4l3-4h10l2 3h4v-3h4v16h-4v-3h-3l-3 4H12l-3-4H6z" fill="${on ? C("red") : C("off")}" stroke="${on ? "#ffb0a0" : "#5a5146"}" stroke-width="1.4"/><path d="M14 18h10M16 22h6" stroke="#0d0b09" stroke-width="2"/>`),
    // 夕夏：加油站油泵（仪表盘燃油灯）
    pump: on => svg(`<rect x="7" y="8" width="16" height="26" rx="2" fill="${on ? C("amber") : C("off")}"/><rect x="10" y="11" width="10" height="7" fill="#0d0b09"/><path d="M23 14h4l4 4v12a2 2 0 0 1-4 0v-6h-4" fill="none" stroke="${on ? C("amber") : C("off")}" stroke-width="2.4"/><rect x="5" y="33" width="20" height="3" fill="${on ? C("amber") : C("off")}"/>`),
    // 川川：闪电
    bolt: on => svg(`<path d="M13 2 3 15h6l-3 11 11-14h-6l3-10z" fill="${on ? "url(#hi-bolt-grad)" : C("off")}" stroke="${on ? "#fff6b0" : "none"}" stroke-width=".8"/><defs><linearGradient id="hi-bolt-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff36b"/><stop offset=".55" stop-color="#ffd23a"/><stop offset="1" stop-color="#5fe1ff"/></linearGradient></defs>`, "0 0 20 28"),
    // 川川：磁场护盾
    magnet: on => svg(`<path d="M8 8v12a12 12 0 0 0 24 0V8h-7v12a5 5 0 0 1-10 0V8z" fill="${on ? C("cyan") : C("off")}"/><rect x="8" y="5" width="7" height="5" fill="${on ? "#fff" : "#5a5146"}"/><rect x="25" y="5" width="7" height="5" fill="${on ? "#fff" : "#5a5146"}"/>`),
    // 诺拉：温和（竖着的针管，浅绿）
    gentle: on => svg(`<g fill="none" stroke="${on ? C("green") : C("off")}" stroke-width="2.4" stroke-linecap="round"><path d="M20 3v5M14 8h12"/><rect x="15" y="8" width="10" height="18" rx="1.5" fill="${on ? "#8ff0a833" : "none"}"/><path d="M15 14h4M15 19h4"/><path d="M20 26v10"/></g><circle cx="20" cy="37.5" r="1.2" fill="${on ? C("green") : C("off")}"/>`),
    // 诺拉：残忍（斜着的针管戳出血，浅红）
    cruel: on => svg(`<g transform="rotate(38 20 20)" fill="none" stroke="${on ? C("pink") : C("off")}" stroke-width="2.4" stroke-linecap="round"><path d="M20 1v5M14 6h12"/><rect x="15" y="6" width="10" height="18" rx="1.5" fill="${on ? "#ff8fa033" : "none"}"/><path d="M15 12h4M15 17h4"/><path d="M20 24v11"/></g><path d="M8 32c0-3 3-6 3-6s3 3 3 6a3 3 0 0 1-6 0z" fill="${on ? "#e8364f" : "#3a332b"}"/><circle cx="16" cy="37" r="1.6" fill="${on ? "#e8364f" : "#3a332b"}"/>`),
    // 诺拉：刺入（针尖），画在目标卡上
    needle: () => svg(`<path d="M20 4 24 26h-8z" fill="#e9eef2" stroke="#9fb3c2" stroke-width="1"/><path d="M20 26v10" stroke="#9fb3c2" stroke-width="2"/><circle cx="20" cy="37" r="2.4" fill="#e8364f"/>`),
    // 瑞比：纳米能源格 / 银翼
    // 瑞比：小型无人机（机身 + 四个旋翼；激光模式时机腹射出一道光）
    drone: (on, laser) => svg(`<path d="M8 14h24" stroke="${on ? "#b9c7d4" : C("off")}" stroke-width="2"/><ellipse cx="8" cy="12" rx="6" ry="1.8" fill="${on ? C("cyan") : C("off")}"/><ellipse cx="32" cy="12" rx="6" ry="1.8" fill="${on ? C("cyan") : C("off")}"/><path d="M8 13v3M32 13v3" stroke="${on ? "#b9c7d4" : C("off")}" stroke-width="2"/><rect x="13" y="15" width="14" height="8" rx="3" fill="${on ? "#d9e7f2" : C("off")}"/><circle cx="20" cy="19" r="2.2" fill="${on ? (laser ? C("red") : C("cyan")) : "#3a332b"}"/>${on && laser ? `<path d="M20 23l-4 13" stroke="${C("red")}" stroke-width="2.4" stroke-linecap="round"/>` : on ? `<path d="M17 26l3 4 3-4" fill="none" stroke="${C("cyan")}" stroke-width="2"/>` : ""}`),
    wing: on => svg(`<path d="M20 30 4 14c6 0 11 2 16 8 5-6 10-8 16-8z" fill="${on ? "#d9e7f2" : C("off")}" stroke="${on ? C("cyan") : "none"}" stroke-width="1.2"/><path d="M8 17l12 9 12-9" stroke="${on ? C("cyan") : "#5a5146"}" stroke-width="1.4" fill="none"/>`),
    // 结人：咖啡豆 / 咖啡杯 / 牵挂
    bean: on => svg(`<ellipse cx="10" cy="13" rx="7" ry="10" transform="rotate(25 10 13)" fill="${on ? "#8a5a3b" : C("off")}"/><path d="M6 5c5 5 3 12 7 17" stroke="${on ? "#3b2416" : "#2a241d"}" stroke-width="1.8" fill="none"/>`, "0 0 20 26"),
    cup: on => svg(`<path d="M7 14h20l-2 18H9z" fill="${on ? "#c78a55" : C("off")}"/><path d="M27 17h3a4 4 0 0 1 0 8h-4" fill="none" stroke="${on ? "#c78a55" : C("off")}" stroke-width="2.4"/><path d="M13 5c-2 3 2 4 0 7M19 5c-2 3 2 4 0 7" stroke="${on ? "#f1e6cf99" : "none"}" stroke-width="1.6" fill="none"/>`),
    bond: on => svg(`<path d="M20 33S6 24 6 14a7 7 0 0 1 14-2 7 7 0 0 1 14 2c0 10-14 19-14 19z" fill="${on ? "#ff7f9b" : C("off")}"/><path d="M2 36c8-6 14 2 20-4s10-2 16-6" stroke="${on ? "#ffd6df" : "#3a332b"}" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>`),
    // 绯秋：刀（火 / 冰）
    blade: (on, color, out) => svg(`<path d="M6 34 30 6l3 2L10 36z" fill="${on ? color : C("off")}" opacity="${out ? .35 : 1}"/><rect x="3" y="31" width="9" height="3" transform="rotate(-50 7 32)" fill="${on ? "#d8c08a" : "#5a5146"}"/>${out ? `<path d="M22 4l14 14" stroke="${C("brass")}" stroke-width="2" stroke-dasharray="3 2"/>` : ""}`),
    // 灯：圣盾 / 决一死战
    holy: on => svg(`<path d="M20 4 33 9v10c0 9-6 14-13 17C13 33 7 28 7 19V9z" fill="${on ? "#ffd56b" : C("off")}" stroke="${on ? "#fff3c4" : "none"}" stroke-width="1.2"/><path d="M20 11v16M14 17h12" stroke="${on ? "#8a5a10" : "#3a332b"}" stroke-width="2.6"/>`),
    duel: on => svg(`<path d="M6 6l20 20M34 6 14 26" stroke="${on ? C("red") : C("off")}" stroke-width="3.2" stroke-linecap="round"/><path d="M10 30l4-4M30 30l-4-4" stroke="${on ? "#ffb0a0" : "#5a5146"}" stroke-width="3" stroke-linecap="round"/>`),
    // 柯尔特：电钻 / 酸液炮 / 过度自信
    drill: on => svg(`<path d="M4 16h14v8H4z" fill="${on ? C("blue") : C("off")}"/><path d="M18 14l16 6-16 6z" fill="${on ? "#c8d6ff" : "#5a5146"}"/><path d="M21 15l2 10M26 17l1.5 6" stroke="#0d0b09" stroke-width="1.4"/><path d="M8 24v6h4" stroke="${on ? C("blue") : C("off")}" stroke-width="2.4" fill="none"/>`),
    acid: on => svg(`<rect x="4" y="15" width="20" height="10" rx="2" fill="${on ? "#7ccf3a" : C("off")}"/><rect x="24" y="17" width="9" height="6" fill="${on ? "#a8f06a" : "#5a5146"}"/><path d="M33 20c3 0 4 4 2 7" stroke="${on ? "#c8ff8a" : "none"}" stroke-width="2" fill="none"/><circle cx="36" cy="31" r="2" fill="${on ? "#c8ff8a" : "none"}"/>`),
    // 柯尔特：废料（一堆碎铁片 + 螺栓）
    scrap: on => svg(`<path d="M5 33l5-9 7 3 4-8 6 5 5-4 4 13z" fill="${on ? "#9a8f7f" : C("off")}"/><path d="M12 24l3-7 6 2-2 6z" fill="${on ? "#c9b98a" : "#5a5146"}"/><path d="M24 19l5-6 3 3-4 5z" fill="${on ? "#7ccf3a" : "#4a4238"}"/><circle cx="17" cy="30" r="2" fill="#0d0b09"/><circle cx="28" cy="29" r="1.6" fill="#0d0b09"/>`),
    proud: on => svg(`<path d="M20 4 33 9v10c0 9-6 14-13 17C13 33 7 28 7 19V9z" fill="none" stroke="${on ? C("brass") : C("off")}" stroke-width="2.4"/><path d="M13 22l7-7 7 7M13 28l7-7 7 7" stroke="${on ? C("brass") : C("off")}" stroke-width="2.4" fill="none"/>`),
    // Helumica：频谱 / 环境扫描 / 锁定
    wave: on => svg(`<path d="M2 20h5l3-10 4 20 4-16 4 12 3-6h13" stroke="${on ? C("violet") : C("off")}" stroke-width="2.4" fill="none" stroke-linejoin="round"/>`),
    radar: on => svg(`<circle cx="20" cy="20" r="15" fill="none" stroke="${on ? C("mint") : C("off")}" stroke-width="2"/><circle cx="20" cy="20" r="8" fill="none" stroke="${on ? C("mint") : C("off")}" stroke-width="1.4"/><path d="M20 20 31 9" stroke="${on ? C("mint") : C("off")}" stroke-width="2.4"/><circle cx="27" cy="25" r="2.2" fill="${on ? C("mint") : "none"}"/>`),
    lock: on => svg(`<circle cx="20" cy="20" r="13" fill="none" stroke="${on ? C("violet") : C("off")}" stroke-width="2.4"/><path d="M20 3v8M20 29v8M3 20h8M29 20h8" stroke="${on ? C("violet") : C("off")}" stroke-width="2.4"/><circle cx="20" cy="20" r="3" fill="${on ? C("violet") : C("off")}"/>`),
    // 拉斯缪尔：光能 / 不稳
    light: on => svg(`<path d="M10 14l14-6 4 8-14 6z" fill="${on ? "#fff3b0" : C("off")}"/><path d="M26 10l10-4M28 15l10 0M26 20l10 4" stroke="${on ? "#fff3b0" : "none"}" stroke-width="2"/><rect x="4" y="18" width="10" height="7" transform="rotate(-22 9 21)" fill="${on ? "#c9b98a" : "#5a5146"}"/>`),
    hazard: on => svg(`<path d="M20 4 37 34H3z" fill="${on ? C("amber") : C("off")}"/><path d="M20 14v10" stroke="#0d0b09" stroke-width="3.2" stroke-linecap="round"/><circle cx="20" cy="29" r="2" fill="#0d0b09"/>`),
    // A 扳机：扳机护圈 + 扳机。锁上时扳机后面插着一根横销（扳机扣不动）；解锁时横销拔掉、扳机亮红
    trigA: open => svg(`<path d="M4 12h32v5H4z" fill="${open ? "#8a7458" : "#4a4238"}"/><path d="M10 17c0 10 4 15 12 15h6c4 0 6-3 6-7v-8" fill="none" stroke="${open ? "#c9a85a" : "#5a5146"}" stroke-width="2.6"/><path d="M21 17c0 6-2 9-5 11" fill="none" stroke="${open ? C("red") : "#6b6257"}" stroke-width="3.4" stroke-linecap="round"/>${open ? "" : `<rect x="14" y="19.5" width="14" height="3.4" rx="1.2" fill="#b9ad98"/><circle cx="14" cy="21.2" r="2.4" fill="#b9ad98"/>`}`),
    // 龙哥：吐酸
    padlock: open => svg(`<rect x="9" y="18" width="22" height="16" rx="2" fill="${open ? C("mint") : C("off")}"/><path d="${open ? "M14 18v-6a6 6 0 0 1 12 0" : "M14 18v-6a6 6 0 0 1 12 0v6"}" fill="none" stroke="${open ? C("mint") : "#7a6f60"}" stroke-width="3"/><circle cx="20" cy="26" r="2.4" fill="#0d0b09"/>`),
    spit: on => svg(`<path d="M6 22c6-8 16-10 26-6-4 2-6 4-6 7 4-1 7 0 9 3-8 2-18 2-29-4z" fill="${on ? "#7ccf3a" : C("off")}"/><circle cx="12" cy="20" r="1.6" fill="#0d0b09"/><path d="M33 10c0 0 3 4 3 6a3 3 0 0 1-6 0c0-2 3-6 3-6z" fill="${on ? "#c8ff8a" : "none"}"/>`)
  };
  const seg = (n, max, color, w = 10, h = 22) => `<div class="pips">${Array.from({ length: max }, (_, i) => `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px"><rect x="0" y="0" width="${w}" height="${h}" rx="1.5" fill="${i < n ? color : "#2c261f"}"/></svg>`).join("")}</div>`;
  const ring = (pct, color, label) => { const r = 15, c = 2 * Math.PI * r, p = Math.min(1, pct / 100); return `<svg viewBox="0 0 40 40" style="width:46px;height:46px"><circle cx="20" cy="20" r="${r}" fill="none" stroke="#2c261f" stroke-width="5"/><circle cx="20" cy="20" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 20 20)" stroke-linecap="butt"/><text x="20" y="24" text-anchor="middle" font-family="Oxanium, sans-serif" font-size="10" font-weight="700" fill="#f1e6cf">${label}</text></svg>`; };
  const ind = (icon, label, cls = "") => `<div class="ind ${cls}">${icon}<span>${label}</span></div>`;
  
  /* 绯秋的刀徽：每把刀 = 刀柄（缠绳颜色）+ 刀镡 + 刀身 / 刀鞘（系绳颜色）。以刀柄末端到刀尖为 x 轴，中心在原点 */
  function katana(color, opt) {
    const sheathed = opt.sheathed, emptySaya = opt.emptySaya, dim = opt.dim;
    const hilt = emptySaya ? "" : `<rect x="-30" y="-2.6" width="13" height="5.2" rx="1.2" fill="${color}"/><path d="M-27-2.6l3 5.2M-23-2.6l3 5.2M-19-2.6l2 3.4" stroke="#0007" stroke-width="1"/><rect x="-17.4" y="-4.4" width="2.6" height="8.8" rx="1" fill="#c9a85a"/>`;
    const saya = `<path d="M-14.6-3.1L24-3.4Q29.5-3 30-0.2Q29.4 3 24 3.1L-14.6 3.1Z" fill="#4a3a2c" stroke="#8a7458" stroke-width="1.1"/><rect x="-11" y="-3.3" width="3" height="6.6" fill="${color}"/>`;
    const blade = `<path d="M-14.6-2.1L24-2.6Q29-2.3 30.5 0.9L-14.6 2Z" fill="#e3e9ee"/><path d="M-14.6 1.2L29 0.4" stroke="#9fb3c2" stroke-width=".8"/>`;
    return `<g transform="translate(${opt.x} ${opt.y}) rotate(${opt.a})" opacity="${dim ? .62 : 1}">${emptySaya ? saya : sheathed ? hilt + saya : hilt + blade}</g>`;
  }
  function hiakiEmblem(stance, front, back) {
    let g = "";
    if (stance === "draw") {   // 出鞘的刀和后面收鞘的刀交叉成 X
      if (back) g += katana(back, { sheathed: true, x: 32, y: 32, a: -135, dim: true });
      g += katana(front, { x: 32, y: 32, a: -45 });
    } else if (stance === "iai") {   // 收刀：两把都在鞘里
      if (back) g += katana(back, { sheathed: true, x: 35, y: 26, a: -32, dim: true });
      g += katana(front, { sheathed: true, x: 30, y: 37, a: -32 });
    } else {   // 胁构：刀身竖、空刀鞘横，交点偏上偏左
      if (back) g += katana(back, { sheathed: true, x: 34, y: 40, a: -160, dim: true });
      g += katana(front, { emptySaya: true, x: 33, y: 22, a: 180 });
      g += katana(front, { x: 26, y: 33, a: -90 });
    }
    return `<svg viewBox="0 0 64 64" style="width:64px;height:64px" aria-hidden="true">${g}</svg>`;
  }
    /* ---- 状态效果 ---- */
  const EC = { fire: "#ff7354", electric: "#f2d94e", acid: "#8fd65a", ice: "#8fd3ff", physical: "#e8a062", energy: "#5fd6dc", harmonic: "#c08cf0" };
  const HEX = "M20 2 36 11v18L20 38 4 29V11z";
  const hexBadge = (color, glyph) => `<path d="${HEX}" fill="#15110d" stroke="${color}" stroke-width="2.4"/>${glyph(color)}`;
  const sqBadge = (good, glyph) => { const c = good ? "#7fe08f" : "#ff6a5a"; return `<rect x="3" y="3" width="34" height="34" rx="7" fill="#15110d" stroke="${c}" stroke-width="2.4"/>${glyph(good ? "#d9f7dd" : "#ffd9d3", c)}`; };
  const G = {
    burn: c => `<path d="M20 9c4 5 9 8 9 15a9 9 0 0 1-18 0c0-4 2-6 4-8 0 3 1 5 3 5-1-4 0-8 2-12z" fill="${c}"/><path d="M20 22c2 2 4 3 4 6a4 4 0 0 1-8 0c0-2 2-4 4-6z" fill="#ffe08a"/>`,
    shock: c => `<path d="M22 7 12 22h7l-3 11 12-16h-7l3-10z" fill="${c}"/><path d="M8 13l3 1M31 27l3 1M30 10l-2 2" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
    corr: c => `<path d="M20 8c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z" fill="${c}"/><circle cx="17" cy="25" r="2.6" fill="#15110d"/><circle cx="23" cy="20" r="1.6" fill="#15110d"/><path d="M14 33c1 2 3 2 4 0" stroke="${c}" stroke-width="1.6" fill="none"/>`,
    frost: c => `<g stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M20 8v24M9.6 14l20.8 12M9.6 26l20.8-12"/><path d="M17 10l3 3 3-3M17 30l3-3 3 3"/></g>`,
    quake: c => `<rect x="10" y="22" width="20" height="5" rx="1" fill="${c}"/><path d="M24 22l-3 2.5 2 2.5" stroke="#15110d" stroke-width="1.6" fill="none"/><path d="M13 16q7-6 14 0M10 12q10-9 20 0" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 29v4m-3-2 3 3 3-3" stroke="${c}" stroke-width="1.8" fill="none"/>`,
    high: c => `<circle cx="20" cy="20" r="5" fill="${c}"/><g stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M20 8v5M20 27v5M8 20h5M27 20h5M11.5 11.5l3.5 3.5M25 25l3.5 3.5M28.5 11.5 25 15M15 25l-3.5 3.5"/></g>`,
    reso: c => `<circle cx="14" cy="20" r="6" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="26" cy="20" r="6" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M7 31q3-3 6 0t6 0 6 0 6 0" stroke="${c}" stroke-width="1.6" fill="none"/>`,
    unsteady: (c) => `<path d="M12 31h16" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><rect x="17" y="10" width="6" height="18" rx="1.5" fill="${c}" transform="rotate(14 20 28)"/><path d="M28 12q3 3 0 6M31 9q5 6 0 12" stroke="${c}" stroke-width="1.6" fill="none"/>`,
    stun: (c) => `<ellipse cx="20" cy="22" rx="11" ry="5" fill="none" stroke="${c}" stroke-width="1.8"/><path d="M12 15l1.4 2.8 3 .4-2.2 2 .6 3-2.8-1.5-2.7 1.5.5-3-2.2-2 3.1-.4z" fill="${c}"/><path d="M27 12l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="${c}"/><circle cx="21" cy="27.5" r="2" fill="${c}"/>`,
    chase: (c) => `<path d="M9 14l7 6-7 6M17 14l7 6-7 6" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="30" cy="20" r="4" fill="none" stroke="${c}" stroke-width="2"/><circle cx="30" cy="20" r="1.4" fill="${c}"/>`,
    weak: (c) => `<path d="M14 9l12 12-3 3L11 12z" fill="${c}"/><path d="M21 26l-4 4M23 23l3 3" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M29 20v12m-4-4 4 4 4-4" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    inspire: (c) => `<path d="M14 31l12-12-3-3L11 28z" fill="${c}"/><path d="M21 14l-4-4M23 17l3-3" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M29 20V8m-4 4 4-4 4 4" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
    firm: (c) => `<circle cx="20" cy="11" r="3" fill="none" stroke="${c}" stroke-width="2.2"/><path d="M20 14v17M14 18h12M10 25c2 5 6 7 10 7s8-2 10-7" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    hide: (c) => `<path d="M7 20q13-12 26 0-13 12-26 0z" fill="none" stroke="${c}" stroke-width="2.2"/><circle cx="20" cy="20" r="3.6" fill="${c}"/><path d="M9 31 31 9" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`,
    adv: (c) => `<rect x="7" y="13" width="13" height="13" rx="2.5" fill="none" stroke="${c}" stroke-width="2" opacity=".55"/><rect x="18" y="9" width="15" height="15" rx="2.5" fill="${c}"/><circle cx="22" cy="13" r="1.5" fill="#15110d"/><circle cx="29" cy="20" r="1.5" fill="#15110d"/><circle cx="25.5" cy="16.5" r="1.5" fill="#15110d"/><path d="M25 33v-5m-3 2 3-3 3 3" stroke="${c}" stroke-width="2" fill="none"/>`
  };
    /* ---- 即时 / 自我 / 攻击效果 ---- */
  const NEUTRAL = "#d8b25a";
  const circBadge = (c, g) => `<circle cx="20" cy="20" r="17" fill="#15110d"/><path d="M20 3a17 17 0 1 1-12.02 4.98" fill="none" stroke="${c}" stroke-width="2.6"/><path d="M8 8l-3.2-1.2M8 8l.6-3.4" stroke="${c}" stroke-width="2" stroke-linecap="round"/><g transform="translate(20 20) scale(.86) translate(-20 -20)">${g(c)}</g>`;
  const diaBadge = (c, g) => `<path d="M20 1.5 38.5 20 20 38.5 1.5 20z" fill="#15110d" stroke="${c}" stroke-width="2.4"/><g transform="translate(20 20) scale(.74) translate(-20 -20)">${g(c)}</g>`;
  const arrBadge = (c, g) => { const cid = uid("hi-arr"); return `<clipPath id="${cid}"><path d="M3 5h22l13 15-13 15H3l7-15z"/></clipPath><path d="M3 5h22l13 15-13 15H3l7-15z" fill="#15110d"/><g clip-path="url(#${cid})"><g transform="translate(21.5 20) scale(.7) translate(-20 -20)">${g(c)}</g></g><path d="M3 5h22l13 15-13 15H3l7-15z" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>`; };
  const G2 = {
    // 即时
    melt: c => `<path d="M11 11h18v8c0 2-2 2-2 4s-2 3-2 1-2-3-3-1-1 6-3 6-1-5-3-5-2 2-3 0z" fill="${c}"/><path d="M14 14h12" stroke="#15110d" stroke-width="1.6"/><circle cx="19" cy="33" r="1.6" fill="${c}"/>`,
    pierceIce: c => `<path d="M13 8 27 8 20 33z" fill="${c}"/><path d="M20 8v20" stroke="#15110d" stroke-width="1.2" opacity=".5"/><path d="M9 26h7M24 26h7" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
    neutral: c => `<path d="M16 8h8M17 8v7l-6 12a3 3 0 0 0 3 4h12a3 3 0 0 0 3-4l-6-12V8" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/><path d="M13 25h14l2 4a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2z" fill="${c}"/><circle cx="18" cy="21" r="1.5" fill="${c}"/><circle cx="22" cy="18" r="1" fill="${c}"/>`,
    overload: c => `<rect x="9" y="12" width="20" height="16" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><rect x="29" y="17" width="3" height="6" fill="${c}"/><path d="M20 13l-5 8h4l-2 6 6-9h-4l2-5z" fill="${c}"/><path d="M33 9l2-3M35 13l3-1" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`,
    shift: c => `<rect x="9" y="11" width="13" height="6" rx="1" fill="${c}"/><rect x="9" y="23" width="13" height="6" rx="1" fill="none" stroke="${c}" stroke-width="2"/><path d="M27 10v19m-3-3 3 3 3-3M31 29V11" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M28 14l3-3 3 3" stroke="${c}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
    diffuse: c => `<path d="M18 20a2 2 0 0 1 4 0a4 4 0 0 1-8 0a6 6 0 0 1 12 0a8 8 0 0 1-16 0a10 10 0 0 1 20 0" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`,
    refract: c => { const cid = uid("hi-refract"); return `<defs><clipPath id="${cid}"><circle cx="20" cy="20" r="15.5"/></clipPath></defs><g clip-path="url(#${cid})"><rect x="0" y="16" width="40" height="8" fill="${c}" opacity=".22"/><rect x="0" y="24" width="40" height="16" fill="${c}" opacity=".45"/><path d="M0 16h40M0 24h40" stroke="${c}" stroke-width="1.2" opacity=".8"/></g><path d="M9 7l9 9 4.5 8 1.8 11" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`; },
    // 自我
    selfBurn: c => `<path d="M20 4c3 5 9 7 10 15 1 6-2 13-10 13S9 25 10 19c1-5 4-6 4-10 2 2 3 4 3 6 1-3 2-7 3-11z" fill="${c}"/><circle cx="20" cy="19" r="3" fill="#15110d"/><path d="M14.5 31c0-4.5 2.4-7.5 5.5-7.5s5.5 3 5.5 7.5z" fill="#15110d"/>`,
    frostShell: c => `<g transform="translate(20 20) scale(1.15) translate(-20 -20)"><path fill-rule="evenodd" fill="${c}" d="M20 8 30 13.5v13L20 32l-10-5.5v-13zM20 13.6a2.9 2.9 0 1 0 0 5.8a2.9 2.9 0 1 0 0-5.8zM15.3 27.6c0-3.6 2.1-6.6 4.7-6.6s4.7 3 4.7 6.6z"/></g>`,
    splash: c => `<path d="M19 9c3 0 4 3 6 3s4-1 5 1-1 4 0 6 3 3 1 5-4 1-5 3-1 4-4 4-3-3-5-3-4 2-6 0 0-4-2-5-4-2-3-4 3-2 3-4-1-4 1-6 4 1 6 0 2-4 5-4z" fill="${c}"/><circle cx="31" cy="10" r="2" fill="${c}"/><circle cx="8" cy="27" r="1.6" fill="${c}"/><circle cx="29" cy="31" r="1.3" fill="${c}"/>`,
    conductor: c => `<path d="M9 20h3c0-5 4-5 4 0s4 5 4 0 4-5 4 0 4 5 4 0h3" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="8" cy="20" r="2" fill="${c}"/><circle cx="32" cy="20" r="2" fill="${c}"/>`,
    heavy: c => `<path d="M15 14a5 5 0 0 1 10 0" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M11 15h18l2 14H9z" fill="${c}"/><path d="M13 22h14" stroke="#15110d" stroke-width="1.6" opacity=".5"/>`,
    store: c => `<rect x="13" y="10" width="14" height="22" rx="2" fill="none" stroke="${c}" stroke-width="2.2"/><rect x="17" y="7" width="6" height="3" fill="${c}"/><rect x="16" y="22" width="8" height="7" fill="${c}"/><path d="M17 19l3-3 3 3" stroke="${c}" stroke-width="1.8" fill="none"/>`,
    doppler: c => `<circle cx="14" cy="20" r="2.6" fill="${c}"/><path d="M19 13q3 7 0 14M23 11q4 9 0 18M28 9q5 11 0 22" stroke="${c}" stroke-width="1.8" fill="none"/><path d="M10 15q-2 5 0 10" stroke="${c}" stroke-width="1.4" fill="none" opacity=".6"/>`,
    // 狂暴（下水道狂鼠，effects.js · FRENZY）：怒筋（四角的弯钩）
    frenzy: c => `<path d="M10 16q6 0 6-6M30 16q-6 0-6-6M10 24q6 0 6 6M30 24q-6 0-6 6" stroke="${c}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
    // 攻击
    blast: c => `<path d="M17 7l2.5 7 6-4-2 7 7 1-6 4 4 6-7-2-1 7-3-6-5 4 1-7-7-1 6-4-4-6 7 2z" fill="${c}"/>`,
    iceBreak: c => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-3-5 1-4-4-5M19 21l5-3 2-5 5-2M19 21l5 4 1 5 4 3M19 21l-4 3-1 6-3 3M19 21l-7-1-4 2"/><path d="M17 12l-3 0M25 15l2 2M25 28l-3 1M15 27l-3-2"/></g>`,
    strike: c => `<path d="M10 14a5 5 0 0 1 6-5 6 6 0 0 1 11 2 4 4 0 0 1 0 8H12a4 4 0 0 1-2-5z" fill="${c}"/><path d="M19 19l-3 6h4l-3 7" stroke="${c}" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`,
    etch: c => `<path fill-rule="evenodd" fill="${c}" d="M15 5h10v14h7L20 34 8 19h7zM20 12c-2.8 3.8-4 6-4 7.8a4 4 0 0 0 8 0c0-1.8-1.2-4-4-7.8z"/>`,
    backflow: c => `<g transform="translate(-2.5 2.5)"><path d="M27 13a8.5 8.5 0 1 0 1 12" fill="none" stroke="${c}" stroke-width="3.6" stroke-linecap="round"/><path d="M28 8v6.5h-6.5" stroke="${c}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`,
    inertia: c => `<path d="M7 15h15V8l12 12-12 12v-7H7z" fill="${c}"/>`,
    diffract: c => `<rect x="17" y="8" width="3" height="10" fill="${c}"/><rect x="17" y="22" width="3" height="10" fill="${c}"/><path d="M6 20h9" stroke="${c}" stroke-width="2"/><path d="M22 20q3-4 8-6M22 20h9M22 20q3 4 8 6" stroke="${c}" stroke-width="1.8" fill="none"/>`,
    pierce: c => `<rect x="18" y="9" width="3" height="22" fill="#4a4238"/><rect x="24" y="9" width="3" height="22" fill="#6b5c48"/><path d="M6 20h22l5-3v6l-5-3" stroke="${c}" stroke-width="2.2" fill="${c}" stroke-linejoin="round"/>`,
    smash: c => `<g transform="translate(17 20) scale(1.25) translate(-17 -20)"><path d="M14.5 25.5-3.5 51" stroke="${c}" stroke-width="3" stroke-linecap="round"/><rect x="8.5" y="15.5" width="17" height="9" rx="1.5" fill="${c}" transform="rotate(35 17 20)"/><path d="M24 28.5l3 2.5M21 31l1 3.5M26 24.5l3.5-.5" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/></g>`,
    weakspot: c => `<circle cx="20" cy="20" r="13" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="20" cy="20" r="8" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="20" cy="20" r="3.4" fill="${c}"/>`,
  };
  /* ---------- 图标表：key → 名字、外形、颜色、图案 ---------- */
  const ICONS = {};
  const add = (key, name, shape, color, glyph, good) => { ICONS[key] = { key, name, shape, color, glyph, good }; };
  [["burn", "灼烧", "fire"], ["shock", "感电", "electric"], ["corr", "腐蚀", "acid"], ["frost", "冻伤", "ice"],
   ["quake", "震荡", "physical"], ["high", "高能", "energy"], ["reso", "共振", "harmonic"]].forEach(([k, n, e]) => add(k, n, "hex", EC[e], G[k]));
  [["unsteady", "不稳", false], ["stun", "晕眩", false], ["chase", "紧追", false], ["weak", "虚弱", false],
   ["inspire", "振奋", true], ["firm", "坚挺", true], ["hide", "躲藏", true], ["adv", "优势", true]].forEach(([k, n, good]) => add(k, n, "sq", good ? "#7fe08f" : "#ff6a5a", G[k], good));
  [["melt", "熔融", "fire"], ["pierceIce", "刺骨", "ice"], ["neutral", "中和", "acid"], ["overload", "过载", "electric"],
   ["shift", "错位", "physical"], ["diffuse", "扩散", "energy"], ["refract", "折射", "harmonic"]].forEach(([k, n, e]) => add(k, n, "circ", EC[e], G2[k]));
  [["selfBurn", "自焚", "fire"], ["frostShell", "霜结", "ice"], ["splash", "溅射", "acid"], ["conductor", "导体", "electric"],
   ["heavy", "千钧", "physical"], ["store", "蓄能", "energy"], ["doppler", "多普勒", "harmonic"]].forEach(([k, n, e]) => add(k, n, "dia", EC[e], G2[k]));
  // 狂暴（下水道狂鼠）：不归属任何属性的自我效果，用怒红色
  add("frenzy", "狂暴", "dia", "#ff5f4a", G2.frenzy);
  [["blast", "爆燃", "fire"], ["iceBreak", "破冰", "ice"], ["strike", "雷击", "electric"], ["etch", "蚀刻", "acid"],
   ["backflow", "倒流", "energy"], ["inertia", "惯性", "physical"], ["diffract", "衍射", "harmonic"],
   ["pierce", "穿刺", ""], ["smash", "猛击", ""], ["weakspot", "弱点特效", ""]].forEach(([k, n, e]) => add(k, n, "arr", e ? EC[e] : NEUTRAL, G2[k]));
  // 首领 / 10 级起精英的晕眩标记：两颗星（要失衡两次），数字是「已攒 / 要攒」
  add("stunMark", "晕眩标记", "circ", "#ffb347", c => `<path d="M13 11l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="${c}"/><path d="M27 11l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z" fill="${c}"/><ellipse cx="20" cy="28" rx="11" ry="3.6" fill="none" stroke="${c}" stroke-width="1.8"/>`);
  // 休眠（通用词条）：通用状态的圆角方块，灰蓝色描边，里面是一大两小的「Zzz」
  // 下潜：沙面上的一道波纹 + 往下的箭头
  ICONS.submerged = { key: "submerged", name: "下潜", shape: "raw", color: "#d9a35f", raw: () => svg(`<rect x="3" y="3" width="34" height="34" rx="7" fill="#15110d" stroke="#d9a35f" stroke-width="2.4"/><path d="M7 15c3-3 6-3 9 0s6 3 9 0 5-2 8 0" fill="none" stroke="#f0cf9a" stroke-width="2.4" stroke-linecap="round"/><path d="M20 19v12M15 26l5 5 5-5" fill="none" stroke="#d9a35f" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`) };
  // 下陷（流沙）：陷到半身的人形 + 沙面
  ICONS.sink = { key: "sink", name: "下陷", shape: "raw", color: "#c98a3c", raw: () => svg(`<rect x="3" y="3" width="34" height="34" rx="7" fill="#15110d" stroke="#c98a3c" stroke-width="2.4"/><circle cx="20" cy="12" r="4" fill="#f0cf9a"/><path d="M14 24l2-6h8l2 6" fill="#f0cf9a"/><path d="M6 24c4-2 8-2 14 0s10 2 14 0v9H6z" fill="#c98a3c"/>`) };
  ICONS.dormant = { key: "dormant", name: "休眠", shape: "raw", color: "#8fb4d9", raw: () => svg(`<rect x="3" y="3" width="34" height="34" rx="7" fill="#15110d" stroke="#8fb4d9" stroke-width="2.4"/><path d="M8 11h9l-9 10h9" fill="none" stroke="#d6e6f5" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 19h7l-7 8h7" fill="none" stroke="#b3cde6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 26h5l-5 6h5" fill="none" stroke="#8fb4d9" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`) };
  // 别人挂上的标记：诺拉的刺入、结人的牵挂
  ICONS.needle = { key: "needle", name: "刺入", shape: "raw", color: "#9fb3c2", raw: () => I.needle() };
  ICONS.bond = { key: "bond", name: "牵挂", shape: "raw", color: "#ff7f9b", raw: () => I.bond(true) };
  // 别名：游戏里另外的叫法也算同一个图标
  const ALIAS = { "超载": "overload", "冻结": "frost" };
  const BY_NAME = {};
  Object.keys(ICONS).forEach(k => { BY_NAME[ICONS[k].name] = k; });
  Object.keys(ALIAS).forEach(n => { BY_NAME[n] = ALIAS[n]; });

  function body(key) {
    const ic = ICONS[key];
    if (!ic) return "";
    if (ic.shape === "hex") return hexBadge(ic.color, ic.glyph);
    if (ic.shape === "sq") return sqBadge(ic.good, ic.glyph);
    if (ic.shape === "circ") return circBadge(ic.color, ic.glyph);
    if (ic.shape === "dia") return diaBadge(ic.color, ic.glyph);
    if (ic.shape === "arr") return arrBadge(ic.color, ic.glyph);
    return "";
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function icon(key) {
    const ic = ICONS[key];
    if (!ic) return "";
    if (ic.shape === "raw") return ic.raw().replace("<svg ", '<svg class="hi-svg" ');
    return `<svg class="hi-svg" viewBox="0 0 40 40" aria-hidden="true">${body(key)}</svg>`;
  }
  function badge(key, stack, title) {
    const ic = ICONS[key];
    if (!ic) return "";
    const st = stack != null && stack !== "" && stack !== true ? `<span class="hi-stack">${esc(stack)}</span>` : "";
    return `<span class="hi-badge hi-${ic.shape}" data-fx="${key}" style="--glow:${ic.color}" title="${esc(title || ic.name + (st ? " " + stack : ""))}" role="img" aria-label="${esc(ic.name)}">${icon(key)}${st}</span>`;
  }

  /* ---------- 单位身上的徽章 ---------- */
  const STATUS_KEY = { burn: "burn", shock: "shock", corr: "corr", frostbite: "frost", shockwave: "quake", high: "high", reso: "reso",
    unstable: "unsteady", chase: "chase", weak: "weak", inspire: "inspire", sturdy: "firm", hide: "hide", advantage: "adv" };
  const INSTANT_KEY = { melt: "melt", sting: "pierceIce", overload: "overload", shift: "shift", spread: "diffuse", refract: "refract" };
  const SELF_KEY = { burn: "selfBurn", frost: "frostShell", splash: "splash", conductor: "conductor", anchor: "heavy", store: "store", doppler: "doppler", frenzy: "frenzy" };
  const ATK_KEY = { combust: "blast", icebreak: "iceBreak", bolt: "strike", etch: "etch", backflow: "backflow", inertia: "inertia", diffract: "diffract" };
  function unitBadges(u, extra) {
    if (!u) return [];
    const out = [], st = u.statuses || {};
    Object.keys(STATUS_KEY).forEach(k => {
      // 高能只看高能状态；没有高能状态的高能值记在蓄能徽章上（#52）
      if (k === "high") { const he = Number(u.highEnergy) || 0; if (st.high) out.push({ key: "high", stack: he > 0 ? he : "" }); else if (he > 0 && u.self !== "store") out.push({ key: "store", stack: he }); return; }
      const v = st[k];
      if (v) out.push({ key: STATUS_KEY[k], stack: k === "burn" && Number(v) > 0 ? Number(v) : "" });
    });
    const ins = u.instant || {};
    Object.keys(INSTANT_KEY).forEach(k => { if (ins[k]) out.push({ key: INSTANT_KEY[k], stack: "" }); });
    if (u.self && SELF_KEY[u.self]) out.push({ key: SELF_KEY[u.self], stack: u.self === "burn" && Number(u.selfBurnStacks) > 1 ? Number(u.selfBurnStacks)
      : u.self === "store" && !st.high && Number(u.highEnergy) > 0 ? Number(u.highEnergy) : "" });
    if (u.self === "frenzy") { const t = frenzyTitle(u); if (t) out[out.length - 1].title = t; }
    const hung = (u.resources && Array.isArray(u.resources.nextAtkFx)) ? u.resources.nextAtkFx : [];
    hung.forEach(id => { if (ATK_KEY[id]) out.push({ key: ATK_KEY[id], stack: "" }); });
    (extra || []).forEach(k => { if (ICONS[k] && !out.some(b => b.key === k)) out.push({ key: k, stack: "" }); });
    if (Number(u.sink) > 0) out.unshift({ key: "sink", stack: String(u.sink), title: `下陷 ${u.sink} 层（流沙）：每回合开始失去生命上限 ${5 * Number(u.sink)}%；2 层起自己走不出去，3 层不能行动、不能协助。不花行动点就慢慢浮出来` });
    if (u.submerged) out.unshift({ key: "submerged", stack: "", title: "下潜：选不中、范围攻击打不到；只有谐波攻击和塌陷打得到（打到就被迫浮上来 +1 击破）。自己攻击时解除" });
    if (u.dormant) out.unshift({ key: "dormant", stack: "", title: "休眠：不行动、不协助，被叫醒后才开始行动" });
    // 首领、10 级起的精英、载具（和车合并的驾驶员，敌我都算）：一直挂着晕眩标记（0/2 也挂），开打前就看得出要失衡两次才会晕眩
    const max = stunMarkMax(u);
    if (max > 0) {
      const n = Math.min(max, Number(u.stunMarks) || 0);
      out.unshift({ key: "stunMark", stack: `${n}/${max}`, title: `晕眩标记 ${n}/${max}：首领、10 级以上的精英和载具（驾驶员用车的标记）每失衡一次记 1 个标记，攒满 ${max} 个才会真正晕眩（跳过回合）；没攒满时架势立刻恢复` });
    }
    return out;
  }
  /** 狂暴徽章的提示：效果说明读规则（effects.js · frenzyEffectText，数值都在 FRENZY），没加载规则时不写（只显示名字） */
  function frenzyTitle(u) {
    try { return typeof root.frenzyEffectText === "function" ? "狂暴：" + root.frenzyEffectText(u) : ""; } catch (e) { return ""; }
  }
  /** 这个单位用不用晕眩标记规则：联机投影过来的带 stunMax，本地单位直接问规则（我方只有和载具合并的驾驶员用，vehicle.js） */
  function stunMarkMax(u) {
    if (u.stunMax != null) return Number(u.stunMax) || 0;
    if ((u.isPlayer && !u.vehMerged) || typeof root.isBossUnit !== "function") return 0;
    try { return root.isBossUnit(u) ? (typeof root.BOSS_STUN_MARKS === "number" ? root.BOSS_STUN_MARKS : 2) : 0; } catch (e) { return 0; }
  }
  /** 状态文字里的一个词有没有对应的图标（「灼烧×3」「高能 5」「自焚×2」都算） */
  function covered(token) {
    const t = String(token || "").replace(/[×x ]?\d+(\/\d+)?$/, "").trim();
    return !!BY_NAME[t] && t !== "不稳态";
  }
  function keyOf(name) { return BY_NAME[String(name || "").trim()] || null; }

  /* ---------- 生效：放大一下 + 发光 ---------- */
  function proc(el) {
    if (!el || !el.classList) return;
    el.classList.remove("hi-proc"); void el.offsetWidth; el.classList.add("hi-proc");
    clearTimeout(el._hiProc);
    el._hiProc = setTimeout(() => el.classList.remove("hi-proc"), 800);
  }
  function procIn(box, key) {
    if (!box || !key) return false;
    const list = box.querySelectorAll(`.hi-badge[data-fx="${key}"]`);
    list.forEach(proc);
    return list.length > 0;
  }

  /* ---------- 角色仪表 ---------- */
  const has = (name) => typeof root[name] === "function";
  const sumLayers = (u, f) => (u.layers || []).reduce((a, l) => a + (Number(l[f]) || 0), 0);
  function gaugeState(u, units) {
    if (!u || !u.kit) return null;
    units = units || (root.state && root.state.units) || [];
    const r = u.resources || {}, plus = (n) => { try { return has("passivePlus") && !!root.passivePlus(u, n); } catch (e) { return false; } };
    const alive = (x) => x && !x.dead && !x.hidden && !x.fused && !x._removed;
    switch (u.kit) {
      case "xia": return { kit: "xia", engine: !!r.engine, tank: plus(1), fuel: Math.max(0, Math.min(5, Number(r.fuel) || 0)), back: !!u.upOnShp };
      case "chuan": return { kit: "chuan", charge: Math.max(0, Number(r.charge) || 0), shield: units.some(x => alive(x) && (x.shieldFromChuan || (x.id === u.id && x.magnetShield))) };
      case "nora": {
        let pierce = 0;
        try { pierce = has("piercedTargets") ? root.piercedTargets(u).length : (r.piercedId ? 1 : 0); } catch (e) { pierce = r.piercedId ? 1 : 0; }
        let mood = r.mood === "cruel" ? "cruel" : "gentle";
        try { if (has("noraMood")) mood = root.noraMood(u) === "cruel" ? "cruel" : "gentle"; } catch (e) {}
        return { kit: "nora", mood, pierce, lock: plus(2) };
      }
      // 储备能源（补充能源压缩出来的，#219）没有上限，不夹到 100
      case "ruby": return { kit: "ruby", nano: Math.max(0, Math.min(100, Number(r.nano) || 0)), reserve: Math.max(0, Number(r.nanoReserve) || 0), mecha: !!r.mecha,
        // 收发代理（9 级）解锁后才显示无人机图标；放出来之前是暗的
        showDrone: (Number(u.level) || 1) >= 9, drone: !!r.drone, boost: !!r.overdrive };
      case "yuito": {
        const bond = r.bondId ? units.find(x => x.id === r.bondId && alive(x)) : null;
        return { kit: "yuito", bean: Math.max(0, Number(r.bean) || 0), liquid: Math.max(0, Number(r.liquid) || 0), bond: !!bond, bondName: bond ? String(bond.name || "") : "" };
      }
      case "hiaki": return { kit: "hiaki", blade: r.blade === "naruto" ? "naruto" : "niu", out: r.niuOut ? "niu" : r.narutoOut ? "naruto" : "none",
        stance: r.stance === "iai" ? "iai" : r.stance === "waki" ? "guard" : "draw" };
      case "tou": {
        let duel = false;
        try { duel = has("touDuelVictim") && units.some(x => alive(x) && !x.isPlayer && root.touDuelVictim(x)); } catch (e) {}
        return { kit: "tou", shield: Math.max(0, Math.min(3, Number(r.shield) || 0)), duel, taunt: r.tauntLeft == null ? 2 : Math.max(0, Number(r.tauntLeft) || 0), bare: u.weaponHeld === false };
      }
      case "kolt": {
        let scrap = 0;
        try { if (has("koltScrapTotal")) scrap = Number(root.koltScrapTotal(u)) || 0; } catch (e) {}
        // 满血减伤亮不亮：和规则结算同一个判断（app.js · koltPrideCut：被动开着、不在起身中、现有血量 ≥ 进入战斗时的上限）；
        // 规则没载入（单独用这个文件）时照同样的条件比进入战斗时的上限，没记下就比现在的上限。联机玩家的仪表是房主这样算好发过去的
        let full = false, noPassive = false;
        try {
          if (has("koltPrideCut")) full = Number(root.koltPrideCut(u)) > 0;
          else { const mx = Number(u.prideMaxHp) || sumLayers(u, "max"); full = mx > 0 && !u.upOnShp && sumLayers(u, "current") >= mx; }
        } catch (e) {}
        try { noPassive = has("passiveOn") && !root.passiveOn(u); } catch (e) {}
        // rising：起身中（靠坚毅生命撑着，不减伤）——只是个开关，不带坚毅生命的数
        return { kit: "kolt", bit: r.bit === "acid" ? "acid" : "drill", full, cut: plus(2) ? 45 : 25, noPassive, rising: !!u.upOnShp,
          showScrap: (Number(u.level) || 1) >= 2, scrap: Math.max(0, scrap) };
      }
      case "helu": {
        let focus = 0, need = 0;
        units.forEach(x => { if (!alive(x) || x.isPlayer) return; (x.focuses || []).forEach(f => { const n = (f.seq || []).length; if (n && (!need || (f.step || 0) / n > focus / need)) { focus = Number(f.step) || 0; need = n; } }); });
        return { kit: "helu", focus, need, scan: !!r.scanned, lock: Math.max(0, Number(r.lockLeft) || 0) };
      }
      case "ras": return { kit: "ras", pct: Math.max(0, Math.round(Number(r.energyPct) || 0)), light: Math.max(0, Number(r.light) || 0), unstable: !!r.unstable };
      case "longge": {
        const ammo = Array.isArray(r.ammo) ? r.ammo.slice(0, 6) : [];
        const seenArr = Array.isArray(r.seen) && r.seen.length === ammo.length ? r.seen : ammo.map((c, i) => i < (Number(r.known) || 0));
        return { kit: "longge", ammo: ammo.map((c, i) => ({ c: c === "blue" ? "blue" : "red", seen: !!seenArr[i] })), trigger: !!r.trigger, spit: !r.spitUsed };
      }
    }
    return null;
  }

  const GAUGE = {
    xia: s => ind(I.engine(s.engine), s.engine ? "引擎启动" : "引擎熄火", "big" + (s.engine ? " glow-red" : "")) +
      (s.tank ? `<div class="ind">${I.pump(s.fuel > 0)}<span>燃油 ${s.fuel}/5</span></div>${seg(s.fuel, 5, C("amber"), 12, 26)}` : "") +
      (s.back ? ind(svg(`<path d="M20 5c6 7 12 12 12 19a12 12 0 0 1-24 0c0-7 6-12 12-19z" fill="${C("red")}"/><path d="M20 18c3 3 5 6 5 9a5 5 0 0 1-10 0c0-3 2-6 5-9z" fill="${C("amber")}"/>`), "背水一战", "glow-red") : ""),
    chuan: s => `<div class="ind"><div class="pips">${s.charge > 6 ? I.bolt(true) + `<b class="num">×${s.charge}</b>` : s.charge ? Array.from({ length: s.charge }, () => I.bolt(true)).join("") : I.bolt(false)}</div><span>电能 ${s.charge}</span></div>` +
      ind(I.magnet(s.shield), s.shield ? "磁场护盾" : "没有护盾", s.shield ? "glow-cyan" : ""),
    nora: s => ind(I.gentle(s.mood === "gentle"), "温和", "big " + (s.mood === "gentle" ? "glow-mint" : "dim")) + ind(I.cruel(s.mood === "cruel"), "残忍", "big " + (s.mood === "cruel" ? "glow-pink" : "dim")) +
      (s.lock ? ind(svg(`<rect x="10" y="18" width="20" height="15" rx="2" fill="${C("brass")}"/><path d="M14 18v-5a6 6 0 0 1 12 0v5" stroke="${C("brass")}" stroke-width="3" fill="none"/>`), "不再随机") : "") +
      ind(I.needle(), s.pierce ? "刺入" + (s.pierce > 1 ? " ×" + s.pierce : "") : "没有刺入", s.pierce ? "" : "dim"),
    // 纳米不够时自动用储备能源：够不够看「纳米 + 储备」；有储备时在纳米下面写「储备 n」
    ruby: s => `<div class="ind">${seg(Math.round(s.nano / 10), 10, s.nano + (s.reserve || 0) >= 20 ? C("cyan") : "#d9644f", 8, 26)}<span>纳米 <b class="num">${s.nano}</b>/100</span>${s.reserve > 0 ? `<span>储备 <b class="num">${s.reserve}</b></span>` : ""}</div>` +
      ind(I.wing(s.mecha), s.mecha ? `机甲模式 · 每回合 −${s.boost ? 40 : 20}` : s.nano + (s.reserve || 0) >= 20 ? "可进入机甲" : "能源不足", "big " + (s.mecha ? "glow-cyan" : "")) +
      (s.showDrone ? ind(I.drone(s.drone, s.mecha), !s.drone ? "无人机未放出" : s.mecha ? `无人机 · 激光 ×${s.boost ? 3 : 2}` : "无人机 · 每回合 +10 纳米",
        s.drone ? (s.mecha ? "glow-red" : "glow-cyan") : "dim") : ""),
    yuito: s => `<div class="ind"><div class="pips">${s.bean ? Array.from({ length: Math.min(8, s.bean) }, () => I.bean(true)).join("") : I.bean(false)}</div><span>咖啡豆 ${s.bean}</span></div>` +
      `<div class="ind"><div class="pips">${s.liquid ? Array.from({ length: Math.min(6, s.liquid) }, () => `<span class="cup">${I.cup(true)}</span>`).join("") : `<span class="cup">${I.cup(false)}</span>`}</div><span>咖啡液 ${s.liquid}</span></div>` +
      ind(I.bond(s.bond), s.bond ? "牵挂：" + esc(s.bondName) : "没有牵挂", s.bond ? "glow-pink" : ""),
    hiaki: s => {
      const col = { niu: "#e8463a", naruto: "#4b8dff" }, nm = { niu: "丹生谷", naruto: "鳴門" };
      const front = s.out === s.blade ? (s.blade === "niu" ? "naruto" : "niu") : s.blade;
      const back = s.out !== "none" ? null : (front === "niu" ? "naruto" : "niu");
      const label = { draw: "拔刀", iai: "居合", guard: "胁构" }[s.stance];
      return `<div class="ind wide">${hiakiEmblem(s.stance, col[front], back ? col[back] : null)}<span>${label} · ${nm[front]}在手${back ? "" : `（${nm[s.out]}已化人）`}</span></div>` +
        `<div class="ind"><span class="dots">${["niu", "naruto"].map(k => `<i style="background:${s.out === k ? "transparent" : col[k]};border-color:${col[k]};opacity:${k === front ? 1 : .45}"></i>`).join("")}</span><span>丹生谷 火 · 鳴門 冰</span></div>`;
    },
    tou: s => `<div class="ind${s.bare ? " dim" : ""}"><div class="pips">${[0, 1, 2].map(i => `<span class="cup ${i < s.shield ? "glow-amber" : ""}">${I.holy(i < s.shield)}</span>`).join("")}</div><span>圣盾 ${s.shield}/3</span></div>` +
      ind(I.duel(s.duel), s.duel ? "决一死战生效" : "决一死战未生效", s.duel ? "glow-red" : "") +
      `<div class="ind"><span class="num">${s.taunt}</span><span>嘲讽剩余</span></div>`,
    kolt: s => ind(I.drill(s.bit === "drill"), "电钻 · 电", "big " + (s.bit === "drill" ? "" : "dim")) + ind(I.acid(s.bit === "acid"), "酸液炮 · 酸", "big " + (s.bit === "acid" ? "" : "dim")) +
      ind(I.proud(s.full), s.full ? `满血减伤 ${s.cut}%` : s.noPassive ? "过度自信已放弃" : s.rising ? "起身中不减伤" : "未满血", s.full ? "glow-amber" : "") +
      (s.showScrap ? `<div class="ind${s.scrap > 0 ? "" : " dim"}">${I.scrap(s.scrap > 0)}<span>废料 <b class="num">${s.scrap}</b></span></div>` : ""),
    helu: s => ind(I.wave(s.focus > 0), "频谱分析", s.focus > 0 ? "" : "dim") +
      (s.need ? `<div class="ind"><span class="focus">${Array.from({ length: s.need }, (_, i) => `<i class="${i < s.focus ? "on" : ""}"></i>`).join("")}</span><span>聚焦 ${s.focus}/${s.need}</span></div>` : "") +
      ind(I.radar(s.scan), s.scan ? "已扫描" : "未扫描", s.scan ? "glow-mint" : "") +
      `<div class="ind">${I.lock(s.lock > 0)}<span>锁定 ${s.lock}</span></div>`,
    ras: s => `<div class="ind">${ring(s.pct, s.pct > 100 ? C("red") : s.pct >= 80 ? C("amber") : C("cyan"), s.pct + "%")}<span>累积能量</span></div>` +
      (s.pct > 100 || s.unstable ? ind(I.hazard(true), "不稳态 · 攻击次数 ×2", "big glow-amber") : "") +
      `<div class="ind">${I.light(s.light > 0)}<span>光能 <b class="num">${s.light}</b></span></div>`,
    longge: s => {
      const used = Math.max(0, 6 - s.ammo.length);
      const list = Array.from({ length: used }, () => ({ used: true })).concat(s.ammo);
      const shells = list.map((sh, i) => {
        const body = sh.used ? "#3a332b" : sh.seen ? (sh.c === "red" ? "#ff5a3c" : "#4b8dff") : "#6b6257";
        const base = sh.used ? "#5c4a2a" : "#c9a85a";
        return `<svg viewBox="0 0 14 34" class="shell"><rect x="1" y="1" width="12" height="23" rx="2" fill="${body}"/><path d="M3 4h8M3 7h8" stroke="#0006" stroke-width="1"/><rect x="0" y="24" width="14" height="9" rx="1" fill="${base}"/><rect x="0" y="27" width="14" height="1.6" fill="#0004"/>${sh.used ? `<path d="M13 2 1 32" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>` : ""}${i === used ? `<rect x=".6" y=".6" width="12.8" height="32.8" rx="2" fill="none" stroke="${C("brass")}" stroke-width="1.2"/>` : ""}</svg>`;
      }).join("");
      const seen = s.ammo.filter(x => x.seen).length;
      return `<div class="ind"><div class="pips shells">${shells}</div><span>剩 ${s.ammo.length} 发 · 窥探 ${seen}</span></div>` +
        ind(I.trigA(s.trigger), s.trigger ? "扳机解锁" : "扳机锁上", "big " + (s.trigger ? "glow-red" : "")) + ind(I.spit(s.spit), s.spit ? "吐酸可用" : "吐酸已用", s.spit ? "" : "dim");
    }
  };
  function gauge(st) {
    if (!st || !GAUGE[st.kit]) return "";
    try { return GAUGE[st.kit](st); } catch (e) { return ""; }
  }

  const api = { ICONS, KEYS: Object.keys(ICONS), badge, icon, unitBadges, covered, keyOf, proc, procIn, gaugeState, gauge, KITS: Object.keys(GAUGE) };
  root.HudIcons = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
