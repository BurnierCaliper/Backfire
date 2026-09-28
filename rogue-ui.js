/* 角鳞：四幕 · 单局界面
 *
 * 规则全在 rogue.js，这里只负责显示和按钮。每做一步就自动存档。
 * 界面：
 *   party  选队伍（2–4 人）
 *   run    单局主界面，按 run.stage 显示任务板 / 任务节点 / 休整 / 首领 / 幕间 / 结局
 *   battle 战斗（game.js），打完回到 run
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let run = null;          // 当前这一局
  let lastNotes = [];      // 上一步发生了什么（显示在记录栏）

  const save = () => { if (run && run.stage !== "over") SaveStore.saveRun(run); };

  function act(fn) {
    try {
      const notes = fn() || [];
      lastNotes = Array.isArray(notes) ? notes : [];
    } catch (e) {
      lastNotes = [e.message];
    }
    save();
    render();
  }

  /* ---------- 选队伍 ---------- */
  const picked = [];
  function renderParty() {
    const box = $("party-grid");
    const pool = Rogue.heroPool();
    box.innerHTML = pool.map(c => {
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
    const ok = n >= SaveStore.PARTY_MIN && n <= SaveStore.PARTY_MAX;
    $("party-go").disabled = !ok;
    $("party-count").textContent = `已选 ${n} 人（${SaveStore.PARTY_MIN}–${SaveStore.PARTY_MAX} 人）` +
      (n ? "：" + picked.map(Rogue.heroName).join("、") : "");
  }

  /* ---------- 单局主界面 ---------- */
  function bar(cur, max, cls) {
    const pct = max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0;
    return `<span class="rbar ${cls || ""}"><i style="width:${pct}%"></i></span>`;
  }

  function renderHeader() {
    const C = Rogue.CONFIG;
    $("run-where").textContent = `第 ${run.act} 幕 · ${Rogue.region(run)}`;
    $("run-day").textContent = `第 ${run.day} 天 · 本幕剩 ${Rogue.daysLeft(run)}/${C.daysPerAct} 天`;
    const s = run.supplies;
    $("run-supplies").innerHTML =
      `<span>水 <b>${s.water}</b> ml</span><span>食物 <b>${s.food}</b></span><span>奎支 <b>${s.kuizhi}</b></span>`;
    $("run-party").innerHTML = run.party.map(h => {
      const v = Rogue.heroView(h);
      return `<div class="rhero${v.dying ? " dying" : ""}">
        <div class="rh-top"><b>${esc(v.name)}</b><span>Lv${v.level}</span></div>
        <div class="rh-row">血 ${bar(v.hp, v.hpMax, "hp")}<span>${v.hp}/${v.hpMax}</span></div>
        <div class="rh-row">坚毅 ${bar(v.shp, v.shpMax, "shp")}<span>${v.shp}/${v.shpMax}</span></div>
        <div class="rh-row">经验 ${bar(v.xp, v.xpNext, "xp")}<span>${v.xp}/${v.xpNext || "满"}</span></div>
        <div class="rh-w">${v.weapons.map(w => `${esc(w.name)} Lv${w.level}`).join(" · ")}${v.dying ? " · <em>濒死</em>" : ""}</div>
      </div>`;
    }).join("") + (run.fallen || []).map(f =>
      `<div class="rhero fallen"><div class="rh-top"><b>${esc(Rogue.heroName(f.kit))}</b><span>阵亡</span></div>
       <div class="rh-w">第 ${f.act} 幕第 ${f.day} 天 · ${esc(f.weapons.map(Rogue.heroName).join("、"))} 随之离队</div></div>`).join("");
  }

  function renderBoard() {
    const tasks = run.board || [];
    return `<h2>任务板</h2>
      <p class="r-hint">只写了大致目标、需要的时间、报酬和委托方提供的补给。任务里会遇到什么，要去了才知道。主线完成后直接进入本幕首领战。</p>
      <div class="task-list">${tasks.map((t, i) => {
        const why = Rogue.taskBlocked(run, t);
        return `<div class="task${t.key ? " key" : ""}">
          <div class="t-head"><b>${esc(t.name)}</b>${t.key ? '<span class="tag">主线</span>' : ""}<span class="days">${t.days} 天</span></div>
          <p>${esc(t.goal)}</p>
          <div class="t-meta">报酬 ${t.reward.kuizhi} 奎支 · 每人 ${t.reward.xp} 经验<br>提供补给 ${t.supply.water} ml 水 · ${t.supply.food} 份食物</div>
          <button class="g-btn r-go" data-i="${i}" ${why ? "disabled" : ""}>${why ? esc(why) : "接下任务"}</button>
        </div>`;
      }).join("")}</div>`;
  }

  function nodeLabel(n) {
    return { battle: "战斗", elite: "精英战", rest: "休息" }[n.type] || n.type;
  }

  function renderTask() {
    const t = run.task;
    const node = Rogue.currentNode(run);
    // 走过的节点和当前节点显示类型，后面的只显示「？」
    const track = t.nodes.map((n, i) => {
      const cls = i < t.index ? "done" : i === t.index ? "now" : "later";
      const text = i <= t.index ? nodeLabel(n) : "？";
      return `<li class="${cls}"><span>${i + 1}</span>${esc(text)}</li>`;
    }).join("");
    let panel = "";
    if (node && (node.type === "battle" || node.type === "elite")) {
      panel = `<p>${node.type === "elite" ? "前方有棘手的敌人。" : "前方有敌人拦路。"}</p>
        <button class="g-btn r-main" id="r-fight">迎战</button>`;
    } else if (node && node.type === "rest") {
      const c = Rogue.restCost(run);
      const can = Rogue.canLongRest(run);
      panel = `<p>找到一处能歇脚的地方。</p>
        <div class="r-choices">
          <button class="g-btn r-main" id="r-long" ${can ? "" : "disabled"}>长休<small>消耗 ${c.water} ml 水 · ${c.food} 份食物 · 血量回满、清除濒死、坚毅回复</small></button>
          <button class="g-btn" id="r-short">短休<small>不消耗补给 · 每人回复 等级×2+体质</small></button>
        </div>`;
    }
    return `<h2>${esc(t.name)}<span class="sub">${esc(t.goal)}</span></h2>
      <ol class="track">${track}</ol>
      <div class="r-panel">${panel}</div>`;
  }

  function renderStage() {
    switch (run.stage) {
      case "board": return renderBoard();
      case "task": return renderTask();
      case "camp": {
        const c = Rogue.restCost(run);
        return `<h2>休整</h2>
          <p class="r-hint">任务之间休整一次，算 ${Rogue.CONFIG.restDays} 天。补给够就长休（${c.water} ml 水 · ${c.food} 份食物），不够只能硬撑。</p>
          <button class="g-btn r-main" id="r-camp">休整</button>`;
      }
      case "boss":
        return `<h2>第 ${run.act} 幕 · 首领</h2>
          <p class="r-hint">这一战没有退路：输了，本局就此结束。</p>
          <button class="g-btn r-main" id="r-boss">迎战首领</button>`;
      case "interlude":
        return `<h2>第 ${run.act} 幕 · 落幕</h2>
          <p class="r-hint">幕间选择会在之后的版本加入。</p>
          <button class="g-btn r-main" id="r-next">前往第 ${run.act + 1} 幕</button>`;
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
    $("run-body").innerHTML = renderStage();
    const recent = lastNotes.length ? lastNotes : (run.log || []).slice(-6).map(l => l.text);
    $("run-log").innerHTML = recent.map(t => `<li>${esc(t)}</li>`).join("");
    bindStage();
  }

  function fight() {
    const spec = Rogue.battleSpec(run);
    if (!spec) return;
    save();   // 战斗打到一半退出，下次从这场战斗开头重来
    Screens.show("battle");
    GAME.startRogueBattle(spec, (win) => {
      lastNotes = Rogue.finishBattle(run, win);
      if (run.stage === "over") finishRun();
      else save();
      Screens.show("run");
    });
  }

  function finishRun() {
    const meta = SaveStore.loadMeta();
    meta.stats.runs += 1;
    if (run.result && run.result.win) meta.stats.wins += 1;
    meta.stats.deaths += (run.fallen || []).length;
    SaveStore.saveMeta(meta);
    SaveStore.clearRun();
  }

  function bindStage() {
    document.querySelectorAll("#run-body .r-go").forEach(b => {
      b.onclick = () => act(() => { Rogue.acceptTask(run, Number(b.dataset.i)); return [`接下任务「${run.task.name}」。`]; });
    });
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    on("r-fight", fight);
    on("r-boss", fight);
    on("r-long", () => act(() => Rogue.restAtNode(run, "long")));
    on("r-short", () => act(() => Rogue.restAtNode(run, "short")));
    on("r-camp", () => act(() => Rogue.camp(run)));
    on("r-next", () => act(() => Rogue.nextAct(run)));
    on("r-home", () => { run = null; Rogue.leaveRunMode(); Screens.show("title"); });
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
      Rogue.enterRunMode();
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
      Rogue.enterRunMode();
      lastNotes = [`出发。种子 ${run.seed}。`];
      save();
      Screens.show("run");
    };
    $("run-title").onclick = () => { save(); Rogue.leaveRunMode(); Screens.show("title"); };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
