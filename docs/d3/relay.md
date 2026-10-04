# D3 转发服务与浏览器传输

这是可选的独立 Cloudflare Worker；游戏仍可纯本地运行。Worker 只管理房间身份、在线状态和定向转发，游戏规则、掷骰、存档与逐收件人投影均由主持人客户端执行。浏览器只加载 `relay-transport.js`，不需要 npm 运行时依赖。

## 本地运行与测试

在仓库根目录执行（Node.js 22 或更高；本次验证使用 24.18.0）：

```sh
npm ci --prefix relay
npm --prefix relay run local
```

默认服务地址为 `http://127.0.0.1:8787`；`PORT` 环境变量可改端口。本地 helper 默认允许 `http://localhost:8080`、`http://127.0.0.1:8080` 和本地文件的 `null` 来源。它仅监听回环地址，不暴露到局域网。CLI 默认临时存储，进程退出后房间失效。需要本地持久化或随机端口的测试/工具可以使用：

```js
const { createLocalRelayServer } = require("./relay/local-server.cjs");
const server = await createLocalRelayServer({
  port: 0,
  origins: ["http://127.0.0.1:8080"],
  persistPath: "./relay/.wrangler/local-rooms" // 可选，独立的测试目录
});
console.log(server.url);
// 完成后：await server.close();
```

helper 用实际 Miniflare/workerd 加 SQLite Durable Objects 运行同一份 `worker.js`，并使用真实 TCP WebSocket；不是模拟传输。开发依赖固定在 `relay/package-lock.json`，与根目录游戏依赖隔离。当前 Wrangler 4.147.0 对应 Miniflare 5.20261001.0-alpha，因此 helper 使用该版本的转换器与 `resourcePersistencePath`，而不是已不再转换的旧 `durableObjectsPersist` 键。

```sh
node --test tests/relay.test.js
# 需已有 Playwright 和 Chromium；设置 REQUIRE_UI=1 可禁止缺浏览器时跳过
node --test tests/relay-ui.test.js
npm --prefix relay run check
```

Windows PowerShell 强制浏览器验收可先执行 `$env:REQUIRE_UI='1'`。若 Playwright 在非项目位置，通过 `NODE_PATH` 指向其安装目录。`check` 是 `wrangler deploy --dry-run`：只构建并检查本地配置，不部署。

自动测试覆盖端点身份、防昵称冒用、四名玩家及离线座位保留、协议/构建不匹配、主机断线暂停、明确恢复、原令牌替换旧连接、私发隔离、Unicode 大快照分片、超限与速率拒绝、SQLite 进程重启恢复。浏览器测试使用三个隔离 Chromium 会话（包含 390 px 手机视口），实际中断主机 30 秒、刷新页面并从本地保存的令牌恢复；同时测量真实发送/接收帧大小。手机视口测试不等于公网手机实机验收。

## 接口与宿主职责

公网复验为显式选择，不在普通 `npm test` 中请求公网：

```powershell
$env:BACKFIRE_PUBLIC_RELAY='https://backfire-relay.richardguu22.workers.dev'
$env:BACKFIRE_PUBLIC_TEST_PORT='8080'
node tools/test-online-public.cjs
```

需要可用的 Playwright/Chromium（外部安装时设 `NODE_PATH`），本机 8080 端口须空闲。工具强制执行浏览器检查，运行四个测试房间、五个无演出显示延迟样本和一次真实 30 秒断线，不部署、不改 Cloudflare 配置，也不启动本地 workerd。完成后清除这两个环境变量，普通测试回到本地转发。公网结果与限制见 [验收记录](verification.md)。

```js
const host = await RelayTransport.createHost({
  url: "https://YOUR-NEW-RELAY.YOUR-SUBDOMAIN.workers.dev",
  name: "主持人", protocol: 1, build: "相同的构建标识"
});
const player = await RelayTransport.join({
  url, roomCode, name: "玩家", protocol: 1, build
});
const resumedHost = await RelayTransport.resumeHost({
  ...savedCredentials, hostToken: savedCredentials.token
});
const resumedPlayer = await RelayTransport.join({
  ...savedCredentials, resumeToken: savedCredentials.token
});
```

| 接口 | 返回与约定 |
| --- | --- |
| `endpoint.identity` | 复制后的 `{id, role, name, roomCode}`；主持人 ID 固定为 `host`，玩家 ID 由服务端随机生成 |
| `credentials()` | `{url, roomCode, role, token, protocol, build}`；游戏在独立的 `backfire-online-v1` 本机恢复数据中保存当前房间及关联跑团槽，不改变原存档格式；不能广播或加入调试导出 |
| `onMessage((message, from) => {})` | `from` 是转发服务绑定的端点 ID；返回取消订阅函数。权威层必须使用这个参数，不信任 payload 内的 `sender` |
| `send(message, to?)` | 主持人可发玩家 ID 或 `all`，默认广播；玩家只能发主持人。Promise 表示转发确认，不表示规则接受或落盘 |
| `onStatus(fn)` / `status()` | 复制后的连接/房主/暂停状态和公开座位表；订阅时立即给最新值 |
| `setReady(boolean)` | 仅主持人；新建与每次重连均先暂停，宿主完成状态恢复、投影发送后明确恢复 |
| `close()` | 主动关闭并停用自动重连 |
| `reconnect()` | 对尚未永久关闭的端点立即尝试重连；主动关闭后应用保存的凭证重新调用静态加入接口 |

`status()` 为 `{connected, hostOnline, paused, roomCode, roster, expiresAt, reason?}`；座位表只含 `{id,name,role,online}`。新订阅之前最多缓存 64 条 / 4 MiB 已完成消息；接入方应立即订阅。所有消息必须严格可 JSON 往返；拒绝函数、undefined、访问器、循环、自定义实例和原型污染字段。

传输层默认在异常掉线后按 1、2、4、8、15 秒退避重连，可设置 `autoReconnect:false`。每 15 秒发送 WebSocket 自动回应心跳；45 秒收不到响应会关闭连接并重连，网络故障的发现不是瞬时的。未确认的应用指令不会自动重发，应用层需按请求 ID 查询/去重、按序号恢复。服务端 `ack` 不替代应用结果。

房主断线后玩家发给主机的消息在服务端也会被拒绝。房主重连仍为暂停，可以先向玩家发送恢复快照，然后 `setReady(true)`。不迁移主持权；玩家令牌不能恢复主持人。Q2 的「离线角色轮到时等 60 秒再跳过」「离线协助视为放弃」由游戏会话控制器执行，转发服务不计战斗回合，也不替玩家行动。

## 协议、身份与生命周期

`POST /rooms` 接收 `{protocol,build,name}`，返回房间码、`hostToken` 和过期时间。WebSocket 地址是 `/rooms/XXXXXX`；令牌放在首个 JSON `join` 帧中，不放 URL。其余帧均有 `{v:1,protocol,build,kind}`。协议与构建必须与房间完全一致。

房间码为安全随机的六位大写字母/数字，去除 I、O、0、1；32 字符字母表提供 30 位随机空间，冲突会重试。房间码是邀请信息，不是恢复身份的凭证。`hostToken` / `resumeToken` 为独立 256 位安全随机值；Durable Object 只持久化 SHA-256 摘要。昵称只用于展示与避免重名，不决定归属；恢复时客户端改昵称会被忽略。拥有有效令牌的新连接会取代同一座位的旧连接。

每房间最多一名主持人和四名玩家，离线座位仍占名额并保留身份。令牌不自动转给其他人，也不通过重复昵称取回；令牌丢失需要创建新房间。房间自创建起默认有效 24 小时，`ROOM_TTL_SECONDS` 可设为 60–86400 秒；到期拒绝加入、关闭连接并通过 alarm 删除元数据。存档由主持人保管，房间到期不意味着游戏存档丢失。

每房间一个 SQLite Durable Object 存储房间版本、过期时间、座位昵称/角色/令牌摘要。它不保存战斗权威状态、私聊内容、快照或消息历史。连接与分片计数使用 Hibernation 附件，`acceptWebSocket` 与自动 ping/pong 使空闲连接可休眠；服务重启不丢持久化令牌。另一个 Admission DO 按来源 IP 的散列定位短期计数桶，120 秒后删除计数，不向参与者公开 IP。

## 消息体积与限流

| 边界 | 当前值 |
| --- | --- |
| HTTP 开房请求 | 最大 4096 字节，流式有界读取 |
| WebSocket 入站/出站 JSON 帧 | 最大 50 KiB；包括协议外壳，按 UTF-8 字节计 |
| 玩家到主持人的逻辑消息 | 只能单帧，传输器预留 256 字节给转发身份外壳 |
| 主持人大快照 | 可分片，重组 JSON 最大 2 MiB，最多 512 片；每片 4096 个 UTF-16 码元，含转义后仍低于 50 KiB |
| 分片接收 | 顺序、总数、收件人、来源一致；15 秒期限，客户端最多四组未完成分片 |
| 端点发送速率 | 每 10 秒：玩家 120 帧 / 256 KiB；主持人 2400 帧 / 12 MiB；越限关闭连接 |
| 开房 / WebSocket 升级 | 每来源 IP 每分钟 10 / 60 次；失败的房间码猜测也计入 |
| 未认证连接 | 每房间总连接最多 12 条，15 秒未完成握手会关闭 |

**分片只保证单帧有界，不能证明 PRD「单次行动 ≤50 KB」指标。** 普通 4v3 行动必须在游戏层测量动作产生的逻辑 DTO 总字节，先裁剪可见状态/增量。大快照分片用于重同步或明确的大事件集合；不能以拆包掩盖单次行动超标。Unicode 在所有分片合并后再解析，不会因切开代理对而丢字。

转发层只改写可信 `from` 外壳，不读取 payload 的游戏语义，也不做脱敏。主持人必须先按收件人生成 DTO 再定向发送；给 `all` 的内容必须是所有玩家都能看见的公开信息。`ALLOWED_ORIGINS` 限制浏览器来源，但不承担身份认证；非浏览器仍必须通过房间凭证规则。生产连接必须 HTTPS/WSS。

## 已部署的独立测试服务

作者在 2026-10-04 明确授权“允许，不要触动到任何已有的网站配置”后，已新建 `backfire-relay`，使用既有 Wrangler 登录凭据部署。部署前确认该名称不存在；没有更新其他 Worker、域名、DNS、路由、套餐或账号权限。

- 游戏中填写的服务地址：`https://backfire-relay.richardguu22.workers.dev`
- 健康检查：[GET /health](https://backfire-relay.richardguu22.workers.dev/health)
- 服务版本：`4d8e54e9-e4b8-427d-aacc-810b417c496b`；浏览器构建：`backfire-d3-v1`。
- 此服务只做转发，没有托管游戏网页或绑定自定义域名。用同一份游戏文件打开 `game.html`，在「联机开房」或「加入房间」里填写服务地址。
- 本期允许来源为 `null`（本地文件）、`http://localhost:8080` 和 `http://127.0.0.1:8080`。未使用通配来源；房间权限仍由独立端点令牌决定。将来托管游戏网页时，仅给这个新服务增加实际 HTTPS origin。

## 独立部署步骤

1. 在 `relay/wrangler.jsonc` 将 `name` 确认为一个全新的独立名称，例如 `backfire-relay`；若账户已有同名服务，改用未占用的新名称。不要把这里的名字换成其他网站的现有 Worker。
2. 按实际游戏入口设置 `ALLOWED_ORIGINS`，可用逗号列多个。若支持双击本地 `game.html`，保留 `null`；若以后只提供 HTTPS 游戏站点，改成对应完整 origin 并移除不再使用的来源。`workers_dev:true` 只为本服务生成 workers.dev 地址，不需要改已有站点路由。
3. 保留两个独立 DO 绑定 `ROOMS → Room`、`ADMISSION → Admission`，首次迁移 `v1` 使用 `new_sqlite_classes:["Room","Admission"]`。后续变更追加迁移 tag，不能删改已应用的迁移历史。
4. 获得部署授权后，在 `relay/` 使用 Wrangler 的既有凭据，核对账户身份、新 Worker 名称与配置，再运行 `npm run check` 和 `npm run deploy`；确实缺登录时再完成对应账号的登录。凭证不写仓库。后续只能更新本服务，不把配置的名字替换为其他网站的 Worker。
5. 将新服务 HTTPS 地址填入游戏联机设置，在两个独立浏览器和一台真实手机上复测创建、加入、私发、版本错配、30 秒断线与原身份恢复、主机恢复前全房暂停。记录服务 URL、构建标识、设备和结果；这些公网证据不由本地测试代替。

截至 2026-10-04 官方说明，Workers Free 可使用 SQLite Durable Objects；现行免费档列出 100,000 次请求/天、13,000 GB-s/天，SQLite 每天 5,000,000 行读 / 100,000 行写与 5 GB 存储。超过免费额度会导致操作失败，不能视为无限免费托管。[Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

本配置采用官方推荐的 Hibernation WebSocket API，休眠连接不持续占用执行时长；SQLite 的 KV API 仍落在 SQLite 存储中。当前新建命名空间应使用 SQLite，并以 `new_sqlite_classes` 配置迁移。[WebSockets 与 Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[Durable Objects migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[Storage API](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)、[2026-07-09 SQLite 命名空间变更](https://developers.cloudflare.com/changelog/post/2026-07-09-restrict-new-kv-backed-namespaces/)
