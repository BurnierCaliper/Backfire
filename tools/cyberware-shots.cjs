// 诊所 · 义体浮层截图（1280×800）：NODE_PATH=/tmp/pw/node_modules node tools/cyberware-shots.cjs
const { chromium } = require("playwright");
const path = require("path"); const { pathToFileURL } = require("url");
const URL = pathToFileURL(path.resolve(__dirname, "..", "game.html")).href, OUT = path.resolve(__dirname, "..", "shots");
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto(URL); await p.evaluate(() => { window.__noLevelUpPopup = true; });
  const camp = async (prep) => {
    await p.evaluate(prep => {
      cyberwareLoadExamples();
      const run = Rogue.newRun({ party: ["kolt", "helu"], seed: "CW-SHOTS" });
      run.stage = "camp"; state.kuizhi = 20000;
      if (prep) (new Function("run", prep))(run);
      Rogue.save(run); RunFlow.resume();
    }, prep || "");
    await p.click('[data-cw-open="kolt"]'); await p.waitForSelector("#cw-overlay:not([hidden]) .cw-card");
  };
  await camp();
  await p.screenshot({ path: `${OUT}/cyberware-clinic-shop.png` });
  await p.click('[data-cw-pick="example_t5_melee"]');
  await p.screenshot({ path: `${OUT}/cyberware-install-confirm.png` });
  await p.click("[data-cw-cmd]"); await p.waitForSelector(".cw-row.on");
  await p.screenshot({ path: `${OUT}/cyberware-installed-remove.png` });
  await p.click("[data-cw-close]");
  await camp('run.party[0].cyber = { armor: 8, shield: 0, sand: 0, spirit: false }; cyberwareCanOverinstall = () => true;');
  await p.click('[data-cw-pick="example_t5_melee"]');
  await p.screenshot({ path: `${OUT}/cyberware-overcap-warning.png` });
  console.log(errs.length ? errs : "no errors"); await b.close();
})();
