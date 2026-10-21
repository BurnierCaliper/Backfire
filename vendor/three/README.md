# three.js 0.160.0（本地副本）

HD-2D 战场原型用（`prototypes/hd2d/`）。纯静态网页、不连外网也能跑，所以不走 CDN。

- `three.module.min.js`：npm `three@0.160.0` 的 `build/three.module.min.js`
- `addons/`：`examples/jsm/` 里用到的几个文件，原样复制（后期处理、CSS2D 标签、镜头控制）
- 页面里用 importmap 把 `"three"` 指到 `three.module.min.js`，addons 里的 `from 'three'` 就能找到它
- 许可证：MIT（见 `LICENSE`）

升级时整个目录换成新版本对应的文件，不要手改。
