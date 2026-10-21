/* Antlerscale: Backfire · 跑团队伍卡和顶栏时钟（主持人 trpg-ui.js 和联机玩家 online-ui.js 共用一套渲染）
 *   PartyCards.heroDto(h, { gm })   房主这边：从单位拼出卡片要的数据。gm:false 时不带坚毅生命（联机发给玩家的就是这份）
 *   PartyCards.heroCardHtml(d, opt)  画一张卡：opt.gm 才画「坚毅」一行；opt.buttons 画「资料 / 武器」按钮；opt.owner / mine / focus 是联机玩家用的
 *   PartyCards.clockHtml(c)          「第 N 天 08:00 上午 · 距上次长休 X 小时」+ 力竭提示；c = { day, clock, hours }
 *   PartyCards.isNight(min)          和 ledger.js · isNightClock 一样：18:00–05:00 是夜晚 */
(function (root) {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = v => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
  const g = name => (typeof root[name] === "function" ? root[name] : null);
  const norm = m => ((Math.floor(n(m)) % 1440) + 1440) % 1440;
  const clockText = m => { m = norm(m); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const dayPeriod = m => { const h = Math.floor(norm(m) / 60); return h < 5 ? "深夜" : h < 8 ? "清晨" : h < 12 ? "上午" : h < 14 ? "中午" : h < 18 ? "下午" : h < 20 ? "傍晚" : "夜晚"; };
  const durationText = hours => { const t = Math.round(n(hours) * 60), h = Math.floor(t / 60), m = t % 60; return m ? (h ? `${h} 小时 ${m} 分` : `${m} 分钟`) : `${h} 小时`; };
  const exhaustTier = h => (h >= 80 ? 4 : h >= 60 ? 3 : h >= 40 ? 2 : h >= 20 ? 1 : 0);
  const EXHAUST = ["精神正常", "力竭（无法用坚毅生命起身）", "力竭 2（atk −3，def −1）", "力竭 3（被击倒立刻死亡）", "力竭致死"];
  const isNight = m => { m = norm(m); return m >= 18 * 60 || m < 5 * 60; };

  function clockHtml(c) {
    c = c || {};
    const ck = c.clock == null ? 480 : c.clock, hours = n(c.hours), t = exhaustTier(hours);
    return `第 <b>${esc(c.day || 1)}</b> 天 <b class="tr-time">${clockText(ck)}</b> ${dayPeriod(ck)} · 距上次长休 <b>${esc(durationText(hours))}</b>` +
      (t ? ` · <span class="warn">${esc(EXHAUST[t])}</span>` : "");
  }

  /** 房主：单位 → 卡片数据。gm:false 时没有 shp / shpMax 字段（不是 0，是根本没有） */
  function heroDto(h, opt) {
    const gm = !!(opt && opt.gm), call = (name, ...a) => { const f = g(name); try { return f ? f(...a) : undefined; } catch (e) { return undefined; } };
    const xpNext = n(call("xpToNext", h.level || 1));
    const weapons = (h.linkedKits || []).map(k => ({ kit: k, name: String(call("weaponName", k) || k), level: n((h.weaponLevels || {})[k]) || 1,
      bond: n(call("weaponBond", h, k)), dur: n(call("weaponDur", k)), max: n(call("weaponDurMax", k)) }));
    const block = call("blockChance", h);
    const atk = call("effectiveAtk", h, opt && opt.units ? opt.units : typeof state !== "undefined" ? state.units : undefined);
    const d = { id: h.id, kit: h.kit, name: h.name, level: n(h.level) || 1, dead: !!h.dead, dying: !!h.dying, upOnShp: !!h.upOnShp,
      hp: n(call("totalHpOf", h)), hpMax: n(call("totalHpMaxOf", h)), atk: atk == null ? n(h.atk) : n(atk),
      def: n(h.def), defMax: n(h.defMax != null ? h.defMax : h.def), block: block == null ? null : n(block),
      xp: n(h.xp), xpNext, attrPoints: n(h.attrPoints), featPoints: n(h.featPoints),
      feats: (h.feats || []).map(id => String(((typeof FEATS !== "undefined" ? FEATS : {})[id] || {}).name || id)), weapons };
    if (gm) { d.shp = n(h.shp); d.shpMax = n(h.shpMax); }
    return d;
  }

  function heroCardHtml(d, opt) {
    opt = opt || {};
    const tag = d.dead ? "死亡" : d.dying ? "濒死" : d.upOnShp ? "起身中" : "";
    const weapons = (d.weapons || []).map(w => `<div class="rh-w${w.dur <= 0 ? " broken" : ""}">${esc(w.name)} Lv${esc(w.level)}${w.bond ? ` · 羁绊 ${esc(w.bond)}` : ""} · 耐久 ${esc(w.dur)}/${esc(w.max)}${w.dur <= 0 ? "（损坏）" : ""}</div>`).join("");
    const btn = opt.buttons ? (opt.buttons === "online"
      ? `<button class="g-btn small rh-sheet" data-online="info" data-info="sheet" data-kit="${esc(d.kit)}" title="数值、被动和技能说明">资料</button><button class="g-btn small rh-sheet" data-online="info" data-info="armory" data-kit="${esc(d.kit)}" title="武器补正、atk 明细、改装件和客制化">武器</button>`
      : `<button class="g-btn small rh-sheet" data-sheet="${esc(d.kit)}" title="数值、被动和技能说明">资料</button><button class="g-btn small rh-sheet" data-armory="${esc(d.kit)}" title="武器补正、atk 明细、改装件和客制化">武器</button>`) : "";
    const owner = opt.owner ? `<div class="rh-owner">${esc(opt.owner)}${opt.mine ? "（你）" : ""}</div>` : "";
    const focus = opt.focusable ? `<button class="g-btn small rh-focus${opt.focus ? " on" : ""}" data-online="focusHero" data-kit="${esc(d.kit)}" aria-pressed="${opt.focus ? "true" : "false"}">${opt.focus ? "当前角色" : "切换到这名"}</button>` : "";
    return `<div class="rhero${d.dead ? " fallen" : d.dying ? " dying" : ""}${opt.mine ? " mine" : ""}${opt.focus ? " focus" : ""}" data-hero-kit="${esc(d.kit)}">
        <div class="rh-top"><b>${esc(d.name)}</b><span>Lv${esc(d.level)}${tag ? " · " + tag : ""}</span>${btn}${focus}</div>${owner}
        <div class="rh-row">血量 <span>${esc(d.hp)}/${esc(d.hpMax)}</span></div>
        <div class="rh-row">攻击力 <span>${esc(d.atk)}</span></div>
        <div class="rh-row">架势 <span>${esc(d.def)}/${esc(d.defMax)}</span></div>
        <div class="rh-row">协助格挡 <span>${d.block != null ? esc(d.block) + "%" : "—"}</span></div>
        ${opt.gm && d.shp != null ? `<div class="rh-row">坚毅 <span>${esc(d.shp)}/${esc(d.shpMax)}</span></div>` : ""}
        <div class="rh-row">经验 <span>${esc(d.xp)}/${d.xpNext ? esc(d.xpNext) : "满"}</span></div>
        ${d.attrPoints > 0 ? `<div class="rh-w tr-attn">有 ${esc(d.attrPoints)} 点属性点可分配（队伍页）</div>` : ""}
        ${d.featPoints > 0 ? `<div class="rh-w tr-attn">有 ${esc(d.featPoints)} 项专长可选（队伍页）</div>` : ""}
        ${(d.feats || []).length ? `<div class="rh-w">专长：${esc(d.feats.join("、"))}</div>` : ""}
        ${weapons}
      </div>`;
  }

  const api = { heroDto, heroCardHtml, clockHtml, isNight, clockText, dayPeriod, durationText };
  root.PartyCards = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
