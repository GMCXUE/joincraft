# joincraft · 网页版与后端

房间为核心的 MC 联机工具，当前已接入持久化后端。技术栈：**Node.js 24 LTS + Fastify 5 + TypeScript + SQLite + SSE**。

## 启动

```sh
git clone https://github.com/GMCXUE/joincraft.git
cd joincraft
npm ci
npm start
```

打开 http://127.0.0.1:4180 。默认只监听本机。`npm start` 自动编译 TypeScript；配置参考 `.env.example`。

## 好友与聊天

点击外栏最上方的手柄进入好友列表 / 好友申请 / 私聊。注册账号后，按用户名添加好友，对方接受后即可聊天。消息实时同步、持久保存，支持未读提示、历史分页和失败重试。仅支持好友间一对一文字聊天，暂无群聊、文件、语音或端到端加密。

## 房间体验

点击左侧「＋」输入 6 位房间号及可选密码，或者切换到创建房间。房间支持图片、名称、成员、游戏环境和房主设置。无需审批；加入成功后显示在左侧列表。邀请窗口的“以访客身份打开”可模拟第二个玩家。

房间与成员保存在 `data/blockroom.sqlite`，服务重启不会清空。点击最左侧底部头像可以注册、登录和退出。账号支持跨浏览器登录；访客可注册并保留原房间。SSE 实时同步成员与设置，不再固定轮询。

账号登录使用用户名和密码，网页版以 HttpOnly Cookie 保持登录。未注册访客仍依赖原设备会话，建议注册保留房间。暂未提供密码找回，也不等同于微软 / MC 账号认证。游戏版本和端口可保存，Java 联机中继与本地连接脚本已实现；已加入 Electron 本机游戏库、PCL 已安装实例直启与 Java 检测（模拟测试阶段）；Windows exe / macOS dmg 打包尚未实现。真实游戏、Windows 和异地网络测试尚未执行。

## 验证与运维

```sh
npm test
npm run typecheck
npm run backup
```

38 项测试覆盖房间、账号、聊天、持久化、联机中继及启动器模拟流程。测试不接触本地真实数据。Docker 与 Kubernetes 部署示例已提供，本轮未部署 VPS。

[后端技术方案与 API](docs/BACKEND.md) · [功能清单](docs/FEATURES.md) · [设计约束](DESIGN.md)

### 前端组件与样式

使用 Web Awesome 的 Avatar、Badge、Button 和 Tooltip，按需打包到本地 `public/ui.js`、`public/ui.css`，无需运行时 CDN。`npm run build` 同时编译后端与组件；仅修改组件入口时可执行 `npm run build:ui`。Docker 构建阶段也会生成这两个文件。

`public/style.css` 为已有页面结构，`public/polish.css` 统一当前视觉层级、组件主题及响应式细节。`frontend/components.js` 集中管理组件导入；方向与控件尺寸记录在 `DESIGN.md`。聊天使用连续消息分组、自适应输入框、空内容禁用发送，并保留原有草稿与历史记录机制。

## Java 版开房（v0.8）

房间概览新增「开始联机」：房主开放 MC 局域网，填写端口，下载并运行页面给出的一次性连接指令。成员加入房间后点击「连接游戏」，运行自己的连接程序，在 MC 中输入显示的本机地址。世界在房主电脑运行，服务端只转发 TCP。

当前仍为本地开发服务，异地测试前需要部署 VPS HTTPS / WSS 中继。本次按用户要求只完成协议模拟、自动化和网页流程验证，未做真实 MC 或 Windows 实机测试。具体准备、步骤与验收项见 [Windows 联机测试](docs/WINDOWS-TEST.md)。

`npm test` 包括原有业务测试和 `relay.test.mjs` 的实际 loopback TCP / WebSocket 转发检查。

## PCL 整合包直启（v0.9）

本机游戏库支持选择已安装 PCL 目录、版本隔离、Java 与资源校验、离线玩家和微软正版账号接入。`npm run desktop` 打开桌面开发版，`npm run preview:launcher` 打开明确标记的模拟页面（4188）。正式微软登录需要自己的应用 Client ID，当前未配置或进行真实登录。

完整说明、Windows 操作和验证边界见 [PCL 直启说明](docs/PCL-LAUNCHER.md)。本轮共 38 项自动化测试通过，其中 15 项为新增启动器模拟；不代表 Windows 或真实 MC 已测试。

系统名称统一为 `joincraft`。为兼容已有数据，数据库文件名、Cookie、本地存储键、桌面配置目录与 `BLOCKROOM_*` 环境变量保持原值；连接程序改为 `joincraft-bridge.cjs`，旧下载地址继续可用。
