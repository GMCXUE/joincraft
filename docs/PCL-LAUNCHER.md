# PCL 已安装整合包直启 · v0.9

这版通过本机 Electron 客户端读取 PCL 已安装的版本文件，生成 Java 参数并直接启动 Java，不执行 PCL.exe、LatestLaunch.bat 或整合包附带的启动脚本。VPS 只提供房间、聊天和联机中继，不读取玩家磁盘或运行玩家的游戏。

## 现在怎么看

```sh
cd joincraft
npm ci
npm run preview:launcher
```

打开 http://127.0.0.1:4188/。顶部明确标记「模拟测试」，实例、账号、文件数、启动和退出状态均为测试数据。所有按钮只演示交互，不读真实整合包、不启动 Java、不请求微软登录。该预览脚本不打包进 VPS 的静态资源。

实际桌面开发入口为 `npm run desktop`。房间服务独立运行 `npm start`（Node 24），桌面游戏库通过「返回房间」打开该服务，房间标题栏「游戏库」返回本机窗口。服务器不可用不影响本机游戏库。普通浏览器中的游戏库只展示入口说明，不能运行本机进程。

## Windows 实测步骤（待用户执行）

1. 在 Windows 安装 Node 24，复制项目源码后执行 `npm ci`。不要复制 macOS 的 `node_modules`；Electron 运行时随当前平台安装。
2. 用 `npm run desktop` 打开joincraft，选择 PCL 所在目录、`.minecraft`、`versions` 或具体版本目录。这里不需要打开 PCL 启动器。首次识别失败时会展示具体版本错误。
3. 选择实例，检查「游戏目录」是否与 PCL 原实例一致。识别到 `PCL/Setup.ini` 的版本隔离设置时沿用；独立目录中已有模组或存档时使用独立目录；无法确定时必须手动选择，不猜测全局设置。不会移动、复制或删除 mods、config、saves。
4. 点击「选择 Java」，选择匹配版本的 `bin/java.exe`，或 `javaw.exe`（会使用同目录 java.exe）。显示的 Java 版本必须满足实例要求，架构与客户端一致。Java 路径、游戏目录及常用启动选项会记住。
5. 离线启动填入原玩家名；正版启动需先完成下述应用配置，再通过微软授权页登录。joincraft账号与游戏账号互相独立。
6. 点击「检查文件」，确认资源、依赖和 Java 通过。缺文件时先用 PCL 修复；当前不提供下载、更新或安装整合包。
7. 点击「启动游戏」，观察游戏主菜单是否正常；界面仅显示 Java 进程状态，不把“进程已启动”当成已经进入游戏。退出后允许再次启动；失败时查看实例 `logs/latest.log`。
8. 打开已有世界，核对模组、配置和存档。游戏直启不自动开放局域网：进入世界后仍需「对局域网开放」，再按 [Windows 联机测试](WINDOWS-TEST.md) 接通本机桥接和中继。

建议首次实测使用已有整合包的副本。离线 UUID 使用 Java 标准的 `OfflinePlayer:<玩家名>` 算法；若原 PCL 配置手动指定了不同离线 UUID，背包身份可能不同，这版不导入 PCL 的自定义离线 UUID。

## 微软正版配置

开发者需要注册**自己的** Microsoft 公共客户端应用，支持个人微软账号和 Device Code Flow，并确保应用具有 Minecraft 服务要求的访问资格。不得借用 PCL 或其他启动器的 Client ID、缓存或令牌。授权链实现不等于应用已获得微软/Minecraft 接入资格。

Windows PowerShell：

```powershell
$env:BLOCKROOM_MICROSOFT_CLIENT_ID = "你自己的应用 Client ID"
npm run desktop
```

`BLOCKROOM_SERVER_URL` 可指定已部署的房间服务 HTTPS 地址；未配置时使用 `http://127.0.0.1:4180/`。生产构建需注入自己的客户端配置，不要求终端玩家填写开发者参数。当前没有 Client ID 时，界面明确提示未配置并禁用正版登录。

登录流程：MSAL 设备码 → Microsoft access token → Xbox Live → XSTS → Minecraft access token → Java 游戏档案。没有有效 Java 档案、Xbox 权限不足或授权刷新失败时阻止启动，不自动改为离线模式。令牌只存在主进程内存中，不写配置、不发到 VPS、不暴露给 renderer；关闭客户端后需要重新登录。游戏进程按 Minecraft 协议在参数中收到令牌，因此只应启动用户信任的实例。

参考：[MSAL Node token requests](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests)、[XMCL MicrosoftAuthenticator](https://xmcl.app/en/core/user/MicrosoftAuthenticator)。本轮仅用假的 HTTP 响应测试，**没有验证真实微软应用注册、授权或游戏账号**。

## 支持边界

- 使用 XMCL Core 2.15.1 处理版本规则、继承与启动参数；覆盖标准原版、Fabric、Forge、NeoForge 格式，以及 PCL 将版本合并到单个 JSON/JAR 的情况。并不保证所有自定义整合包兼容。
- 处理 PCL `VersionArgumentIndieV2`、旧版 `VersionArgumentIndie` 和独立目录证据。无法读取外部全局配置时让用户明确选择目录。
- 检查主 JAR、依赖、资源索引及资源对象、日志配置；带 SHA-1 的文件校验内容。缺失或损坏则停止，不联网下载。
- 原生库从已安装 JAR 解压到joincraft本次启动的缓存目录，游戏结束后清理，不改写 PCL 的原生库目录。
- 对不支持的参数占位符、额外版本补丁、检测到的 PCL 自定义 JVM/游戏/前置脚本/认证配置明确阻止启动。PCL 全局内存、特殊启动参数与第三方认证不自动继承。
- 不实现整合包下载/升级、自动选择 Java、第三方认证服、自动开 LAN、自动安装 Mod、游戏崩溃修复。本版还没有生成 exe / dmg 安装包。
- 桌面窗口采用 sandbox、contextIsolation，renderer 只能通过白名单 IPC 操作主进程。只有本地打包页面能选目录、选 Java 和启动；远程房间窗口仅能请求显示本机游戏库。

## 测试范围与实际边界

`npm run test:launcher` 运行独立模拟测试，`npm test` 包括房间、账号、聊天、中继和启动器回归。启动器测试使用临时版本树、假的 JAR/DLL、假的微软响应和替代的 spawn；校验、继承、参数生成及原生库解压执行真实实现，但不执行 Java 或游戏。

覆盖 Windows 平台规则与分号 classpath、含中文/空格的路径、Legacy Forge 参数继承、NeoForge 与合并版本、版本隔离、缺文件/坏哈希/资源越界、Java 版本/架构、离线 UUID、正版授权链/刷新/退出、进程失败/退出/重复启动及不回退离线。macOS 上的 Windows 模拟参数仍指向本机临时测试目录；真实 Windows 路径和原生 JVM 必须实机验证。

依赖固定 Core 2.15.1，避免本轮安装时新版传递依赖中发布的 `workspace:^*` 阻断 npm 安装。后续升级须重新跑启动器测试。版本解析参考 [XMCL LaunchOption](https://xmcl.app/en/core/core/LaunchOption) 与 [PCL ModMinecraft.vb](https://github.com/Meloong-Git/PCL/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModMinecraft.vb)。

本轮还打开了真实 Electron 空游戏库，验证了本地 IPC 初始化以及「游戏库 → 房间 → 游戏库」切换；仅使用临时应用配置，未选择或启动真实游戏。浏览器模拟页检查了离线启动/退出、正版模拟授权/退出、文件检查、缺失配置状态与窄屏布局。
