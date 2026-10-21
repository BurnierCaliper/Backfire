const H = require("../../tests/headless.js");
const ctx = H.load();
const S = ctx.BattleSim;
function show(opt) {
  const st = S.setup(opt);
  console.log(opt.board || opt.zoneMode, "zoneMode", st.zoneMode, "board", st.board && st.board.id, "weather", st.weather, "turn", st.turnNo);
  console.log(" gaps", JSON.stringify(st.gaps));
  st.units.forEach(u => console.log("  ", u.name, u.kit, "z" + u.zone, u.isPlayer ? "P" : "E", "fly", u.flying, "sub", u.submerged, "hidden", u.hidden, "wpn", u.role, "layers", u.layers.map(l => l.type + l.current + "/" + l.max).join(","), "shp", u.shp, "def", u.def, u.defMax));
  return st;
}
const a = show({ party: ["kolt", "helu", "ruby", "yuito"], enemies: [{ id: "guard_sword", lv: 2, zone: 3 }, { id: "thug_knife", lv: 2, zone: 3 }, { id: "buoy", lv: 2, zone: 2 }], seed: "A" });
const b = show({ party: ["kolt", "helu", "ruby", "yuito"], zoneMode: 2, board: "square4", weather: "sand", enemies: [{ id: "sandfish_ambush", lv: 2, zone: 2 }, { id: "sand_beast", lv: 2, zone: 2 }], seed: "B" });
const c = show({ party: ["kolt", "helu", "ruby", "yuito"], board: "cross5", weather: "thunder", enemies: [{ id: "crow", lv: 2, zone: 3 }, { id: "buoy", lv: 2, zone: 3 }, { id: "thug_hammer", lv: 2, zone: 1 }], seed: "C" });
console.log(Object.keys(a.units[0]).join(","));
console.log(JSON.stringify(a.units[0].statuses));
console.log(JSON.stringify(a.fields[1]));
console.log("errors", ctx.__errors);
