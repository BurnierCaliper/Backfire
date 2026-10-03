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
  let lastError = "";      // 上一步为什么没做成（显示在主面板顶上，免得按了像没反应）

  const save = () => { if (run && run.stage !== "over") Rogue.save(run); };

  function act(fn) {
    lastError = "";
    try {
      const notes = fn();
      lastNotes = Array.isArray(notes) ? notes : [];
    } catch (e) {
      lastNotes = [e.message];
      lastError = e.message;
    }
    if (run && run.stage === "over") finishRun();
    else save();
    render();
  }

  /* ---------- 选队伍 ---------- */
  const picked = [];
  // 单人模式：一名主角、三名伙伴、一个第二副职责
  const solo = { on: false, hero: null, partners: [], role2: null };
  const PARTY_TIP = "挑 2–4 名角色出发。每人都带着自己的专属武器人；角色永久死亡时，武器人也会一起离开。";
  const SOLO_TIP = `先点一名角色当主角，再挑 ${ROGUE_SOLO.partners} 名伙伴（战斗里用「支援」叫他们登场打协助攻击），最后选一个第二副职责。` +
    `单人模式：每回合 ${ROGUE_SOLO.apPerRound} 行动点，能给自己协助格挡、接自己打出的失衡；每场胜利额外 +${ROGUE_SOLO.battleXp} 经验，` +
    `每 ${ROGUE_SOLO.attrEvery} 级多一次六维属性，每 ${ROGUE_SOLO.role2Every} 级从第二副职责里多学一个技能。`;
  function renderParty() {
    $("party-title").textContent = solo.on ? "单人模式 · 选择主角与伙伴" : "选择队伍";
    $("party-tip").textContent = solo.on ? SOLO_TIP : PARTY_TIP;
    const box = $("party-grid");
    box.innerHTML = Rogue.heroPool().map(c => {
      const isHero = solo.on && solo.hero === c.kit;
      const isMate = solo.on && solo.partners.indexOf(c.kit) >= 0;
      const on = solo.on ? (isHero || isMate) : picked.indexOf(c.kit) >= 0;
      const weapons = SaveStore.weaponsOf(c.kit).map(Rogue.heroName).join("、");
      const roles = c.roles ? [c.roles.primary, c.roles.secondary].filter(Boolean).filter((r, i, a) => a.indexOf(r) === i).join(" / ") : "";
      const tag = isHero ? '<em class="hp-tag hero">主角</em>' : isMate ? '<em class="hp-tag mate">伙伴</em>' : "";
      return `<button class="hero-pick${on ? " on" : ""}${isMate ? " mate" : ""}" data-kit="${esc(c.kit)}" aria-pressed="${on}">
        <span class="hp-name">${esc(c.name)}<small>${esc(c.enName || "")}</small>${tag}</span>
        <span class="hp-note">${esc(c.note || "")}</span>
        <span class="hp-meta">${roles ? esc(roles) + " · " : ""}武器人：${esc(weapons || "无")}</span>
      </button>`;
    }).join("");
    box.querySelectorAll(".hero-pick").forEach(b => {
      b.onclick = () => {
        const k = b.dataset.kit;
        if (solo.on) {
          if (solo.hero === k) { solo.hero = null; solo.role2 = null; }
          else if (solo.partners.indexOf(k) >= 0) solo.partners.splice(solo.partners.indexOf(k), 1);
          else if (!solo.hero) { solo.hero = k; solo.role2 = null; }
          else if (solo.partners.length < ROGUE_SOLO.partners) solo.partners.push(k);
        } else {
          const i = picked.indexOf(k);
          if (i >= 0) picked.splice(i, 1);
          else if (picked.length < SaveStore.PARTY_MAX) picked.push(k);
        }
        renderParty();
      };
    });
    const roleBox = $("party-solo");
    roleBox.hidden = !solo.on;
    if (solo.on) {
      const opts = solo.hero ? Rogue.role2Options(solo.hero) : [];
      roleBox.innerHTML = `<h3>第二副职责</h3>` + (solo.hero
        ? `<div class="r-choices">${opts.map(r => {
            const defs = [1, 2, 3].map(n => (roleSkillDef(r, n) || {}).name).filter(Boolean).join(" / ");
            return `<button class="g-btn${solo.role2 === r ? " r-main" : ""}" data-role2="${esc(r)}">${esc(r)}<small>${esc(defs)}</small></button>`;
          }).join("")}</div>`
        : `<p class="r-hint">先选主角（只能选角色卡上没有的职责）。</p>`);
      roleBox.querySelectorAll("[data-role2]").forEach(b => { b.onclick = () => { solo.role2 = b.dataset.role2; renderParty(); }; });
      const ok = solo.hero && solo.partners.length === ROGUE_SOLO.partners && solo.role2;
      $("party-go").disabled = !ok;
      $("party-count").textContent = !solo.hero ? "先选主角"
        : `主角 ${Rogue.heroName(solo.hero)} · 伙伴 ${solo.partners.length}/${ROGUE_SOLO.partners}` +
          (solo.partners.length ? "：" + solo.partners.map(Rogue.heroName).join("、") : "") +
          ` · 第二副职责 ${solo.role2 || "未选"}`;
      return;
    }
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
        ${v.race ? `<div class="rh-w rh-prof">${esc(v.race)} · ${esc(v.job)} · ${esc(Object.keys(v.profs).map(k => k + v.profs[k]).join(" "))}</div>` : ""}
        ${v.role2 ? `<div class="rh-w rh-solo">第二副职责 ${esc(v.role2)}${v.role2Skills.length ? "：" + esc(v.role2Skills.join("、")) : "（还没学技能）"}</div>` : ""}
        ${v.pendingBreak ? `<div class="rh-w broken">检定受伤：下一场开战时受到 ${v.pendingBreak} 击破</div>` : ""}
        <div class="rh-row">血 ${bar(v.hp, v.hpMax, "hp")}<span>${v.hp}/${v.hpMax}</span></div>
        ${v.layers.length > 1 ? `<div class="rh-w">${esc(layerText(v.layers))}</div>` : ""}
        <div class="rh-row">经验 ${bar(v.xp, v.xpNext, "xp")}<span>${v.xp}/${v.xpNext || "满"}</span></div>
        ${v.weapons.map(w => `<div class="rh-w${w.dur <= 0 ? " broken" : ""}">${esc(w.name)} Lv${w.level} · 耐久 ${w.dur}/${w.durMax}${w.dur <= 0 ? "（损坏：进战斗空手）" : ""}${w.blueprint ? ` · 图纸「${esc(w.blueprint.name)}」` : ""}${w.hp != null ? ` · 伤势 ${w.hp <= 0 ? "倒下（需长休）" : "血量 " + w.hp}` : ""}</div>`).join("")}
      </div>`;
    }).join("") + (run.solo ? `<div class="rhero solo-mates"><div class="rh-top"><b>伙伴</b><span>支援存量 ${Number(run.supportBank) || 0} 次</span></div>
        <div class="rh-w rh-solo">${esc((run.partners || []).map(Rogue.heroName).join("、"))} · 战斗里攒分换支援：门槛 ${ROGUE_SOLO.supportScore} 分，手里每有 1 次 +${ROGUE_SOLO.supportStep}，最多存 ${ROGUE_SOLO.supportMax} 次；每人一场一次</div></div>` : "")
      + (run.fallen || []).map(f =>
      `<div class="rhero fallen"><div class="rh-top"><b>${esc(Rogue.heroName(f.kit))}</b><span>阵亡</span></div>
       <div class="rh-w">第 ${f.act} 幕第 ${f.day} 天 · ${esc(f.weapons.map(Rogue.heroName).join("、"))} 随之离队</div></div>`).join("");
  }

  /* ---------- 升级选择（手册第三章） ---------- */
  function renderLevelUps() {
    const pend = Rogue.pendingChoices(run);
    if (!pend.length) return "";
    const p = pend[0];
    const title = p.choice.type === "attr"
      ? `${p.name} ${p.choice.level} 级${p.choice.solo ? "（单人模式额外）" : ""}：分配 1 点六维属性${p.choice.noRepeat ? "（不能加在之前加过的同一项上）" : ""}`
      : p.choice.type === "role2"
        ? `${p.name} ${p.choice.level} 级（单人模式）：从第二副职责里再学一个技能`
      : p.choice.type === "prof"
        ? `${p.name} ${p.choice.level} 级：一个自选熟练项（新学一项，或把已有的一项升一级，最高三级）`
        : `${p.name} ${p.choice.level} 级：选择一项职责技能`;
    const opts = Rogue.choiceOptions(run, p.kit, p.index);
    return `<section class="levelup">
      <h2>升级</h2>
      <p>${esc(title)}${pend.length > 1 ? `<span class="sub">还有 ${pend.length - 1} 项待选</span>` : ""}</p>
      <div class="r-choices">${opts.map((o, i) =>
        `<button class="g-btn" data-pick="${i}">${esc(o.label)}<small>${esc(o.hint || "")}</small></button>`).join("")}</div>
    </section>`;
  }

  const WX_NAME = { none: "常态", heat: "酷暑", snow: "雪天", acid: "酸雨", thunder: "雷鸣", glow: "微光", sand: "沙暴", phase: "相位" };

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
      ${t.weather ? `<div class="t-weather">全程天气：${esc(WX_NAME[t.weather] || t.weather)}（任务里每一场战斗都是）</div>` : ""}
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
      if (run.ambush) {
        return `<p class="r-warn">⚠ 长休时被偷袭了！还没来得及恢复，敌人就摸了上来。</p>
          <p class="r-hint">遭遇战：敌人 3 枚代币、来自各地；我方跳过第一回合；这场分数 ×2（和速杀、无伤加算）；
            胜利后每人额外 ${C.ambush.xpPerLevel} × 敌人等级 经验，然后照常长休。撤退则这次不休息、直接离开。</p>
          ${brokenWarn()}${fightBtn("迎击")}`;
      }
      const plan = Rogue.restPlan(run);
      const food = Object.keys(plan.food).map(id => `${ITEM_CATALOG[id].name} ${plan.food[id]} 份`).join("、");
      const chance = Math.round(Rogue.ambushChance(run) * 100);
      const watchOpts = Rogue.watchOptions(run).map(w =>
        `<option value="${esc(w.kit)}">${esc(w.weapon ? `${w.name}（${w.owner} 的武器人）` : w.name)}</option>`).join("");
      return `<p>找到一处能歇脚的地方。</p>
        <p class="r-hint">长休时有 <b id="r-ambush-chance">${chance}%</b> 的概率被偷袭（遭遇战）。没被偷袭，下次 +${Math.round(C.ambush.step * 100)}%；被偷袭后回到 ${Math.round(C.ambush.base * 100)}%。
          安排一人守夜就一定不会被偷袭，但守夜的人这次长休不恢复，短休次数和「长休一次」的技能也不刷新。</p>
        <label class="r-watch">守夜：<select id="r-watch"><option value="">不安排守夜</option>${watchOpts}</select></label>
        <div class="r-choices">
          <button class="g-btn r-main" id="r-long" ${plan.ok ? "" : "disabled"}>长休 ${C.hours.longRest} 小时
            <small>${plan.ok ? `消耗 ${plan.water} ml 水、${esc(food)}` : "补给不足：" + esc(plan.lack.join("，"))} · 血量回满、耐久回满、武器人痊愈、清空力竭</small></button>
          <button class="g-btn" id="r-short">短休 ${C.hours.shortRest} 小时<small>不消耗补给 · 每人回复 等级×2+体质 · 一天两次</small></button>
          <button class="g-btn" id="r-rest-skip">不休息，直接离开<small>获得 ${C.restSkipKuizhi} 奎支 · 不花时间</small></button>
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
        <button class="g-btn r-main" id="r-leave">离开</button>`,
    check: () => checkPanel()
  };

  /* ---------- 熟练项检定（事件内容占位） ---------- */
  const LV_TEXT = ["没有熟练", "一级熟练", "二级熟练", "三级熟练"];
  const pctText = (p) => `${Math.round(p * 1000) / 10}%`;
  function checkPanel() {
    const c = Rogue.checkInfo(run);
    if (!c) return "";
    const odds = run.party.map(h => Rogue.checkOdds(run, h.kit));
    const best = odds.reduce((b, o) => (!b || o.chance > b.chance ? o : b), null);
    const hurt = c.injure
      ? `<p class="r-warn">⚠ 有风险：失败时检定者受到 ${c.dmg[0]}–${c.dmg[1]} 点随机属性伤害（按克制表结算，不致死），下一场战斗开始时再受 ${c.brk} 击破。</p>`
      : `<p class="r-hint">失败没有损失。</p>`;
    const rows = odds.map(o => {
      const tags = [o.adv ? "优势" : "", o.dis ? "劣势" : "", o.reroll ? "可重掷" : ""].filter(Boolean).join(" · ");
      const can = o.chance > 0;
      return `<button class="g-btn${best && o.kit === best.kit && can ? " r-main" : ""}" data-check="${esc(o.kit)}" ${can ? "" : "disabled"}>
        ${esc(o.name)} · ${LV_TEXT[o.level]}
        <small>${can ? `成功率 ${pctText(o.chance)}` : "没有资格尝试"}${tags ? " · " + esc(tags) : ""} · 血 ${o.hp}/${o.hpMax}</small></button>`;
    }).join("");
    return `<p>【事件占位】前方需要一次<b>${esc(c.diffName)}</b>的「${esc(c.prof)}」检定。</p>
      <p class="r-hint">成功奖励 ${c.reward} 奎支${c.injure ? `（含风险加成 ${ROGUE_CHECKS.injure.bonus}）` : ""}。简单检定谁都能试；普通及以上没有这项熟练就不能尝试（手册第一章）。选一个人去做：</p>
      ${hurt}
      <div class="r-choices">${rows}</div>
      <div class="r-choices r-check-skip">
        <button class="g-btn" id="r-check-skip">不冒险，绕过去<small>没有奖励 · 花 ${ROGUE_NODE_TYPES.check.hours} 小时</small></button>
      </div>`;
  }

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
    const short = k < cost ? `<b class="bad">现在手里 ${k}，还差 ${cost - k} 奎支。</b>` : "";
    return `<p class="r-hint">手里的图纸：装一张 ${cost} 奎支，一把武器只能装一张（装新的会替换旧的）。${short}</p>
      ${bps.map(id => {
        const b = Rogue.blueprintById(id);
        return `<div class="bp-row"><span class="s-name">${esc(b.name)}<small>${esc(b.text)} · 来自 ${esc(b.smithName)}</small></span>
          <div class="r-choices">${weapons.map(w =>
            `<button class="g-btn" data-install="${esc(id)}" data-kit="${esc(w.kit)}" data-smith="${esc(smithId)}">装到 ${esc(w.name)}${w.blueprint ? `<small>替换「${esc(w.blueprint.name)}」</small>` : ""}</button>`).join("")}</div></div>`;
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

  /** 进下一站 / 首领战之前：可以短休（按今天的短休次数）。长休只能在任务的休息点 */
  function restBeforeRow() {
    const sh = Rogue.canShortRestBefore(run);
    const left = (sh.who || []).map(x => `${x.name} ${x.left}`).join("、");
    const shortBtn = `<button class="g-btn" id="r-short-before" ${sh.ok ? "" : "disabled"}>短休 ${C.hours.shortRest} 小时
        <small>${sh.ok ? `不消耗补给 · 每人回复 等级×2+体质 · 今天还能短休：${esc(left)}` : esc(sh.why || "")}</small></button>`;
    return `<div class="rest-before">${shortBtn}</div>`;
  }

  /** 路线图：旧存档里进行中的任务没有 cols，按单线画 */
  function routeMapHtml(t) {
    if (typeof RouteMap === "undefined") return "";
    const cols = t.cols || t.nodes.map(n => [n ? n.type : "battle"]);
    const pick = t.pick || cols.map(() => 0);
    const labels = {};
    Object.keys(ROGUE_NODE_TYPES).forEach(k => { labels[k] = ROGUE_NODE_TYPES[k].label; });
    return RouteMap.html({
      region: Rogue.region(run), title: `${t.key ? "主线" : t.name}路线图`,
      cols, nodes: t.nodes, pick, index: t.index, labels,
      choices: Rogue.nodeChoices(run).map(o => o.i), links: Rogue.routeLinks,
      seed: `${run.seed}:map:${run.taskNo}`
    });
  }
  function renderTask() {
    const t = run.task;
    const node = Rogue.currentNode(run);
    const choices = Rogue.nodeChoices(run);
    const choose = !node && choices.length
      ? `<div class="rm-choose"><b>选择下一站：</b>点地图上发光的节点，或者${choices.map(o =>
          `<button class="g-btn" data-route="${o.i}">${esc(nodeLabel({ type: o.type }))}</button>`).join("")}</div>`
      : "";
    const panel = node && NODE_PANELS[node.type] ? NODE_PANELS[node.type]() : "";
    const restRow = node && node.type !== "rest" ? restBeforeRow() : "";
    const wx = t.weather ? `<span class="t-weather inline">全程天气：${esc(WX_NAME[t.weather] || t.weather)}</span>` : "";
    return `<h2>${esc(t.key ? "主线" : t.name)}<span class="sub">${esc(t.goal)}</span>${wx}</h2>
      ${routeMapHtml(t)}
      <div class="r-panel">${choose}${restRow}${panel}</div>`;
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
          ${restBeforeRow()}${brokenWarn()}${fightBtn("迎战首领")}`;
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
    const err = lastError ? `<p class="r-warn r-error">没做成：${esc(lastError)}</p>` : "";
    $("run-body").innerHTML = err + (lv || renderStage());
    const recent = lastNotes.length ? lastNotes : (run.log || []).slice(-6).map(l => l.text);
    $("run-log").innerHTML = recent.map(t => `<li>${esc(t)}</li>`).join("");
    bind();
    // 路线图比屏幕宽时（手机）：滚到当前这一列
    const sc = document.querySelector("#run-body .rm-scroll");
    if (sc && run.task && sc.scrollWidth > sc.clientWidth) {
      const n = (run.task.cols || run.task.nodes).length;
      const ratio = n > 1 ? run.task.index / (n - 1) : 0;
      sc.scrollLeft = Math.max(0, ratio * sc.scrollWidth - sc.clientWidth / 2);
    }
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

  /** 熟练项检定：先结算，再按掷出的 d100 播和协助格挡一样的检定动画，最后刷新界面 */
  let checking = false;
  async function doCheck(kit) {
    if (checking) return;
    let notes;
    try { notes = Rogue.attemptCheck(run, kit); } catch (e) { act(() => { throw e; }); return; }
    const lc = run.lastCheck;
    run.lastCheck = null;
    if (lc && window.GAME && typeof GAME.playCheck === "function") {
      checking = true;
      try {
        for (const r of lc.rolls) {
          if (r.roll == null) continue;   // 必定成功：不用掷
          const line = Math.round(lc.line * 10) / 10;
          await GAME.playCheck({
            who: `${lc.name} · ${lc.diffName}「${lc.prof}」检定${r.label ? " · " + r.label : ""}`,
            rateText: `需要 ≤ ${line}（最终成功率 ${Math.round(lc.chance * 1000) / 10}%）`,
            roll: r.roll, ok: r.ok,
            okText: "检定成功", failText: "检定失败"
          });
        }
      } finally { checking = false; }
    }
    act(() => notes);
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
    body.querySelectorAll("[data-route]").forEach(b => {
      const go = () => act(() => Rogue.chooseNode(run, Number(b.dataset.route)));
      b.addEventListener("click", go);
      b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    on("r-fight", fight);
    on("r-long", () => {
      const w = $("r-watch");
      act(() => Rogue.restAtNode(run, "long", { watch: (w && w.value) || null }));
    });
    on("r-short", () => act(() => Rogue.restAtNode(run, "short")));
    on("r-rest-skip", () => act(() => Rogue.restAtNode(run, "leave")));
    on("r-short-before", () => act(() => Rogue.shortRestBeforeNode(run)));
    on("r-leave", () => act(() => Rogue.leaveNode(run)));
    body.querySelectorAll("[data-check]").forEach(b => { b.onclick = () => doCheck(b.dataset.check); });
    on("r-check-skip", () => act(() => Rogue.skipCheck(run)));
    on("r-camp", () => act(() => Rogue.camp(run)));
    on("r-next", () => act(() => Rogue.nextAct(run)));
    on("r-win", () => act(() => Rogue.afterVictory(run, false)));
    on("r-more", () => act(() => Rogue.afterVictory(run, true)));
    on("r-home", () => { Rogue.leaveRunMode(null); run = null; Screens.show("title"); });
  }

  /* ---------- 入口 ---------- */
  window.RunFlow = {
    ready: true,
    start(opt) {
      picked.length = 0;
      solo.on = !!(opt && opt.solo);
      solo.hero = null; solo.partners = []; solo.role2 = null;
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
        run = solo.on
          ? Rogue.newRun({ party: [solo.hero], partners: solo.partners.slice(), role2: solo.role2, solo: true })
          : Rogue.newRun({ party: picked.slice() });
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
