/* 角鳞：四幕 · 单局界面
 *
 * 规则全在 rogue.js，数值全在 rogue-data.js，这里只负责显示和按钮。每做一步就自动存档。
 * 界面：
 *   party  选队伍（2–4 人）
 *   run    单局主界面，按 run.stage 显示：任务板 / 任务节点 / 休整 / 首领 / 幕间 / 通关 / 结局
 *   battle 战斗（game.js），打完回到 run
 * 加一种节点：rogue-data.js 的 ROGUE_NODE_TYPES 加一行，rogue.js 加规则，这里的 NODE_PANELS 加一个面板。
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const C = ROGUE_CONFIG;

  let run = null;          // 当前这一局
  let lastNotes = [];      // 上一步发生了什么（显示在记录栏）

  const save = () => { if (run && run.stage !== "over") Rogue.save(run); };

  function act(fn) {
    try {
      const notes = fn();
      lastNotes = Array.isArray(notes) ? notes : [];
    } catch (e) {
      lastNotes = [e.message];
    }
    if (run && run.stage === "over") finishRun();
    else save();
    render();
  }

  /* ---------- 选队伍 ---------- */
  const picked = [];
  function renderParty() {
    const box = $("party-grid");
    box.innerHTML = Rogue.heroPool().map(c => {
      const on = picked.indexOf(c.kit) >= 0;
      const weapons = SaveStore.weaponsOf(c.kit).map(Rogue.heroName).join("、");
      const roles = c.roles ? [c.roles.primary, c.roles.secondary].filter(Boolean).filter((r, i, a) => a.indexOf(r) === i).join(" / ") : "";
      return `<button class="hero-pick${on ? " on" : ""}" data-kit="${esc(c.kit)}" aria-pressed="${on}">
        <span class="hp-name">${esc(c.name)}<small>${esc(c.enName || "")}</small></span>
        <span class="hp-note">${esc(c.note || "")}</span>
        <span class="hp-meta">${roles ? esc(roles) + " · " : ""}武器人：${esc(weapons || "无")}</span>
      </button>`;
    }).join("");
    box.querySelectorAll(".hero-pick").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.kit;
        const i = picked.indexOf(k);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length < SaveStore.PARTY_MAX) picked.push(k);
        renderParty();
      };
    });
    const n = picked.length;
    $("party-go").disabled = !(n >= SaveStore.PARTY_MIN && n <= SaveStore.PARTY_MAX);
    $("party-count").textContent = `已选 ${n} 人（${SaveStore.PARTY_MIN}–${SaveStore.PARTY_MAX} 人）` +
      (n ? "：" + picked.map(Rogue.heroName).join("、") : "");
  }

  /* ---------- 顶栏与队伍栏 ---------- */
  function bar(cur, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return `<span class="rbar ${cls || ""}"><i style="width:${pct}%"></i></span>`;
  }
  const EXHAUST = ["", "力竭：无法用坚毅起身", "力竭 2：atk −3 def −1", "力竭 3：击倒即死", "力竭致死"];

  function renderHeader() {
    const extra = run.act > C.acts ? "（额外）" : "";
    $("run-where").textContent = `第 ${run.act} 幕${extra} · ${Rogue.region(run)}`;
    const main = run.main;
    const mainText = !main ? "" : main.done ? " · 主线已完成" : ` · 主线需 ${main.days} 天`;
    $("run-day").textContent = `第 ${run.day} 天 · 本幕剩 ${Rogue.daysLeft(run)}/${C.daysPerAct} 天${mainText}`;
    const s = Rogue.supplies();
    const hrs = Rogue.hoursAwake();
    const tier = exhaustTierFromHours(hrs);
    const foodTip = FOOD_ORDER.map(id => `${ITEM_CATALOG[id].name} ${s.food[id]}`).join(" · ");
    $("run-supplies").innerHTML =
      `<span>水 <b>${s.water}</b> ml</span><span title="${esc(foodTip)}">食物 <b>${s.foodTotal}</b></span>` +
      `<span>奎支 <b>${s.kuizhi}</b></span>` +
      `<span class="${tier ? "warn" : ""}">距上次长休 <b>${hrs}</b> 小时${tier ? " · " + EXHAUST[tier] : ""}</span>`;
    $("run-party").innerHTML = run.party.map(h => {
      const v = Rogue.heroView(run, h);
      return `<div class="rhero">
        <div class="rh-top"><b>${esc(v.name)}</b><span>Lv${v.level}${v.pending ? ' · <em>待选升级</em>' : ""}</span></div>
        <div class="rh-row">血 ${bar(v.hp, v.hpMax, "hp")}<span>${v.hp}/${v.hpMax}</span></div>
        ${v.layers.length > 1 ? `<div class="rh-w">${esc(layerText(v.layers))}</div>` : ""}
        <div class="rh-row">经验 ${bar(v.xp, v.xpNext, "xp")}<span>${v.xp}/${v.xpNext || "满"}</span></div>
        ${v.weapons.map(w => `<div class="rh-w${w.dur <= 0 ? " broken" : ""}">${esc(w.name)} Lv${w.level} · 耐久 ${w.dur}/${w.durMax}${w.dur <= 0 ? "（损坏：进战斗空手）" : ""}${w.blueprint ? ` · 图纸「${esc(w.blueprint.name)}」` : ""}${w.hp != null ? ` · 伤势 ${w.hp <= 0 ? "倒下（需长休）" : "血量 " + w.hp}` : ""}</div>`).join("")}
      </div>`;
    }).join("") + (run.fallen || []).map(f =>
      `<div class="rhero fallen"><div class="rh-top"><b>${esc(Rogue.heroName(f.kit))}</b><span>阵亡</span></div>
       <div class="rh-w">第 ${f.act} 幕第 ${f.day} 天 · ${esc(f.weapons.map(Rogue.heroName).join("、"))} 随之离队</div></div>`).join("");
  }

  /* ---------- 升级选择（手册第三章） ---------- */
  function renderLevelUps() {
    const pend = Rogue.pendingChoices(run);
    if (!pend.length) return "";
    const p = pend[0];
    const title = p.choice.type === "attr"
      ? `${p.name} ${p.choice.level} 级：分配 1 点六维属性${p.choice.noRepeat ? "（不能加在之前加过的同一项上）" : ""}`
      : `${p.name} ${p.choice.level} 级：选择一项职责技能`;
    const opts = Rogue.choiceOptions(run, p.kit, p.index);
    return `<section class="levelup">
      <h2>升级</h2>
      <p>${esc(title)}${pend.length > 1 ? `<span class="sub">还有 ${pend.length - 1} 项待选</span>` : ""}</p>
      <div class="r-choices">${opts.map((o, i) =>
        `<button class="g-btn" data-pick="${i}">${esc(o.label)}<small>${esc(o.hint || "")}</small></button>`).join("")}</div>
    </section>`;
  }

  /* ---------- 任务板 ---------- */
  function taskCard(t, which) {
    const why = Rogue.taskBlocked(run, t);
    const warn = !why && Rogue.taskWarning(run, t);
    const pay = Rogue.taskPay(run, t);
    const supplyText = [pay.water ? `${pay.water} ml 水` : "", ...Object.keys(pay.items).filter(id => pay.items[id]).map(id => `${ITEM_CATALOG[id].name}×${pay.items[id]}`)].filter(Boolean).join("、");
    return `<div class="task${t.key ? " key" : ""}">
      <div class="t-head"><b>${esc(t.name)}</b>${t.key ? '<span class="tag">主线 · 已接下</span>' : ""}<span class="days">${t.days} 天</span></div>
      <p>${esc(t.goal)}</p>
      <div class="t-meta">报酬 ${pay.kuizhi} 奎支 · 每人 ${pay.xp} 经验<br>委托方提供 ${esc(supplyText || "无")}</div>
      ${warn ? `<div class="t-warn">${esc(warn)}</div>` : ""}
      <button class="g-btn r-go${t.key ? " r-main" : ""}" data-which="${which}" ${why ? "disabled" : ""}>${why ? esc(why) : t.key ? "执行主线" : "接下任务"}</button>
    </div>`;
  }
  function renderBoard() {
    return `<h2>任务板</h2>
      <p class="r-hint">主线开幕就已接下，要在本幕天数用完之前完成，否则本局结束。本幕的天数用完时迎战首领；主线完成后剩下的日子可以继续做支线。支线只写了大致目标、时间、报酬和补给，天数够才能接。</p>
      <div class="task-list">${run.main && !run.main.done ? taskCard(run.main, "main") : ""}${(run.board || []).map((t, i) => taskCard(t, i)).join("")}</div>
      ${renderSmiths()}`;
  }

  /* ---------- 任务节点 ---------- */
  const nodeLabel = (n) => (ROGUE_NODE_TYPES[n.type] || {}).label || n.type;

  /** 武器耐久为 0 时的提醒：进战斗会空手。有维修工具包就当场给修理按钮 */
  function brokenWarn() {
    const list = Rogue.brokenWeapons(run);
    if (!list.length) return "";
    const who = list.map(w => w.owner === w.name ? w.name : `${w.owner} 的 ${w.name}`).join("、");
    const fix = bagCount("repair_kit") ? "可以先用维修工具包修一下：" : "用维修工具包（商店有卖）或长休才能修好。";
    return `<p class="r-warn">⚠ ${esc(who)} 耐久为 0，这场战斗只能空手作战。${fix}</p>${repairRows()}`;
  }
  const fightBtn = (label) => Rogue.brokenWeapons(run).length
    ? `<button class="g-btn r-main" id="r-fight">仍然${label}（有人空手）</button>`
    : `<button class="g-btn r-main" id="r-fight">${label}</button>`;

  const NODE_PANELS = {
    battle: () => `<p>前方有敌人拦路。</p>${brokenWarn()}${fightBtn("迎战")}`,
    elite: () => `<p>前方有棘手的敌人。</p>${brokenWarn()}${fightBtn("迎战")}`,
    rest: () => {
      const plan = Rogue.restPlan(run);
      const food = Object.keys(plan.food).map(id => `${ITEM_CATALOG[id].name} ${plan.food[id]} 份`).join("、");
      return `<p>找到一处能歇脚的地方。</p>
        <div class="r-choices">
          <button class="g-btn r-main" id="r-long" ${plan.ok ? "" : "disabled"}>长休 ${C.hours.longRest} 小时
            <small>${plan.ok ? `消耗 ${plan.water} ml 水、${esc(food)}` : "补给不足：" + esc(plan.lack.join("，"))} · 血量回满、耐久回满、武器人痊愈、清空力竭</small></button>
          <button class="g-btn" id="r-short">短休 ${C.hours.shortRest} 小时<small>不消耗补给 · 每人回复 等级×2+体质 · 一天两次</small></button>
        </div>`;
    },
    shop: () => `<p>路边有个摊子。手里有 ${Rogue.supplies().kuizhi} 奎支。</p>
        ${shopList()}
        ${repairRows()}
        <button class="g-btn r-main" id="r-leave">离开</button>`,
    smith: () => {
      const id = Rogue.presentSmiths(run)[0];
      return `<p>一位工匠愿意帮你改武器。手里有 ${Rogue.supplies().kuizhi} 奎支。</p>
        ${smithCard(id, true)}
        ${installRows(id)}
        ${repairRows()}
        <button class="g-btn r-main" id="r-leave">离开</button>`;
    },
    clinic: () => `<p>一家小诊所。手里有 ${Rogue.supplies().kuizhi} 奎支。</p>
        ${clinicPanel()}
        <button class="g-btn r-main" id="r-leave">离开</button>`
  };

  /* ---------- 诊所：治疗与义体改造（诊所节点与休整时共用） ---------- */
  const layerText = (ls) => ls.map(l => `${LAYER[l.type] || l.type} ${l.current != null ? l.current + "/" : ""}${l.max}`).join(" · ");
  function clinicPanel() {
    return `<div class="clinic">${run.party.map(h => {
      const v = Rogue.heroView(run, h);
      const info = Rogue.cyberInfo(run, h.kit);
      const cur = info.current;
      const heal = Rogue.healCost(run, h.kit);
      const input = (t, label) => `<label>${label}<input type="number" min="0" max="${info.limit}" step="1" value="${cur[t]}" data-cy="${esc(h.kit)}" data-t="${t}"></label>`;
      return `<div class="cl-hero">
        <div class="cl-head"><b>${esc(v.name)}</b><span>${esc(layerText(v.layers))}</span></div>
        <button class="g-btn" data-heal="${esc(h.kit)}" ${heal ? "" : "disabled"}>${heal ? `治疗（${heal} 奎支）` : "不需要治疗"}</button>
        <div class="cl-cyber">
          <div class="r-hint">义体改造：改造率 ${Math.round(info.rate * 100)}%，最多换掉 ${info.limit} 点肉体（共 ${info.fleshMax}）。
            换算 肉体 8 : 装甲 7 : 护盾 6 : 沙尘 6；也可以把剩下的肉体按 8 : 7 全部换成星灵。最多 3 种血量。</div>
          <div class="cl-inputs">${input("armor", "→ 装甲")}${input("shield", "→ 护盾")}${input("sand", "→ 沙尘")}
            <label class="cl-spirit"><input type="checkbox" data-cy="${esc(h.kit)}" data-t="spirit" ${cur.spirit ? "checked" : ""}> 内层换成星灵</label></div>
          <div class="cl-preview" id="cy-pv-${esc(h.kit)}"></div>
          <button class="g-btn" data-cyber="${esc(h.kit)}">改造</button>
        </div>
      </div>`;
    }).join("")}</div>`;
  }
  function readPlan(kit) {
    const plan = {};
    document.querySelectorAll(`[data-cy="${kit}"]`).forEach(el => {
      plan[el.dataset.t] = el.type === "checkbox" ? el.checked : Math.max(0, Math.floor(Number(el.value) || 0));
    });
    return plan;
  }
  function showCyberPreview(kit) {
    const box = document.getElementById("cy-pv-" + kit);
    if (!box) return;
    const pv = Rogue.cyberPreview(run, kit, readPlan(kit));
    const btn = document.querySelector(`[data-cyber="${kit}"]`);
    if (pv.error) {
      box.innerHTML = `<span class="bad">${esc(pv.error)}</span>`;
      if (btn) btn.disabled = true;
      return;
    }
    const money = Rogue.supplies().kuizhi;
    box.innerHTML = `改造后（外 → 内）：${esc(layerText(pv.layers))} · 费用 <b>${pv.cost}</b> 奎支` +
      (pv.cost && money < pv.cost ? ' <span class="bad">奎支不够</span>' : "");
    if (btn) btn.disabled = !pv.cost || money < pv.cost;
  }
  /** 商店货架（商店节点与休整时共用） */
  function shopList() {
    const s = Rogue.supplies();
    return `<div class="shop">${ROGUE_SHOP.map(r => {
      const item = r.give.item && ITEM_CATALOG[r.give.item];
      const have = r.give.item ? bagCount(r.give.item) : null;
      return `<div class="shop-row"><span class="s-name">${esc(Rogue.shopItemName(r))}<small>${esc(item ? item.hint || "" : "")}</small></span>
        <span class="s-have">${have != null ? "有 " + have : ""}</span>
        <span class="s-price">${r.price}</span>
        <button class="g-btn" data-buy="${esc(r.key)}" ${s.kuizhi < r.price ? "disabled" : ""}>买</button></div>`;
    }).join("")}</div>`;
  }
  /* ---------- 工匠：升级、图纸（任务板上随机来几位，任务里也可能遇到一位） ---------- */
  function smithCard(id, open) {
    const info = Rogue.smithInfo(run, id);
    if (!info) return "";
    const k = Rogue.supplies().kuizhi;
    const progress = info.claimed
      ? `已领图纸「${esc(Rogue.blueprintById(info.claimed).name)}」`
      : info.canClaim ? "可以领一张图纸" : `在他这里升级 ${info.uses}/${info.need} 次可领图纸`;
    const rows = info.needsIntro
      ? `<p class="r-hint">他不帮陌生人强化武器。</p><button class="g-btn" data-intro="${esc(id)}">给他看看你的武器</button>`
      : Rogue.smithOptions(run, id).map(o =>
      `<div class="shop-row"><span class="s-name">${esc(o.name)}<small>现在 ${o.level} 级${o.hours ? ` · 要帮忙 ${o.hours} 小时` : ""}</small></span>
        <span class="s-have"></span>
        <span class="s-price">${o.max ? "满级" : o.cost}</span>
        <button class="g-btn" data-upgrade="${esc(o.kit)}" data-smith="${esc(id)}" ${o.max || k < o.cost ? "disabled" : ""}>升到 ${o.level + 1} 级</button></div>`).join("");
    const claim = info.canClaim ? `<p class="r-hint">${esc(info.name)} 愿意把自己的客制化图纸给你一张（只能挑一张）：</p>
      <div class="r-choices">${info.blueprints.map(b =>
        `<button class="g-btn" data-claim="${esc(b.id)}" data-smith="${esc(id)}">${esc(b.name)}<small>${esc(b.text)}</small></button>`).join("")}</div>` : "";
    return `<details class="smith"${open || info.canClaim ? " open" : ""}>
      <summary><b>${esc(info.name)}</b><span class="sm-prog${info.canClaim ? " ready" : ""}">${progress}</span></summary>
      <p class="sm-lore">${esc(info.blurb)}${info.priceNote ? `<br><span class="sm-price">${esc(info.priceNote)}</span>` : ""}</p>
      ${claim}
      <div class="shop">${rows}</div>
    </details>`;
  }
  /** 手里的图纸装到武器上（任何一位工匠都能装） */
  function installRows(smithId) {
    const bps = run.blueprints || [];
    if (!bps.length || !smithId) return "";
    if (!Rogue.smithInfo(run, smithId).canInstall) return `<p class="r-hint">手里有图纸，但 ${esc(Rogue.smithInfo(run, smithId).name)} 装不了，去找别的武器工匠。</p>`;
    const cost = ROGUE_SMITH_RULES.installCost;
    const k = Rogue.supplies().kuizhi;
    const weapons = run.party.flatMap(h => Rogue.heroView(run, h).weapons);
    return `<p class="r-hint">手里的图纸：装一张 ${cost} 奎支，一把武器只能装一张（装新的会替换旧的）。</p>
      ${bps.map(id => {
        const b = Rogue.blueprintById(id);
        return `<div class="bp-row"><span class="s-name">${esc(b.name)}<small>${esc(b.text)} · 来自 ${esc(b.smithName)}</small></span>
          <div class="r-choices">${weapons.map(w =>
            `<button class="g-btn" data-install="${esc(id)}" data-kit="${esc(w.kit)}" data-smith="${esc(smithId)}" ${k < cost ? "disabled" : ""}>装到 ${esc(w.name)}${w.blueprint ? `<small>替换「${esc(w.blueprint.name)}」</small>` : ""}</button>`).join("")}</div></div>`;
      }).join("")}`;
  }
  function renderSmiths() {
    const ids = run.smiths || [];
    if (!ids.length) return "";
    return `<h2>工匠</h2>
      <p class="r-hint">这次回城遇到 ${ids.length} 位工匠。手里有 ${Rogue.supplies().kuizhi} 奎支。在同一位工匠那里升级满 ${ROGUE_SMITH_RULES.blueprintAfter} 次，他会给你一张客制化图纸。</p>
      ${ids.map(id => smithCard(id, false)).join("")}
      ${installRows(ids.find(id => Rogue.smithInfo(run, id).canInstall) || ids[0])}`;
  }

  /** 维修工具包（手册：修复 10 点耐久），有的话在商店、工匠处、休整时都能用 */
  function repairRows() {
    const kits = bagCount("repair_kit");
    if (!kits) return "";
    const rows = run.party.map(h => Rogue.heroView(run, h)).flatMap(v => v.weapons)
      .filter(w => w.dur < w.durMax)
      .map(w => `<button class="g-btn" data-repair="${esc(w.kit)}">修 ${esc(w.name)}（${w.dur}/${w.durMax}）</button>`);
    return rows.length ? `<p class="r-hint">维修工具包 ×${kits}，每个修复 10 点耐久：</p><div class="r-choices">${rows.join("")}</div>` : "";
  }

  function renderTask() {
    const t = run.task;
    const node = Rogue.currentNode(run);
    const track = t.nodes.map((n, i) => {
      const cls = i < t.index ? "done" : i === t.index ? "now" : "later";
      return `<li class="${cls}"><span>${i + 1}</span>${esc(nodeLabel(n))}</li>`;
    }).join("");
    const panel = node && NODE_PANELS[node.type] ? NODE_PANELS[node.type]() : "";
    return `<h2>${esc(t.key ? "主线" : t.name)}<span class="sub">${esc(t.goal)}</span></h2>
      <ol class="track">${track}</ol>
      <div class="r-panel">${panel}</div>`;
  }

  function renderStage() {
    switch (run.stage) {
      case "board": return renderBoard();
      case "task": return renderTask();
      case "camp": {
        const plan = Rogue.restPlan(run);
        const shopping = C.campShop ? `<p class="r-hint">回到城里，出发前可以补货。手里有 ${Rogue.supplies().kuizhi} 奎支。</p>${shopList()}${repairRows()}` : "";
        const clinic = C.campClinic ? `<h3 class="r-sub">诊所</h3>${clinicPanel()}` : "";
        return `<h2>休整</h2>
          <p class="r-hint">任务之间休整一次，算 ${C.restDays} 天。${plan.ok
            ? `长休需要 ${plan.water} ml 水和食物，血量、武器耐久回满，清空力竭。`
            : "补给不足（" + esc(plan.lack.join("，")) + "），只能硬撑着过夜：不回血，力竭继续累积。"}</p>
          ${shopping}
          ${clinic}
          <button class="g-btn r-main" id="r-camp">休整</button>`;
      }
      case "boss":
        return `<h2>第 ${run.act} 幕 · 首领</h2>
          <p class="r-hint">首领战不能撤退；输了，本局就此结束。</p>
          ${brokenWarn()}${fightBtn("迎战首领")}`;
      case "interlude":
        return `<h2>第 ${run.act} 幕 · 落幕</h2>
          <p class="r-hint">幕间选择会在之后的版本加入。</p>
          <button class="g-btn r-main" id="r-next">前往第 ${run.act + 1} 幕</button>`;
      case "victory":
        return `<h2 class="win">四幕通关</h2>
          <p class="r-hint">可以就此收手，也可以继续挑战额外的 ${C.extraActs} 幕：敌人会强到 ${C.extraActLevels.map(r => r[1]).join("、")} 级。</p>
          <div class="r-choices">
            <button class="g-btn r-main" id="r-win">就此收手</button>
            <button class="g-btn" id="r-more">继续挑战额外幕</button>
          </div>`;
      case "over": {
        const r = run.result || {};
        return `<h2 class="${r.win ? "win" : "lose"}">${r.win ? "通关" : "本局结束"}</h2>
          <p class="r-hint">${esc(r.text || "")} 第 ${r.act} 幕 · 第 ${r.day} 天。</p>
          <button class="g-btn r-main" id="r-home">回到标题</button>`;
      }
    }
    return "";
  }

  function render() {
    if (!run) return;
    renderHeader();
    const lv = run.stage === "over" ? "" : renderLevelUps();
    // 有待选的升级时先选完，再继续流程
    $("run-body").innerHTML = lv || renderStage();
    const recent = lastNotes.length ? lastNotes : (run.log || []).slice(-6).map(l => l.text);
    $("run-log").innerHTML = recent.map(t => `<li>${esc(t)}</li>`).join("");
    bind();
  }

  function fight() {
    const spec = Rogue.battleSpec(run);
    if (!spec) return;
    save();   // 战斗打到一半退出，下次从这场战斗开头重来
    Screens.show("battle");
    GAME.startRogueBattle(spec, (outcome) => {
      act(() => Rogue.finishBattle(run, outcome));
      Screens.show("run");
    });
  }

  function finishRun() {
    if (!run || run._counted) return;
    run._counted = true;
    const meta = SaveStore.loadMeta();
    meta.stats.runs += 1;
    if (run.result && run.result.win) meta.stats.wins += 1;
    meta.stats.deaths += (run.fallen || []).length;
    SaveStore.saveMeta(meta);
    SaveStore.clearRun();
  }

  function bind() {
    const body = $("run-body");
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    body.querySelectorAll("[data-pick]").forEach(b => {
      b.onclick = () => {
        const p = Rogue.pendingChoices(run)[0];
        const o = Rogue.choiceOptions(run, p.kit, p.index)[Number(b.dataset.pick)];
        act(() => Rogue.choose(run, p.kit, p.index, o.value));
      };
    });
    body.querySelectorAll(".r-go").forEach(b => {
      b.onclick = () => {
        const w = b.dataset.which === "main" ? "main" : Number(b.dataset.which);
        act(() => Rogue.acceptTask(run, w));
      };
    });
    body.querySelectorAll("[data-buy]").forEach(b => { b.onclick = () => act(() => Rogue.buy(run, b.dataset.buy, 1)); });
    body.querySelectorAll("[data-upgrade]").forEach(b => { b.onclick = () => act(() => Rogue.upgradeWeapon(run, b.dataset.upgrade, b.dataset.smith)); });
    body.querySelectorAll("[data-intro]").forEach(b => { b.onclick = () => act(() => Rogue.introduceSmith(run, b.dataset.intro)); });
    body.querySelectorAll("[data-claim]").forEach(b => { b.onclick = () => act(() => Rogue.claimBlueprint(run, b.dataset.smith, b.dataset.claim)); });
    body.querySelectorAll("[data-install]").forEach(b => { b.onclick = () => act(() => Rogue.installBlueprint(run, b.dataset.install, b.dataset.kit, b.dataset.smith)); });
    body.querySelectorAll("[data-repair]").forEach(b => { b.onclick = () => act(() => Rogue.repairWeapon(run, b.dataset.repair)); });
    body.querySelectorAll("[data-heal]").forEach(b => { b.onclick = () => act(() => Rogue.healHero(run, b.dataset.heal)); });
    body.querySelectorAll("[data-cyber]").forEach(b => {
      const kit = b.dataset.cyber;
      b.onclick = () => act(() => Rogue.modifyHero(run, kit, readPlan(kit)));
      showCyberPreview(kit);
    });
    body.querySelectorAll("[data-cy]").forEach(el => { el.oninput = () => showCyberPreview(el.dataset.cy); });
    on("r-fight", fight);
    on("r-long", () => act(() => Rogue.restAtNode(run, "long")));
    on("r-short", () => act(() => Rogue.restAtNode(run, "short")));
    on("r-leave", () => act(() => Rogue.leaveNode(run)));
    on("r-camp", () => act(() => Rogue.camp(run)));
    on("r-next", () => act(() => Rogue.nextAct(run)));
    on("r-win", () => act(() => Rogue.afterVictory(run, false)));
    on("r-more", () => act(() => Rogue.afterVictory(run, true)));
    on("r-home", () => { Rogue.leaveRunMode(null); run = null; Screens.show("title"); });
  }

  /* ---------- 入口 ---------- */
  window.RunFlow = {
    ready: true,
    start() {
      picked.length = 0;
      Screens.show("party");
    },
    resume() {
      const saved = SaveStore.loadRun();
      if (!saved) return;
      run = saved;
      lastNotes = ["继续上次的进度。"];
      Rogue.enterRunMode(run);
      Screens.show("run");
    }
  };

  function boot() {
    Screens.register("party", $("scr-party"), { onShow: renderParty });
    Screens.register("run", $("scr-run"), { onShow: render });
    $("party-back").onclick = () => Screens.show("title");
    $("party-go").onclick = () => {
      if (SaveStore.loadRun() && !confirm("已有一局在进行中。开新的一局会覆盖它，确定吗？")) return;
      try {
        run = Rogue.newRun({ party: picked.slice() });
      } catch (e) {
        $("party-count").textContent = e.message;
        return;
      }
      lastNotes = [`出发。种子 ${run.seed}。`];
      save();
      Screens.show("run");
    };
    $("run-title").onclick = () => {
      if (run) { save(); Rogue.leaveRunMode(run); }
      run = null;
      Screens.show("title");
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
