# joincraft · 网页版与后端

房间为核心的 MC 联机工具，当前已接入持久化后端。技术栈：**Node.js 24 LTS + Fastify 5 + TypeScript + SQLite + WebSocket**（保留 SSE 兼容）。

## 启动

```sh
git clone https://github.com/GMCXUE/joincraft.git
cd joincraft
npm ci
npm start
```

打开 http://127.0.0.1:4180 。默认只监听本机。`npm start` 自动编译 TypeScript；配置参考 `.env.example`。

## 好友与聊天

点击外栏最上方的手柄进入好友列表 / 好友申请 / 私聊。注册账号后，按用户名添加好友，对方接受后即可聊天。消息实时同步、持久保存，支持未读提示、历史分页和失败重试。好友聊天为一对一文字消息；房间内另有群聊与独立语音分组。暂无文件发送或端到端加密。

## 房间体验

点击左侧「＋」输入 6 位房间号及可选密码，或者切换到创建房间。房间支持图片、名称、成员、游戏环境和房主设置。无需审批；加入成功后显示在左侧列表。邀请窗口的“以访客身份打开”可模拟第二个玩家。

房间与成员保存在 `data/blockroom.sqlite`，服务重启不会清空。点击最左侧底部头像可以注册、登录和退出。账号支持跨浏览器登录；访客可注册并保留原房间。WebSocket 直接推送消息、成员及设置变更，支持发送确认、重连补拉和去重；旧 SSE 入口保留兼容。

账号登录使用用户名和密码，网页版以 HttpOnly Cookie 保持登录。未注册访客仍依赖原设备会话，建议注册保留房间。暂未提供密码找回，也不等同于微软 / MC 账号认证。游戏版本和端口可保存，Java 联机中继与本地连接脚本已实现；已加入 Electron 本机游戏库、Joincraft 自有实例、整合包安装和 Java 检测；Windows exe / macOS dmg + zip 构建配置及客户端更新已接入；正式签名发布与跨版本实机升级待验收。真实游戏、Windows 和异地网络测试尚未执行。

## 房间语音

默认只有「游戏」一个语音分组，房主可创建、重命名和删除额外分组。各组独立通话；房间文字聊天共用。点击分组先收听，点击麦克风后授权发言。支持静音、关闭收听、设备选择、成员音量、说话指示和房主语音管理，不提供视频或屏幕共享。

本地需要 Docker：运行 `npm run voice:up`，再按 `.env.example` 开启三个 `LIVEKIT_` 配置并运行 `npm start`。语音不依赖 MC 启动，测试房间即可使用。详情见 [语音开发与测试](docs/VOICE.md)。

## 客户端更新

桌面客户端右上角「通知」铃铛提供更新入口，新版本进入软件时提醒一次，同版本重启不重复提醒；普通网页端不显示更新功能。支持检查、下载进度、取消 / 重试和确认后重启安装。游戏运行时可下载，安装需先退出游戏。稳定版本从 `https://www.joincraft.top/updates/` 获取；开发模式不会下载更新。

已提供 Windows NSIS exe、Mac dmg + zip 打包配置，以及手动构建安装包的 GitHub Actions 工作流。Mac 正式自动更新需要签名和公证。详见 [客户端更新与发布](docs/CLIENT-UPDATES.md)。

## 验证与运维

```sh
npm test
npm run typecheck
npm run backup
```

347 项自动化测试（另有真实 SFU 音频集成测试）覆盖房间、账号、聊天、持久化、联机中继及启动器模拟流程。测试不接触本地真实数据。线上服务已部署至 https://www.joincraft.top/，使用独立 Nginx 反代，部署说明见 [生产部署](docs/DEPLOYMENT.md)。

[后端技术方案与 API](docs/BACKEND.md) · [功能清单](docs/FEATURES.md) · [设计约束](DESIGN.md)

### 前端组件与样式

使用 Web Awesome 的 Avatar、Badge、Button 和 Tooltip，按需打包到本地 `public/ui.js`、`public/ui.css`，无需运行时 CDN。`npm run build` 同时编译后端与组件；仅修改组件入口时可执行 `npm run build:ui`。Docker 构建阶段也会生成这两个文件。

`public/style.css` 为已有页面结构，`public/polish.css` 统一当前视觉层级、组件主题及响应式细节。`frontend/components.js` 集中管理组件导入；方向与控件尺寸记录在 `DESIGN.md`。聊天使用连续消息分组、自适应输入框、空内容禁用发送，并保留原有草稿与历史记录机制。

## Java 版开房（v0.8）

房间概览新增「开始联机」：房主开放 MC 局域网，填写端口，下载并运行页面给出的一次性连接指令。成员加入房间后点击「连接游戏」，运行自己的连接程序，在 MC 中输入显示的本机地址。世界在房主电脑运行，服务端只转发 TCP。

VPS HTTPS / WSS 中继已部署，公网 Java 状态查询和 64 KiB 双向数据模拟通过；尚未做真实 MC 或 Windows 实机测试。具体准备、步骤与验收项见 [Windows 联机测试](docs/WINDOWS-TEST.md)。

`npm test` 包括原有业务测试和 `relay.test.mjs` 的实际 loopback TCP / WebSocket 转发检查。

## 客户端游戏库（v0.9.31）

本机游戏库仅管理 Joincraft 自有实例，支持含 Modrinth 清单的 ZIP / mrpack 安装、模组管理、Java 与资源校验、离线玩家和微软账号流程。PCL 外部目录已退出当前管理范围。`npm run desktop` 打开桌面开发版，`npm run preview:launcher` 打开明确标记的模拟页面（4188）。正式微软登录需要自己的应用 Client ID，当前未配置或进行真实登录。

当前使用方式见 [模组管理](docs/MOD-MANAGEMENT.md)；[PCL 直启说明](docs/PCL-LAUNCHER.md) 为历史方案。源码回归 347 项与实际包内 126 项客户端测试通过，真实 MC 与 Windows 操作仍需实测。

系统名称统一为 `joincraft`。为兼容已有数据，数据库文件名、Cookie、本地存储键、桌面配置目录与 `BLOCKROOM_*` 环境变量保持原值；连接程序改为 `joincraft-bridge.cjs`，旧下载地址继续可用。


Windows 官网提供 EXE 安装程序，自动创建快捷方式；后续通过客户端铃铛下载并重启更新，用户无需解压 ZIP 或重新运行安装向导。已有 0.9.4+ 客户端可直接应用内更新，详见 [客户端更新](docs/CLIENT-UPDATES.md)。开发机使用 Node.js 24 和 Go 1.25+，`npm run dist:win` 构建首次安装程序与应用内更新包。

官网入口为 `/`，Web 联机界面入口为 `/app/`。本地运行后可打开 `http://127.0.0.1:4180/` 查看官网，进入 Web 版后使用已有登录、好友与房间功能。首页背景已本地压缩并自托管，标题字体保留 OFL 许可；`npm run build:home` 可从设计源图重新生成 WebP。

客户端模组管理：参阅 [使用与数据说明](docs/MOD-MANAGEMENT.md)、[0.9.31 验收记录](docs/releases/2026-11-14-mod-management.md) 和 [Windows 实测清单](docs/WINDOWS-TEST.md)。网页不管理本机文件，CurseForge 接入暂缓。
