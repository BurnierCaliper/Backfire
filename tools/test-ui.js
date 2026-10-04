// 发布/验收用：缺少浏览器或 Playwright 时失败，不能以跳过代替通过。
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const uiTests = fs.readdirSync(path.resolve(__dirname, "../tests"))
  .filter(name => name === "ui.test.js" || name.endsWith("-ui.test.js"))
  .sort().map(name => "tests/" + name);
const result = spawnSync(process.execPath, ["--test", ...uiTests], {
  cwd: path.resolve(__dirname, ".."),
  env: { ...process.env, REQUIRE_UI: "1" },
  stdio: "inherit"
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status == null ? 1 : result.status;
