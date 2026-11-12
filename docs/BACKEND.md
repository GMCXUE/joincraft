# 后端方案与实现 · v0.4

## 技术栈决策

| 层 | 本次选择 | 原因与边界 |
| --- | --- | --- |
| 运行时 | Node.js 24 LTS | 与现有网页技术一致；在 24.22.3 上验证，避免依赖本机 Node 23 上线 |
| 接口 | Fastify 5 + TypeScript strict | 明确接口边界、统一请求限制、错误处理、日志与类型检查 |
| 数据库 | SQLite，WAL + 外键 + 事务 | 低并发房间控制服务不必额外运行数据库进程；数据目录需持久卷 |
| 数据库驱动 | Node 内置 node:sqlite，隔离在 Store 层 | 不依赖原生 npm 扩展编译；运行时固定到已验证的 Node 24 系列，升级需回归测试 |
| 状态同步 | REST 写入 + SSE 失效通知 | 服务端推送变化，客户端再读取完整授权状态；无需每 1.8 秒轮询 |
| 桌面端后续 | 建议 Tauri 2 | 复用网页界面，Windows exe / macOS dmg；本轮不生成安装包 |
| 游戏数据通道后续 | 独立客户端代理与中继 | Fastify 负责房间与鉴权，不转发 MC 游戏流量；FRP / 自建代理需单独选型和实测 |

不在此轮引入 Redis、微服务或额外数据库进程。当前只允许一个服务实例。VPS 有 2 核 2GB，房间控制服务按 CPU 100m / 内存 96Mi 请求、500m / 384Mi 上限准备部署清单；这是初始资源预算，并非实测容量保证。实际余量取决于 VPS 上原有 Kubernetes 与项目占用，需要部署前查看。

SQLite WAL 支持读写并发，但写事务仍串行；不把数据库文件放到跨主机共享网络盘。需要多副本、高写入量或多节点时，迁移 PostgreSQL，并把进程内通知改成跨节点消息分发。

## 已实现

- 持久化设备身份、会话、房间、成员、游戏环境、图片、密码摘要和操作记录。
- 数据库版本迁移，重启恢复；事务内重新检查人数、房间状态和密码版本，防止并发加入超员。
- 256 位随机设备令牌，数据库仅存 SHA-256 摘要；公开成员 ID 不能用于登录。
- 设备会话空闲 30 天失效，活跃访问最多每分钟续期一次；服务重启不丢会话。
- 密码使用随机盐和 scrypt；不向客户端返回密码或摘要。
- 房主权限、成员可见性、请求体限制、同源检查、IP 与设备限流；日志隐藏认证头。
- SSE 首次连接和每次重连都同步全量状态；断开后退避重连，心跳检测停滞，慢连接释放。
- 在线一致性备份、健康检查、Docker Compose 和 Kubernetes 示例。

## 身份的实际含义

v0.5 已加入用户名和密码账号。注册可绑定当前访客的房间；换浏览器后登录同一账号即可恢复。网页账号会话使用 HttpOnly Cookie，不在 localStorage 存账号令牌。详情见本文最后的 v0.5 说明。

未注册访客仍是“记住这台设备”：普通窗口的访客令牌保存在 localStorage，访客测试标签页使用 sessionStorage。清除浏览器数据或连续 30 天不用会失去未绑定访客的访问权。账号用户可以重新登录；密码找回尚未提供。桌面版后续应使用系统凭据存储，当前账号也不是微软 / MC 正版身份认证。

旧 v0.3 的内存房间没有数据库迁移来源。首次切换 v0.4 后需重新创建；之后的新房间会持久保存。

## 目录

```text
src/app.ts         HTTP 路由、鉴权边界、SSE、健康检查与退出
src/service.ts     会话、房间权限、事务和限流
src/database.ts    SQLite 访问与版本化迁移
src/validation.ts  输入校验与密码计算
public/realtime.js SSE 客户端重连与心跳
server.mjs        启动与环境变量
scripts/backup.mjs 一致性在线备份
```

## HTTP 接口

网页账号使用 HttpOnly Cookie；访客及旧设备会话使用 `Authorization: Bearer <token>`，兼容 `X-Session`。注册 / 登录 / 健康检查无需已有登录态；令牌不得出现在 URL。

| 方法 | 路径 | 含义 |
| --- | --- | --- |
| GET | /healthz | 进程与数据库可访问检查，不返回房间数据 |
| POST | /api/session | `{name}` 创建当前设备身份，返回 `{id, name, expiresAt}`，id 为令牌 |
| GET | /api/state | 当前成员有权访问的房间、资料和能力状态 |
| GET | /api/events | 带鉴权的 SSE；只向关联成员发送 `change` 通知，不在事件中传房间数据 |
| POST | /api/profile | `{name}` 修改展示昵称 |
| POST | /api/rooms | `{name, capacity, password?, image?, description?, version?, loader?, port?}` |
| POST | /api/join | `{code, password?}`，无审批，验证通过直接加入 |
| POST | /api/rooms/:id/game | 房主更新版本、加载器与端口 |
| POST | /api/rooms/:id/settings | 房主更新信息；`passwordMode` 为 keep / set / remove |
| POST | /api/rooms/:id/leave | 成员退出，房主不可使用 |
| POST | /api/rooms/:id/close | 房主关闭；历史记录保留，房间号失效 |

错误返回 `{error}`。400 输入 / 业务限制，401 会话失效，403 权限或密码错误，404 不存在，409 密码在验证中变更，413 内容过大，429 限流，500 内部错误。

当前限制：创建会话每 IP 每小时 30 次；写请求每 IP 每分钟 120 次；加入每设备每分钟 12 次 / 每 IP 60 次；单设备最多创建 10 个活跃房间；单房间 2–32 人；全局最多 1000 个房间 / 10000 个设备；SSE 每身份 6 条 / 全局 200 条。旧房间清理和管理后台待补，不会通过重启绕过数据库计数。

## 本地启动与验证

```sh
npm ci
npm start
npm test
npm run typecheck
```

使用 Node 24 LTS。`npm start` 自动编译 TypeScript，并读取可选 `.env`。默认只绑定 `127.0.0.1:4180`，数据存放于 `data/blockroom.sqlite`，已忽略提交。测试显式使用临时目录或内存数据库，不修改真实数据。

## 部署方式

Docker：`docker compose up -d --build`。默认仅发布本机端口，SQLite 位于命名卷，重建容器不会清空。不要运行 `docker compose down -v`，该选项会删除数据卷。

Kubernetes：提供 `deploy/kubernetes.yaml`。先替换镜像和 `PUBLIC_ORIGIN`，确认集群默认 StorageClass 可用，再部署。单副本、Recreate 更新，PVC 保存数据；滚动更新可能短暂断开连接。清单没有自动创建公网 Ingress，也没有假定现有集群的控制器、证书或存储配置。

公网必须使用 HTTPS 反向代理，`PUBLIC_ORIGIN` 可为受信证书覆盖的 IP 源或域名源。反向代理保留 Host，SSE 禁止缓冲并将读取超时设为至少 60 秒。只有配置实际反向代理的 IP / CIDR 为 `TRUST_PROXY` 后才信任转发来源，不能填写任意来源；未配时反向代理后面的客户端会共用代理 IP 限流。当前没有跨域桌面访问配置，Tauri 接入时单独加受控 origin 或通过原生 HTTP 层访问。

本轮未部署到 VPS，也未在本机运行 Docker / Kubernetes 清单；本机没有 Docker 环境。镜像正式发布时应固定经验证的 tag / digest。

## 备份与恢复

```sh
npm run backup
# 或指定备份目标（必须不存在）
node scripts/backup.mjs /absolute/path/backup.sqlite
```

使用 SQLite backup API 生成一致性快照，可在服务运行时执行；不会覆盖已存在目标。不要仅复制活跃数据库的 `.sqlite` 主文件而遗漏 WAL。恢复时停止服务，保留一份当前数据目录，将备份文件作为新 `DATABASE_PATH` 后启动验证；不要把旧的 `-wal/-shm` 文件混入恢复目录。备份包含会话摘要和房间数据，需按私有文件保存。

## 依据

- [Node.js 官方版本计划](https://nodejs.org/en/about/previous-releases)
- [Fastify 5 迁移与运行时要求](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)
- [SQLite WAL 的并发与存储约束](https://sqlite.org/wal.html)
- [Tauri 分发格式](https://v2.tauri.app/distribute/)

## 本轮验收记录（2026-11-12）

- Node 24.22.3：8 项测试通过，TypeScript strict 编译通过。
- 浏览器：双会话加入后即时同步；停止 / 重启服务后自动重连，同一房间号与两名成员保留；刷新后仍保持房主身份。
- 备份：在线生成快照并读取验证；已有目标拒绝覆盖。
- 官方 npm registry 生产依赖审计：0 项已知漏洞（检查时点结果）。
- 本机 macOS、两名成员和两个 SSE 连接下，进程 RSS 48544 KiB，约 47.4 MiB；仅为低负载观测，不代表 Linux VPS 上限、压测结果或 MC 转发成本。
- Docker / Kubernetes 配置尚未在容器或集群运行验证，VPS 未变更。

## v0.5 账号登录（取代上文仅设备身份的限制）

- 新增 `accounts` 表，数据库自动迁移至版本 2，已有房间和访客会话保留。
- 用户名支持 3–24 位字母 / 数字 / 下划线，按小写规范化且唯一；账号密码为 15–64 字符。
- 账号密码采用带随机盐的 scrypt（N=32768、r=8、p=3），算法参数随摘要保存；并发账号密码运算最多 2 个。
- `POST /api/auth/register` 接收 `{username,password,name?}`。当前为访客时绑定原 user_id，保留房主和成员关系，并撤销旧访客会话。已登录账号不能再次注册覆盖身份。
- `POST /api/auth/login` 接收 `{username,password}`，新的设备获得独立会话；不存在账号和错误密码统一提示。已有账号登录不会自动合并访客房间。
- `POST /api/auth/logout` 撤销当前会话，并立即断开该会话的 SSE；其他设备会话不受影响。
- 网页账号会话由 HttpOnly + SameSite=Strict Cookie 保存；HTTPS 部署使用 Secure 和 `__Host-` 前缀。账号令牌不返回 JSON，不写 localStorage，不放 URL。成功读取 state 会续期 Cookie；服务端会话沿用 30 天空闲过期。
- Bearer 仅用于访客体验及原有设备会话迁移，显式 Bearer 优先于 Cookie。API 写入仍需 JSON、通过 Host / Origin 检查；默认不启用 CORS。
- 每账号最多保留 10 个设备会话。登录每 IP 每 15 分钟最多 30 次、每用户名最多 15 次；注册每 IP 每小时最多 10 次。计数持久化，限流窗口结束后可重试。
- 外栏头像是唯一账号入口。登录、注册、修改昵称、退出都从这里进入；内部个人信息行已移除。新用户可选登录 / 注册或显式访客体验。
- 暂未提供邮箱验证、密码找回、修改密码、MFA 或微软账号认证；账号系统仅用于joincraft房间身份。

验证：12 项后端测试通过；隔离数据库的浏览器验收覆盖访客建房、注册保留房间、退出、错误密码提示和重新登录恢复。现有本地数据库升级前已生成一致性备份，测试账号未写入用户的正式预览数据库。

参考：[OWASP 密码存储建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[浏览器 Cookie 属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)。

## v0.6 好友与私聊

数据库迁移至 v3，新增 friendships、messages、read_cursors；已有账号与房间保留。

| 接口 | 功能 |
| --- | --- |
| GET /api/state | 新增 social：好友、待处理申请、私聊预览和未读数，仅返回当前账号的数据 |
| POST /api/friends/request | `{username}` 申请加好友，仅限注册账号 |
| POST /api/friends/:peer/accept | 仅接收方可接受 |
| POST /api/friends/:peer/decline | 仅接收方可拒绝 |
| POST /api/friends/:peer/cancel | 仅发送方可取消 |
| GET /api/chats/:peer/messages?before=ID | 仅已接受的好友可读取，按 ID 游标每页 50 条 |
| POST /api/chats/:peer/messages | `{content,clientId}`，1–2000 字符；同一发送者的 clientId 唯一，失败重试不重复入库 |
| POST /api/chats/:peer/read | `{uptoId}`，只更新自己的已读游标，不允许引用其他对话或未来消息 |

好友关系每对账号唯一；待处理申请不能绕过同意直接发消息。消息变化仅向双方 SSE 会话发送失效通知；已读变化仅通知本人各设备。消息由服务端鉴权读取，文本存储在 SQLite，未实现端到端加密。

每账号最多 200 个好友和待处理关系，好友申请每分钟 20 次，发消息每分钟 60 次，同时受写请求 IP 限流约束。接口测试覆盖申请权限、非好友和第三方读取拦截、重试去重、未读游标、消息长度、分页与重启恢复；共 15 项测试通过。

## v0.8 Java 联机中继

`src/relay.ts` 提供房间成员鉴权的 WebSocket 中继；`bridge/client.mjs` 管理本机 TCP，`bridge/minecraft.mjs` 实现 Java 状态查询。esbuild 将 CLI 和 ws 打包为 `public/joincraft-bridge.cjs`，通过下载接口提供给 Windows / macOS / Linux。无需开放每个房间的公网 MC 端口。

| 接口 | 行为 |
| --- | --- |
| POST /api/rooms/:id/play/start | 房主提供 `{port}`，创建开房会话并签发 5 分钟一次性连接凭据 |
| POST /api/rooms/:id/play/connect | 已加入且房主在线的成员获取自己的连接凭据 |
| POST /api/rooms/:id/play/stop | 房主停止该房间全部游戏传输 |
| POST /api/rooms/:id/play/disconnect | 只回收当前用户的连接程序与数据通道 |
| GET /downloads/joincraft-bridge.cjs | 下载已打包的连接程序，不含账号或连接凭据 |
| WS /bridge/control | Authorization Bearer 凭据建立一次性控制连接 |
| WS /bridge/data/new、/bridge/data/:id | 绑定已鉴权控制连接、所属房间和配对 ID 的二进制传输 |

`/api/state` 每个房间新增 `connection`，包括 offline / waiting / online / error、探测到的版本、连接数及当前用户的本机入口。本机地址不返回给其他成员，连接数包含 MC 状态查询，不等同玩家在线数。游戏会话与临时凭据仅在内存，服务重启需重新开房，持久化房间不受影响。

连接程序只访问 `127.0.0.1` 上指定的游戏端口，启动时及每 10 秒查询 Java 状态；成员 TCP 监听也仅绑定 127.0.0.1，端口动态分配。公网只允许可信 HTTPS / WSS；HTTP 仅用于 loopback 开发。不会自动绕过证书验证、改变 MC 身份认证或修改游戏存档。

控制连接 ping/pong 检查、会话有效期和成员身份检查每 15 秒执行；退出登录、退出房间、关房通过现有事件立即回收相应连接。重试需重新生成凭据。凭据以 SHA-256 摘要保存在内存，通过 Authorization 头发送，不放 URL 或日志。最多同时 16 个开房会话、128 个连接程序、128 条数据通道，每个成员最多 8 条数据通道；帧最大 64 KiB、使用流背压、关闭 WebSocket 压缩，等待房主配对最多 10 秒。

### VPS 部署前提（本次未执行）

保持单副本，因为中继配对与控制会话在进程内；保留 SQLite 持久卷。反向代理需要把 `/bridge/` 的 WebSocket Upgrade 转发到同一个后端，设置长连接超时并禁用该路径缓冲，配置 PUBLIC_ORIGIN 为可信 HTTPS 源和实际 TRUST_PROXY。只需公开 HTTPS 入口，无需额外公网游戏端口。现有容器资源限制只是初始值，尚未用真实玩家流量测试。

验收方法和边界见 [Windows 联机测试](WINDOWS-TEST.md)。
