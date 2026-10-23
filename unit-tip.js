/* Antlerscale: Backfire · 单位悬停说明（战斗画面和联机玩家画面共用）
 * 鼠标停在单位 / 配置物上：一段简单描述（从图鉴摘：角色介绍、敌人的行动方式和能力、配置物说明），
 * 再把身上的效果一条条用文字写出来（名字 + 图鉴里的说明），玩家不认识图标也看得懂。
 *   UnitTip.describe(info)  → { kicker, text, list, stage }   info: { kind: "hero" | "weapon" | "enemy" | "prop" | "gap", kit, propKind, gapType, ownerName, stage, text }
 *     text：间隔自己的一段说明（驻波墙写这一道墙过滤什么属性、降幅还是增幅），不给就按配置物图鉴
 *     stage：分阶段的首领 / 精英现在在第几阶段（bestiary.js · bestiaryStageOf，联机由房主算好发过来），能力只列这一阶段的
 *   UnitTip.effect(token)   → { name, text }           token：状态文字里的一个词（「灼烧×3」「高能 5」「导体」「失衡」…）
 *   UnitTip.html(info, tokens, head, opt) → 浮窗内容；opt.brief = 简短版（联机悬停用，完整的在点开的详情面板里看，online-ui.js） */
(function (root) {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const g = (name) => { try { return root[name] !== undefined ? root[name] : eval(name); } catch (e) { return undefined; } };

  // 简短版（联机悬停，作者 10/20 定）：身上的效果最多列几个名字，多的写「+N」
  const BRIEF = { effects: 8 };

  // 图鉴里没有单独条目的几种状态（文字取自规则和角色被动）
  const EXTRA = {
    "失衡": "架势归零，进入失衡：直到它的下一次行动前跳过回合，其他角色可以对它发动协助攻击。",
    "濒死": "最内层生命归零，倒地。不能靠治疗起身，可以消耗起身改用坚毅生命继续战斗。",
    "倒下": "已经倒下，退出战斗。",
    "起身": "靠坚毅生命继续战斗：之后受到的伤害打进坚毅生命，坚毅耗尽就会死亡。",
    "刺入": "诺拉的针尖留在它身上：对诺拉的部分技能有影响；和诺拉的距离超过 1 时自动结束。",
    "牵挂": "结人牵挂着它：结人对它的治疗骰取最高值；它即将被击破架势时，由结人代为承担这次击破。",
    "磁场护盾": "川川施加的护盾：被打破时，把同区域所有敌人推到另一个区域，并造成 1 击破。",
    "嘲讽": "被嘲讽：下一次攻击必须打嘲讽它的人。",
    "掩护": "有队友在掩护它：这一回合会免费为它协助格挡。",
    "决一死战": "灯的决一死战：只能攻击灯，伤害骰取最低。",
    "无法移动": "这一回合不能移动。",
    "冰冻+50%": "因冰属性击破失衡：下一次受到的攻击动作第一击伤害 +50%。",
    "晕眩标记": "首领的晕眩标记：集满就会失衡。",
    // 职责技能挂上的标记
    "保释": "环境手的保释：这一回合豁免天气与场地。",
    "恶劣环境": "环境手的恶劣环境：这一回合受到的场地与天气效果翻倍。",
    "加倍计量": "异常手的加倍计量：身上所有状态这一回合效果翻倍。",
    "黄金时间": "辅助的黄金时间：括号里那种即时效果多保留一回合。",
    "击破预告": "击破手的击破预告：受到的击破翻倍；如果没能被打进失衡，施放者自己会失衡。",
    "禁足": "坦克的禁足怒吼：这一回合不能移动，攻击也只能打括号里的坦克。",
    // 下水道狂鼠的自我效果：数值跟着规则的配置走（effects.js · frenzyEffectText），用到时才读
    "狂暴": () => { const fn = g("frenzyEffectText"); return typeof fn === "function" ? "自我效果：" + fn() : ""; }
  };
  function codexEffects() { return g("CODEX_EFFECTS") || []; }
  function lineOf(e) { return e ? (e.lines || []).join(" ").replace(/\s+/g, " ").trim() : ""; }

  /** 状态文字里的一个词 → 名字 + 说明。认不出来的只写名字 */
  function effect(token) {
    const raw = String(token || "").trim();
    if (!raw) return null;
    // 「灼烧×3」「高能 5」「自焚×2」「晕眩标记 1/2」「掩护（灯）」「聚焦护甲 火→[冰]」
    let base = raw.replace(/[（(].*$/, "").replace(/\s*[×x]\s*\d+$/, "").replace(/\s+\d+(\/\d+)?$/, "").trim();
    if (/^聚焦/.test(base)) base = "聚焦";
    const e = codexEffects().find(x => x.name === base);
    if (e) return { name: raw, text: lineOf(e) };
    if (EXTRA[base]) return { name: raw, text: typeof EXTRA[base] === "function" ? EXTRA[base]() : EXTRA[base] };
    if (base === "聚焦") return { name: raw, text: "Helumica 的聚焦：按方括号里那一步的属性攻击这一层，走完整个序列就抹掉整层血量并附加 2 击破。" };
    return { name: raw, text: "" };
  }

  /** 分阶段的敌人（bestiary.js · BESTIARY_STAGES）：当前阶段的能力 + 各阶段共有的，照原来的顺序；
   *  不分阶段、不知道在哪个阶段的照旧全列 */
  function stageAbilities(kit, all, stage) {
    const stages = (g("BESTIARY_STAGES") || {})[kit];
    const cur = Array.isArray(stages) ? stages[Number(stage) - 1] : null;
    if (!cur) return { lines: all.slice(), stage: "" };
    const owner = a => stages.findIndex(s => (s.abilities || []).some(p => a.startsWith(p)));
    return { lines: all.filter(a => { const i = owner(a); return i < 0 || stages[i] === cur; }), stage: cur.name };
  }

  const KIND_NAME = { hero: "角色", weapon: "武器人", escort: "护送对象", enemy: "敌人", prop: "配置物", gap: "间隔" };
  /** 简单描述：角色看图鉴介绍，武器人看被动，敌人看行动方式和能力，配置物 / 间隔看配置物图鉴 */
  function describe(info) {
    info = info || {};
    const out = { kicker: KIND_NAME[info.kind] || "", text: "", list: [], stage: "" };
    if (info.kind === "hero") {
      const h = (g("HERO_CODEX") || {})[info.kit];
      if (h) out.text = h.intro;
    } else if (info.kind === "escort") {
      // 护送对象（货车 / 委托人）：我方单位，玩家不能操作；被摧毁 = 护送失败
      const k = (g("ESCORT_KINDS") || {})[info.escort] || {};
      out.text = [k.note, "玩家不能操作；被摧毁 = 护送失败"].filter(Boolean).join("。") + "。";
    } else if (info.kind === "weapon") {
      const st = root.SkillText && SkillText.kitInfo ? SkillText.kitInfo(info.kit) : null;
      out.kicker = info.ownerName ? info.ownerName + "的武器人" : "武器人";
      if (st && (st.passives || []).length) out.list = st.passives.map(p => p.name + "：" + p.text);
      else if (st && st.assistBlock) out.text = "协助格挡：" + st.assistBlock;
    } else if (info.kind === "enemy") {
      const kit = info.kit === "ufo_leg" || info.kit === "ufo_body" ? "ufo_boss" : info.kit;
      const t = (g("BESTIARY_TEXT") || {})[kit] || {};
      const rank = (g("BESTIARY_RANK_NAME") || {})[(g("ENEMY_RANK") || {})[info.kit]] || "";
      out.kicker = [rank, t.faction].filter(Boolean).join(" · ") || "敌人";
      if (t.move) out.text = "行动方式：" + t.move;
      // 分阶段的首领 / 精英只列当前阶段的能力（别的阶段只提一句「还有其他阶段」，不剧透；图鉴照旧全列）
      const ab = stageAbilities(kit, t.abilities || [], info.stage);
      out.stage = ab.stage;
      // 能力只摘名字和一句话，太长的截短（完整的去图鉴看）
      out.list = ab.lines.map(a => a.length > 60 ? a.slice(0, 58) + "…" : a);
    } else if (info.kind === "prop" || info.kind === "gap") {
      const id = info.kind === "gap" ? info.gapType : info.propKind;
      const p = (g("CODEX_PROPS") || []).find(x => x.id === id);
      if (info.kind === "gap" && id === "void") { const e = codexEffects().find(x => x.name === "空隙（间隔）"); if (e) out.text = lineOf(e); }
      if (info.kind === "gap" && typeof info.text === "string" && info.text) out.text = info.text;   // 驻波墙：这一道墙自己的说明（属性、降幅 / 增幅）
      if (p) { out.kicker = [KIND_NAME[info.kind], p.place, p.source].filter(Boolean).join(" · "); out.list = p.lines.slice(); }
    }
    return out;
  }

  /** 浮窗内容。head：{ name, sub, mechs }（等级、区、阵营之类；mechs：首领机制的倒计时说明，unit-card.js · mechLines）；tokens：身上的效果词。
   *  opt.brief：简短版（联机悬停，作者 10/20 定）——名字、描述（行动方式）、首领机制的倒计时、现在的阶段、载具的乘员照写，
   *  不列能力和种族被动，效果只写名字、最多 BRIEF.effects 个（多的写「+N」）；opt.more：末尾一行提示（「点一下单位看全部说明」）。
   *  不给 opt 是完整版（本机的悬停说明、联机的详情面板） */
  function html(info, tokens, head, opt) {
    opt = opt || {};
    const d = describe(info);
    const effs = (tokens || []).map(effect).filter(Boolean);
    const seen = new Set();
    const rows = effs.filter(e => { if (seen.has(e.name)) return false; seen.add(e.name); return true; });
    const mechs = (head && Array.isArray(head.mechs) ? head.mechs : []).filter(x => typeof x === "string" && x);
    const perks = (head && Array.isArray(head.perks) ? head.perks : []).filter(x => typeof x === "string" && x);   // 种族被动（enemies.js · RACE_PERKS）
    // 载具的乘员名单（vehicle.js）：head.rowsTitle 是小标题（「乘员 n / 4」），head.rows 一行一个人
    const rows2 = (head && Array.isArray(head.rows) ? head.rows : []).filter(x => typeof x === "string" && x);
    const iconOf = (e) => {
      const k = root.HudIcons ? HudIcons.keyOf(e.name.replace(/[（(].*$/, "").replace(/\s*[×x]\s*\d+$/, "").replace(/\s+\d+(\/\d+)?$/, "").trim()) : null;
      return k ? HudIcons.icon(k) : "";
    };
    const top = `<div class="ut-top"><b>${esc(head && head.name || "")}</b>${head && head.sub ? `<span>${esc(head.sub)}</span>` : ""}</div>` +
      (d.kicker ? `<div class="ut-kicker">${esc(d.kicker)}</div>` : "") +
      // 首领机制放在描述前面：还有几回合落下最要紧
      (mechs.length ? `<div class="ut-h ut-mech-h">首领机制 · 倒计时</div><ul class="ut-mechs">${mechs.map(x => { const i = x.indexOf("："); return `<li>${i > 0 && i < 30 ? `<b>${esc(x.slice(0, i))}</b>${esc(x.slice(i))}` : esc(x)}</li>`; }).join("")}</ul>` : "");
    const perkHtml = perks.length ? `<div class="ut-h">种族被动</div><ul class="ut-list">${perks.map(x => { const i = x.indexOf("："); return `<li>${i > 0 && i < 18 ? `<b>${esc(x.slice(0, i))}</b>${esc(x.slice(i))}` : esc(x)}</li>`; }).join("")}</ul>` : "";
    const crewHtml = rows2.length ? `<div class="ut-h">${esc((head && head.rowsTitle) || "乘员")}</div><ul class="ut-list">${rows2.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    const descHtml = (d.text ? `<p class="ut-desc">${esc(d.text)}</p>` : "") +
      // 分阶段的：写出现在是哪个阶段，别的阶段只留一句，不写它们的能力
      (d.stage ? `<p class="ut-stage">当前阶段：<b>${esc(d.stage)}</b> · 还有其他阶段</p>` : "");
    if (opt.brief) {
      const shown = rows.slice(0, BRIEF.effects), rest = rows.length - shown.length;
      return top + crewHtml + descHtml +
        `<div class="ut-h">身上的效果${rows.length ? " · " + rows.length : ""}</div>` +
        (rows.length ? `<ul class="ut-chips">${shown.map(e => `<li>${iconOf(e)}<b>${esc(e.name)}</b></li>`).join("")}${rest > 0 ? `<li class="ut-chips-more">+${rest}</li>` : ""}</ul>` : `<p class="ut-none">没有效果</p>`) +
        (opt.more ? `<div class="ut-open">${esc(opt.more)}</div>` : "");
    }
    return top + perkHtml + crewHtml + descHtml +
      (d.list.length ? `<ul class="ut-list">${d.list.map(x => { const i = x.indexOf("："); return `<li>${i > 0 && i < 18 ? `<b>${esc(x.slice(0, i))}</b>${esc(x.slice(i))}` : esc(x)}</li>`; }).join("")}</ul>` : "") +
      `<div class="ut-h">身上的效果</div>` +
      (rows.length ? `<ul class="ut-effects">${rows.map(e => `<li>${iconOf(e)}<b>${esc(e.name)}</b>${e.text ? `<span>${esc(e.text)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="ut-none">没有效果</p>`);
  }

  // 浮窗本体（跟着单位卡出现，不挡鼠标）
  // 内容多（首领：行动方式 + 机制 + 一长串状态）时：先加宽排成两栏；还放不下就在浮窗里滚动——
  // 浮窗不挡鼠标，所以鼠标停在这张卡上时滚轮翻的是浮窗（底下写着「滚轮翻看」），什么都不会被截掉
  let tipEl = null, tipAnchor = null;
  function show(anchor, content) {
    if (typeof document === "undefined" || !anchor) return;
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.className = "unit-tip";
      tipEl.setAttribute("role", "tooltip");
      document.body.appendChild(tipEl);
      document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    }
    tipAnchor = anchor;
    tipEl.innerHTML = content;
    tipEl.classList.remove("ut-wide", "ut-scroll");
    tipEl.classList.add("show");
    tipEl.scrollTop = 0;
    const r = anchor.getBoundingClientRect();
    const room = window.innerHeight - 16;
    let w = Math.min(340, window.innerWidth - 16);
    tipEl.style.width = w + "px";
    if (tipEl.scrollHeight > room && window.innerWidth >= 560) {
      w = Math.min(680, window.innerWidth - 16);
      tipEl.classList.add("ut-wide");
      tipEl.style.width = w + "px";
    }
    if (tipEl.scrollHeight > tipEl.clientHeight + 1) {
      tipEl.classList.add("ut-scroll");
      tipEl.insertAdjacentHTML("beforeend", '<div class="ut-more">鼠标停在卡上，滚轮翻看其余内容</div>');
    }
    // 先放在卡片右边，放不下放左边，再不行放上面
    let left = r.right + 10, top = r.top;
    if (left + w > window.innerWidth - 8) left = r.left - w - 10;
    const h = tipEl.offsetHeight;
    if (left < 8) { left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)); top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8; }
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
    tipEl.style.left = left + "px";
    tipEl.style.top = top + "px";
  }
  function onWheel(e) {
    if (!tipEl || !tipEl.classList.contains("show") || !tipEl.classList.contains("ut-scroll") || !tipAnchor || !tipAnchor.contains(e.target)) return;
    const max = tipEl.scrollHeight - tipEl.clientHeight;
    const next = Math.max(0, Math.min(max, tipEl.scrollTop + e.deltaY * (e.deltaMode === 1 ? 16 : 1)));
    if (next === tipEl.scrollTop) return;   // 翻到头了：交还给区域 / 页面滚动
    tipEl.scrollTop = next;
    e.preventDefault(); e.stopPropagation();
  }
  function hide() { if (tipEl) tipEl.classList.remove("show"); tipAnchor = null; }

  const api = { describe, effect, html, show, hide, EXTRA, BRIEF };
  root.UnitTip = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
