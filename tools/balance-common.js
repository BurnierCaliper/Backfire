"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const vm = require("node:vm");
const H = require("../tests/headless");

// R1 评估冻结的样本只从这 10 名里抽队伍（manifest 的哈希跟着名单走，不能改）。
// 龙哥是后来加的：HEROES 里有他，playtest / 单场工具都能带（以前报 Invalid party）
const R1_HEROES = ["ruby", "yuito", "hiaki", "tou", "xia", "chuan", "nora", "kolt", "helu", "ras"];
const HEROES = R1_HEROES.concat(["longge"]);
const MAIN_ATTR = { tou: "con", yuito: "int", xia: "str", ruby: "int", hiaki: "str", chuan: "int", nora: "int", kolt: "str", helu: "int", ras: "int", longge: "int" };
const STRATEGIES = {
  matrix: { version: "basic-r1-v1", description: "BattleSim BASIC_POLICY; attack lowest-HP in-range target, move, assist/block; no consumables, no tactical lookahead. Preset levels, full health, no cybernetics; not natural progression or human performance." },
  campaign: { version: "smart-r1-v2", description: "Existing SMART one-action lookahead optimizes score gain, ally HP and enemy status. Main-attribute/first legal upgrade choices; constrained route, shop, rest and smith heuristics. Avoids risky elite side tasks when alternatives exist; after the main task, falls back to the best-paying legal side task if only excluded risky tasks remain, without forcing a stage. No battle consumables; summon skills disabled unless explicitly enabled. Not a complete player AI or human win-rate estimate." }
};
const clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash("sha256").update(typeof x === "string" || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest("hex");
const normalizeSource = source => String(source).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
function rng(seed) { let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function partyFor(seed, size) { const r = rng(seed), pool = R1_HEROES.slice(), party = []; while (party.length < size) party.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return party; }
function positiveInt(value, label) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be a positive integer`); return n; }
function validateParty(party, solo = false) { if (!Array.isArray(party) || party.length < (solo ? 1 : 2) || party.length > 4 || new Set(party).size !== party.length || party.some(k => !HEROES.includes(k))) throw new Error("Invalid party: choose distinct known heroes, 2–4 in multiplayer"); }
function chooseLevels(R, run, records = []) {
  for (let guard = 0; guard < 100; guard++) {
    const p = R.pendingChoices(run)[0]; if (!p) return records;
    const opts = R.choiceOptions(run, p.kit, p.index); if (!opts.length) throw new Error(`No upgrade choices for ${p.kit}`);
    const pick = (p.choice.type === "attr" && (opts.find(o => o.value === MAIN_ATTR[p.kit]) || opts.find(o => o.value === "con"))) || opts[0];
    R.choose(run, p.kit, p.index, pick.value);
    records.push({ kit: p.kit, level: p.choice.level, type: p.choice.type, value: pick.value, label: pick.label });
  }
  throw new Error("Upgrade selection exceeded 100 choices");
}
// heroView creates a temporary unit and consumes a random ID. Reporting must not
// change subsequent dice rolls; preserve the installed RNG cursor while reading it.
function withoutRandomDraws(c, fn) { const rng = c.S.RNG, draws = rng.draws(), random = c.Math.random; try { return fn(); } finally { if (rng.fn && random === rng.fn) rng.fn.setDraws(draws); c.Math.random = random; } }
function heroSnapshot(c, run) { return withoutRandomDraws(c, () => clone(run.party.map(h => { const v = c.Rogue.heroView(run, h); return { kit: h.kit, level: h.level, xp: h.xp, hp: v.hp, hpMax: v.hpMax, weaponLevels: h.weaponLevels, weapons: v.weapons, attrs: h.attrs, rolePicks: h.rolePicks, cyber: h.cyber || null, pending: h.pending || [], profs: h.profs }; }))); }
function fieldSnapshot(c) { return clone(c.S.state.units.filter(u => !u.hidden && !u._removed).map(u => ({ kit: u.kit, name: u.name, level: u.level, isPlayer: !!u.isPlayer, weaponOf: u.weaponOf || null, dead: !!u.dead, dying: !!u.dying, upOnShp: !!u.upOnShp, flying: !!u.flying, zone: u.zone, hp: (u.layers || []).reduce((n, l) => n + Math.max(0, Number(l.current) || 0), 0), layers: (u.layers || []).map(l => ({ type: l.type, current: l.current, max: l.max })), shp: u.shp, shpMax: u.shpMax, weaponLevels: u.weaponLevels || null }))); }
function wilson(wins, n) { if (!n) return null; const z = 1.959963984540054, p = wins / n, d = 1 + z * z / n, center = (p + z * z / (2 * n)) / d, half = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d; return [Math.max(0, center - half), Math.min(1, center + half)]; }
function quantile(values, p) { if (!values.length) return null; const a = values.slice().sort((x, y) => x - y), i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); }
function summarize(rows, requested = rows.length) {
  const outcomes = Object.fromEntries(["win", "lose", "retreat", "timeout", "error"].map(k => [k, rows.filter(r => r.outcome === k).length]));
  const executed = rows.length - outcomes.error, wins = rows.filter(r => r.outcome === "win"), scores = wins.map(r => r.score).filter(Number.isFinite);
  return { requested, completed: rows.length, executed, missing: requested - rows.length, outcomes, winRate: executed ? outcomes.win / executed : null, winRate95: wilson(outcomes.win, executed), scoreSampleSize: scores.length, scores: Object.fromEntries([.25, .5, .75, .9].map(p => [`p${p * 100}`, quantile(scores, p)])), grades: Object.fromEntries(["SSS", "SS", "S", "A", "B", "C", "D"].map(g => [g, wins.filter(r => r.grade === g).length])) };
}
function provenance(command = process.argv.join(" ")) {
  const files = [...H.RULE_FILES, "tests/headless.js", "tools/balance-common.js", "tools/score-by-act.js", "tools/playtest.js", "tools/balance-report.js"];
  const sourceHashes = Object.fromEntries(files.map(f => [f, hash(normalizeSource(fs.readFileSync(path.join(H.ROOT, f), "utf8")))]));
  let commit = null, dirty = null; try { commit = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: H.ROOT, encoding: "utf8" }).trim(); dirty = cp.execFileSync("git", ["status", "--porcelain"], { cwd: H.ROOT, encoding: "utf8" }).trim(); } catch (_) { /* source hashes remain authoritative */ }
  const c = H.load(), names = [...fs.readFileSync(path.join(H.ROOT, "rogue-data.js"), "utf8").matchAll(/^const (ROGUE_[A-Z_]+)\s*=/gm)].map(m => m[1]);
  const config = clone({ rogue: c.Rogue.CONFIG, rogueTables: vm.runInContext("({" + names.join(",") + "})", c), scoreGrades: c.S.SCORE_GRADES, scoreRules: c.S.SCORE_RULES, scoreSpeed: c.S.SCORE_SPEED, gradeLines: [1, 2, 3, 4].map(act => ({ act, lines: c.gradeLines(act) })) });
  return { commit, dirty, sourceHashes, sourceHash: hash(sourceHashes), sourceHashNormalization: "UTF-8 decode; strip leading BOM; CRLF to LF; preserve all other characters and trailing whitespace", config, configHash: hash(config), configScope: "Snapshot: all ROGUE_* tables in rogue-data.js and scoring tables; SHA256: every loaded rule/data source plus simulator and reporting tools, covering remaining game configuration.", node: process.version, command, strategies: STRATEGIES };
}
function reportPath(file) { const root = path.resolve(H.ROOT, "docs/r1"), resolved = path.resolve(H.ROOT, file); if (!resolved.startsWith(root + path.sep)) throw new Error("Generated reports must be inside docs/r1/"); fs.mkdirSync(path.dirname(resolved), { recursive: true }); return resolved; }
function csv(rows) { if (!rows.length) return ""; const keys = [...new Set(rows.flatMap(Object.keys))], escape = v => '"' + String(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v).replaceAll('"', '""') + '"'; return [keys.map(escape).join(","), ...rows.map(r => keys.map(k => escape(r[k])).join(","))].join("\n") + "\n"; }
module.exports = { HEROES, R1_HEROES, MAIN_ATTR, STRATEGIES, clone, hash, normalizeSource, rng, partyFor, positiveInt, validateParty, chooseLevels, withoutRandomDraws, heroSnapshot, fieldSnapshot, wilson, quantile, summarize, provenance, reportPath, csv };
