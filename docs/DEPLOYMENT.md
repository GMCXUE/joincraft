# Joincraft 生产部署（2026-11-12）

正式入口： https://www.joincraft.top/ 。Windows 0.9.1 默认连接此地址，更新源为 `/updates/`。

## 流量路径

公网 443 → 现有 Caddy（HTTPS 证书自动续期）→ 独立 joincraft-nginx:8080 → Node/Fastify 172.18.0.1:4180。Nginx 提供应用反代、WebSocket 长连接及更新文件；Caddy 保留此前项目的域名和 IP 路由。没有抢占已有项目的 80/443。

语音信令经过同一 HTTPS/WSS 入口及应用权限网关，LiveKit API 仅监听 127.0.0.1:7890。媒体使用 TCP 7891、UDP 7892；RTC 公布地址为 121.43.102.154，并通过 `rtc.interfaces.includes: [eth0]` 排除 EasyTier / Docker 网卡。不要向公网暴露 7890。

本轮未修改安全组或主机防火墙。公网浏览器合成音频已成功收发和解码，未使用麦克风。若后续要只允许 443，需额外配置 TURN/TLS 与同端口协议分流；当前尚未配置 TURN，不承诺所有受限网络都能通话。

## 服务与文件

- systemd：`joincraft.service`，账号 `joincraft`，内存上限 384 MiB。
- Node 24：`/opt/joincraft/runtime`；当前后端链接 `/opt/joincraft/current`。
- 数据库：`/var/lib/joincraft/blockroom.sqlite`；配置 `/etc/joincraft/app.env`（600）。
- 语音：`joincraft-livekit`，LiveKit v1.13.11，host 网络，内存上限 256 MiB。
- 代理：`joincraft-nginx`，内存上限 64 MiB；配置 `/opt/joincraft/nginx.conf`。
- Compose：本仓库 `deploy/production/compose.yaml`，依赖既有 `remotescreen_remotescreen` 网络。
- Caddy 配置：`/opt/remotescreen/deploy/prod/Caddyfile`。
- 更新资产：`/var/lib/docker/volumes/remotescreen_caddy_data/_data/joincraft-releases`；Nginx 只读挂载。
- 旧临时域名 `joincraft.121.43.102.154.sslip.io` 保留更新目录供早期客户端使用，其余请求跳转正式域名。

所有密钥仅存在 VPS 配置中，不提交仓库、不放入安装包。Nginx 访问日志使用不带查询串的 `$uri`，避免记录语音 JWT。

## 发布与回滚

后端发布前运行 `scripts/backup.mjs` 备份 SQLite（不能直接复制活动 WAL 数据库），将应用构建上传新目录后再切换 current 并重启服务；故障时切回旧链接。涉及数据库迁移时必须同时评估备份恢复，不自动覆盖用户新数据。

本轮备份位于 `/opt/joincraft/backups/`，包括 `before-domain-0.9.1.sqlite`、原始 Caddy 配置、域名切换前配置和更新清单。对其他站点配置只做精确块替换，禁止按标记截断整个文件。

客户端发布先校验并上传不可变版本资产，最后原子替换 latest.yml；见 CLIENT-UPDATES.md。0.9.1 是未签名 Windows x64 测试安装包，尚未执行 Windows 实机安装与跨版本升级。

## 验证记录

- HTTPS 健康检查、登录入口、房间创建/加入与聊天通过。
- 公网 WSS 中继通过 Java 状态查询和 64 KiB 数据往返测试；没有启动真实 Minecraft。
- 浏览器通过线上信令及公网媒体端口传输合成音频，接收端检测到非零解码波形。测试页仅在本地 loopback 暴露，测试房间关闭、临时会话退出。
- 本机 rtc-node 对生产域名的原生 TLS 握手失败，因此 scripts/deployment-smoke.mjs 的原生音频部分未通过；浏览器验证补充了媒体证据，不能把该脚本宣称为全绿。
- 原有 Pulse 与 RemoteScreen 路由保留。

端口说明：https://docs.livekit.io/transport/self-hosting/ports-firewall/


## 2026-11-12 · 0.9.3 界面发布
服务端静态资源发布至 `/opt/joincraft/releases/0.9.3-20261112-ui`，由 0.9.2 密码策略版本复制，仅更换 index、app、social、polish、type、desktop-notifications 六个静态文件；保留后端和数据库。回滚目标为 `/opt/joincraft/releases/0.9.2-20261112-password`。

Windows 0.9.3 包包含单窗口游戏库、应用内通知和安装确认，以及 PCL 离线名/Java 自动扫描。NSIS 包未签名，Windows 实际安装和真实游戏启动需用户实测；本地回归 68 项通过，应用内安装确认使用模拟更新验证。


## 2026-11-12 · Windows 0.9.4 免安装更新
Windows 改为完整 ZIP 与签名清单 windows-x64.json，客户端自带 Go 更新助手。旧 NSIS latest.yml 保留 0.9.3，不自动引导失败的安装流程；首次迁移手动解压新版。更新签名私钥仅在开发机项目外保存，VPS 只保存已签署的清单和 ZIP。具体恢复边界见 CLIENT-UPDATES.md。

最终 ZIP 大小 163554672 字节，SHA-256 `03bcbaaa29bf0387048558769f95f09cecca0075d7a81a25e05d333cf9e6d170`。正式域名下签名清单及完整 ZIP、Range、新客户端检查与旧 NSIS 清单均验证通过。


## 2026-11-12 · 0.9.5 品牌图标
新增 J/C 联结图标：Windows ICO、macOS ICNS、窗口 PNG，以及网站 SVG/ICO favicon、Apple Touch 和 Web App Manifest。网站发布目录 `/opt/joincraft/releases/0.9.5-20261112-brand`，基于 0.9.3，仅添加静态图标路由与品牌资源；回滚到 `/opt/joincraft/releases/0.9.3-20261112-ui`。静态资源内部健康检查须带 `Host: www.joincraft.top`，健康接口本身允许内部 Host。

Windows ZIP 为 `joincraft-0.9.5-win-x64.zip`，大小 163552119 字节，SHA-256 `64e664c1ec078a1abc3e827198f77da8366d7ebe2d50d51035aeeed03cfcbf08`。通过签名清单向 0.9.4 提供更新，旧 NSIS 渠道仍停留在 0.9.3。macOS 图标资源已生成，本轮未发布 DMG。图标格式、打包内容、网站路由及 390px/桌面布局均已验证。

## 2026-11-12 · 0.9.6 内存配置
Windows 客户端新增自动/自定义内存、实时本机统计和启动前重新评估。依用户反馈，图表改为单条深浅蓝分段预览，标签和数值对齐分界；窄窗口校验无横向溢出。网站服务未改动。本地 4189 模拟预览已更新，数据标为模拟。

81 项回归测试通过；本机隔离 Electron 验证了真实系统统计 IPC，Windows 未启动真实游戏。最终 ZIP 为 joincraft-0.9.6-win-x64.zip，163556480 字节，SHA-256 d096766eda5f12ca797210a9a4d27881e609eaf7fbcb1b3460cc5b18c79c1efa。已验证正式域名的签名清单、完整 ZIP 和 0.9.5 → 0.9.6 更新提示。

## 2026-11-12 · 0.9.7 内存栏主题色
将单条内存栏统一为绿灰配色：已用 #647B52、分配沿用品牌绿 #94CC56、剩余 #343B31。仅调整样式和客户端版本，逻辑沿用 0.9.6。本地预览和打包内容已验证。ZIP 大小 163556526 字节，SHA-256 fda9b9e3566427e9fd8208cbe45ada3b5565f95f628b8e07a8ccf6562537cb27。

## 2026-11-12 · 0.9.8 官网首页
用户确认视觉稿后上线明亮 MC 方块浮岛首页，根路径为官网，/app/ 为 Web 应用。发布目录 `/opt/joincraft/releases/0.9.8-20261112-home`，回滚目录 `/opt/joincraft/releases/0.9.5-20261112-brand`，数据库与账号策略未改动。旧 joincraft Electron UA 的根路径继续返回应用 HTML；这是公开页面兼容分流，不是权限控制。旧 hash/邀请链接自动跳至 /app/。

背景 WebP 为 161206 字节，标题字集字体为 2408 字节，本地保存字体许可与设计源图。网站仅两个主要操作，桌面/手机、Web 跳转、旧链接、字体/CSP与全部静态资源校验已完成。83 项回归测试通过，隔离 Electron 验证客户端直接进入 /app/#friends。

Windows 0.9.8 ZIP 为 163556404 字节，SHA-256 ef62ca99858d8d1ee60c0cf5c35ddf8ffa9292647cdbb1308d0e369f25e63777。官网 /downloads/client/windows 跳至 /updates/joincraft-windows-x64.zip，发布脚本更新相对符号链接，确保始终下载最新完整 ZIP；签名清单与完整稳定下载已从正式域名验证。后续请使用 deploy/production/publish-bundle.mjs，避免仅更新清单而遗漏官网别名。

## 2026-11-12 · 0.9.9 自动内存语义修正
按用户明确要求，自动配置改为全部当前系统可用内存，取消自动预留、256 MB 向下取整及 8 GB/总量一半/32 GB 限制。自定义设置沿用原范围。启动前重新读取，游戏运行后上限固定；仍以 Java 堆上限表达而非立即物理占用。83 项回归测试通过，包含不对齐内存、超过 32 GB 的自动值、512 MB 边界和启动前压力变化。

已发布 Windows ZIP 163556443 字节，SHA-256 d2fe0146c889c083ef4e2426cb73747e7352de12ea9b8fb82543d8aee990af3e，稳定下载别名同步更新。网站与服务端进程未重启。


## 2026-11-12 · 0.9.10 Windows installer
The official download route /downloads/client/windows now redirects to /updates/joincraft-setup.exe. Versioned installer: joincraft-0.9.10-win-x64-setup.exe, 127507846 bytes, SHA-256 42356bb778647d2b725669ebee47f32dbc9580e4f1235450c6f2fe34514dcbce. Chinese NSIS, per-user installation, selectable directory, desktop/start-menu shortcuts and system uninstall entry. Authenticode signing is not configured.

Existing clients continue using the Ed25519-authenticated ZIP feed windows-x64.json. The 0.9.10 ZIP is 163557561 bytes, SHA-256 8787a15fc187c01433992b946000174b22314c79ed1814d98e4293041905f3e7. Legacy NSIS latest.yml remains at 0.9.3. The publisher now verifies and publishes both artifacts before switching the signed update feed. Backend release: /opt/joincraft/releases/0.9.10-20261112-installer; rollback: /opt/joincraft/releases/0.9.9-20261112-login. Only the download redirect and homepage copy changed on the backend.

Validation: 85 Node tests, Go updater tests and Windows cross-vet passed. The installer and update ZIP contain identical release marker, executable, app.asar and helper; a real NSIS uninstaller is embedded. The Go helper validated and extracted the actual ZIP. Both artifacts were signature/checksum verified on the VPS; the complete official EXE download was also verified through public HTTPS. Actual Windows install, uninstall and uninstall after an in-app update remain for device testing.


## 2026-11-12 - MC pixel display typography
Public home and login illustration headings now use a renamed Ark Pixel Font subset (release 2026.11.10, SIL OFL). The 1504-byte WOFF2 and license are self-hosted at /home/pixel-display-v1.woff2 and /home/pixel-font-license.txt. Updated CSS uses integer 12px-grid display sizes, positive desktop tracking, zero phone tracking, forest text and a warm light pixel edge. Desktop, 900px narrow layout and 390px phone layout were visually checked; public HTTPS font bytes and homepage/login preload references were verified. Existing auth/homepage integration tests passed. The installer download remains unchanged. Backend release /opt/joincraft/releases/0.9.10-20261112-pixel-type; rollback /opt/joincraft/releases/0.9.10-20261112-installer. No desktop binary or update feed change.


## 2026-11-12 - Selected Fusion Bold font and slogan
User-selected option A (Fusion Bold Pixel) is now applied to the public home and login illustration headings. The chosen slogan is split into two phrases. Page title, description and Open Graph title were updated to match. The renamed 1312-byte font subset is self-hosted at /home/pixel-display-v2.woff2, with aggregate SIL OFL and upstream component notices at /home/pixel-bold-font-license.txt. Historical font URLs remain unchanged and checksum verified.

Desktop 1280x800 and phone 390x844 layouts were visually checked; the phone headline stays on two lines with no horizontal overflow. TypeScript/UI build and the existing homepage/login integration checks passed. Public HTTPS pages, font checksums/immutable headers and the Windows EXE download redirect were verified. Backend release: /opt/joincraft/releases/0.9.10-20261112-fusion-slogan. Rollback: /opt/joincraft/releases/0.9.10-20261112-pixel-type. No desktop artifact or update feed changes.


## 2026-11-13 - Pixel wordmark / Windows 0.9.11
The lowercase wordmark now uses outlined Fusion Bold Pixel geometry (viewBox 57 x 13) while retaining the existing green J/C symbol and app icon. Home, login, room and local library headers share the same SVG; native compact sizing and light/dark colors were visually checked in the browser. The standalone master and full font notices are served at /brand/wordmark-pixel-v1.svg and /brand/wordmark-license.txt. The wordmark does not depend on font loading.

85 Node tests passed. Both real Windows artifacts were signature/checksum verified; their marker, executable, app.asar and update helper match. Packaged library SVG, master SVG, font notices and version were inspected, and the Go helper validated/extracted the complete update ZIP. Website headers and the complete installer were verified through public HTTPS; the signed in-app feed advances 0.9.10 to 0.9.11. Legacy NSIS latest.yml remains at 0.9.3. Actual Windows execution was not performed on this Mac.

Installer: joincraft-0.9.11-win-x64-setup.exe, 127510134 bytes, SHA-256 c363c597c147de36f9218d28a83ef6789bcbd678811dc3eb5fad5ad8c1ac89eb. Update ZIP: joincraft-0.9.11-win-x64.zip, 163560780 bytes, SHA-256 971a524cf2842fb35caa7f8c76ebf69bc39e9b4f25c7fb054535a667db5f0134. Authenticode signing remains unconfigured. Backend release: /opt/joincraft/releases/0.9.11-20261113-wordmark; rollback: /opt/joincraft/releases/0.9.10-20261112-fusion-slogan.


## 2026-11-13 · 0.9.12 Pixel interaction theme
Shared stylesheet and self-hosted UI font are served through explicit routes and included in local Electron surfaces. Backend release: /opt/joincraft/releases/0.9.12-20261113-pixel-ui; rollback: /opt/joincraft/releases/0.9.11-20261113-wordmark. No database, ingress, firewall, game relay or voice changes.

Installer: joincraft-0.9.12-win-x64-setup.exe, 127747750 bytes, SHA-256 1e5d5b39ca92995a5b514cac9d2dbc1e8844e0bcc1d07253b9e722042decc9dd. Update: joincraft-0.9.12-win-x64.zip, 163798713 bytes, SHA-256 d5d22344a254f0c9cdbb746a713a7ed04f18d77f1f3d6ef69c8a8a39a738702b. Signed feeds use the same Ed25519 key; legacy NSIS latest.yml remains unchanged.

Public verification: all four page entries include the new stylesheet, the 234,028-byte WOFF2 matches the packaged source and is served as font/woff2 with immutable caching, old Electron root navigation still receives the app, signed feeds offer 0.9.12, the full public installer matches its signed SHA-512, and health checks pass. Online 1280px room dialog rendered with the loaded font and 4px corners; no horizontal overflow.


## 2026-11-13 · Personal pages and creature avatars
Release: /opt/joincraft/releases/20261113-profiles. Desktop room views use these hosted assets, so the Windows installer/feed remains at 0.9.12; a reload/reopen receives the feature. No local launcher, updater, ingress, firewall or media configuration changes.

Schema 5 adds user_profiles only. Before switching, create a consistent SQLite backup and an old-UI rollback release at /opt/joincraft/releases/0.9.12-20261113-profile-rollback containing the schema-5-capable Store. Rollback must use that compatibility release because old Store builds intentionally reject newer database versions. Keep the original 0.9.12 release untouched.

Validation: 85 existing regression tests and 7 profile tests pass, including migration from a real v4 database, atomic validation, self/related-player visibility, room privacy and avatar propagation. Local browser checks cover save/cancel, live preview, preserving a draft under SSE, correct message-avatar profile links, and a 390px editor without horizontal overflow. Screenshots use synthetic local accounts and rooms only.

Production verification passed: both new and schema-compatible rollback code completed in-memory CRUD checks on VPS Node 24, the live database migrated to v5, backup mode is 0600, all 10 SVGs and six JS/CSS assets match local bytes over public HTTPS, old Electron entry routing remains compatible, and the signed update feed remains at 0.9.12. Online guest-mode personal page and editor loaded all ten portraits without horizontal overflow. No synthetic biography or account credentials were saved to production profiles.


## 2026-11-13 · 0.9.13 Quiet pointer focus
Release: /opt/joincraft/releases/0.9.13-20261113-focus; rollback: /opt/joincraft/releases/20261113-profiles. Only shared focus CSS/JS, imports and its exact static route change. No schema, account, tunnel or voice behavior changes.
Installer: joincraft-0.9.13-win-x64-setup.exe, 127747695 bytes, SHA-256 93c5553f675d8701fa6ffae818d80e574817b8e3cf9925705a30284fb2b19759. Bundle: joincraft-0.9.13-win-x64.zip, 163798868 bytes, SHA-256 3c79c0482f1cdec14d726d02ec305a900db2c79b0bbf8eee5b36d2bdf6386f59. Existing signed release key and updater flow remain in use.

Public verification passed: focus.js/CSS and the existing font match local bytes over HTTPS, signed feeds offer 0.9.13 to 0.9.12 clients, the full installer download matches signed SHA-512, legacy latest.yml remains 0.9.3, and health/legacy routing pass. The online focused room-code input reports pointer mode, ordinary rgb(83,97,75) border and outline:none; the local friend dialog, login page and library show the same behavior. Tab/Shift+Tab retains a visible keyboard focus.

Main application title now reads exactly joincraft (2026-11-13). Updated only the served HTML title atomically; existing desktop root and /app/ routes were verified over public HTTPS. No service restart or new client package was needed for the title update.

## 2026-11-13 · 0.9.14 客户端浏览器登录
网站与后端：`/opt/joincraft/releases/0.9.14-20261113-browser-login`；前版 `/opt/joincraft/releases/0.9.13-20261113-focus` 可用于回滚。SQLite schema 5 未变；没有新增端口、修改 TLS、反向代理或其他项目。最终发布文件哈希保存在当前发布目录 `release-hashes.json`。

客户端已发布 EXE `joincraft-0.9.14-win-x64-setup.exe`（127750045 bytes，SHA-256 `ce684576644fbbdc49805973f31eda44c1292adc4f9c2e14b82c722f4eb02bae`）与应用内 ZIP `joincraft-0.9.14-win-x64.zip`（163800617 bytes，SHA-256 `f790393ede5d450e63f2fb461e8205957b98211e4a55eb313617cede5f77f0d7`）。保持稳定安装程序下载、两个签名清单与原有更新机制；旧 NSIS latest.yml 继续固定 0.9.3。

验证：100 项自动测试通过；签名、SHA-512、安装与更新包核心文件一致、Go 更新器实际解包通过。Mac Electron 在隔离配置下实测系统 Chrome 账号密码登录、恢复昵称/头像/好友/房间、退出客户端后网页账号仍可确认，以及网页取消同步关闭等待弹层。桌面及 390px 页面通过视觉检查。公网 HTTPS 已核对页面字节和浏览器临时 Cookie 的 Secure / HttpOnly / SameSite、账号授权要求、浏览器绑定、错误 verifier、跨站拒绝与取消；未在 Windows 实机运行。


## 2026-11-13 - 0.9.15 Interaction refinement
Release: /opt/joincraft/releases/0.9.15-20261113-ux; rollback: /opt/joincraft/releases/0.9.14-20261113-browser-login. SQLite schema 5 is unchanged. Existing HTTPS, reverse proxy, firewall, game relay and voice service configuration are unchanged. Exact overlay hashes are recorded in release-hashes.json.

Profile editing now uses two columns on wide screens, preserves in-memory drafts for the current account session and disables saving until a field changes. Shared chat anchoring keeps the visible message in place while paging history, preserves historical reading on incoming messages, and adds a return-to-latest control. Loading errors can retry in place. Forms use inline validation and pending-state protection, including explicit length checks for autofilled values; six-digit room codes can be pasted from invitation links. Mobile room initials and voice groups are more compact. Local launcher controls explain unmet Java/account/memory prerequisites.

Validation: 107 automated tests passed, including seven interaction tests. Browser checks covered profile save/cancel/draft restoration, invitation paste, historical paging (same-message offset difference below one pixel), incoming messages without scroll interruption, message sending, offline retry and 390px layouts. The Mac native client switched between hosted views and the local library within one window. Screenshots contain synthetic local fixtures only. The installer and bundle have valid Ed25519 manifests, expected SHA-512, identical core payloads and source-matching packaged UI; the Go helper successfully extracted the actual ZIP. Public HTTPS assets, existing browser-login binding and authorization behavior, update feeds and the complete installer download were verified. Windows execution remains for device testing; Authenticode is not configured.

Installer: joincraft-0.9.15-win-x64-setup.exe, 127750363 bytes, SHA-256 4e5d3ac9e37a6587d582e014314a65b97007241db0b2e9e373b85d7736c0cda2.
Update: joincraft-0.9.15-win-x64.zip, 163801009 bytes, SHA-256 8456e5084c5697f42c3011842a0875d933abcca03ab6ee68a913cae1bb059654.

Stable aliases and signed feeds now point to 0.9.15; legacy NSIS latest.yml remains 0.9.3.


## 2026-11-13 - Voice control colors and disconnect icon
Published three hosted assets (app.js, community.js, community.css) in the existing 0.9.15 release with original hashes checked and per-file atomic replacement. Backup: /opt/joincraft/backups/voice-controls-20261113. No service restart, database or voice/media configuration change; installer and signed update feeds remain 0.9.15. Hosted views in the browser and desktop client receive the change on reload.

Microphone and listening controls are green while enabled, dark red while disabled; diagonal-off icons and action labels remain. Disconnect is a distinct red phone-with-cross button; settings stays neutral. Connection status uses green, connecting amber and failed red. All four targets remain at least 40 by 40 pixels at 390px.

Seven existing community tests passed under Node 24. Local UI verification used actual application assets and voice control code with a temporary simulated media SDK; it captured no microphone, played no audio and contacted no real media service. Checked microphone, deafen/restore, settings and disconnect interactions, desktop and phone rendering, and console errors. Public HTTPS hashes match all three local files; health and the unchanged desktop feed passed. Screenshots: voice-controls-detail.jpg, voice-controls-desktop.jpg and voice-controls-mobile.jpg.


## 2026-11-13 - Hosted business WebSocket migration
Release: /opt/joincraft/releases/0.9.15-20261113-ws; rollback: /opt/joincraft/releases/0.9.15-20261113-ux (including the voice-control color patch). Existing runtime modules were matched against compiled pre-migration source before switching. SQLite remains schema 5. Existing HTTPS and nginx WebSocket Upgrade handling are reused; no new public port or external service. Desktop binaries and signed feeds remain 0.9.15 because this feature is hosted. Reload the web page or reopen the client to load the new transport.

Validation: 119 full regression tests passed. Coverage includes one-use and expired tickets, cross-origin rejection, private and room message persistence/ACK, idempotent WS/HTTP retries, multiple devices, outsider exclusion, membership removal, room closure, session revocation/expiry, authentication timeout, stale heartbeat cleanup, malformed-frame limits, forward history pagination and the actual browser transport retrying a dropped ACK. Browser checks confirmed private and room sends use only WS frames (no per-message /api/state or latest-message-list request), input drafts and historical reading survive incoming messages, and 55 messages accumulated offline are all recovered with scroll position and draft intact. Room environment changes arrived automatically. Screenshot websocket-room.jpg contains local synthetic fixtures only.

Public HTTPS hashes match all four updated frontend modules. An end-to-end WSS check used two disposable guest sessions to verify ticket auth, room message delivery, persisted ACK, retry deduplication, read markers, membership removal, rejection after leaving and immediate logout revocation. The test room was closed and both sessions logged out. Public health passed and the existing desktop feed remained 0.9.15. No Windows game or microphone test was performed as part of this migration.


## 2026-11-13 - Native game actions and browser download guidance
Release: /opt/joincraft/releases/0.9.15-20261113-client-platform; rollback: /opt/joincraft/releases/0.9.15-20261113-ws. Schema 5, ports, ingress, relay, voice and WS protocol are unchanged. No local Electron library/preload/main files changed, so installer and signed feeds remain 0.9.15.

The web app replaces the game-library toolbar button with the official client download. Room overview shows concise client guidance and Windows x64 information instead of native game actions. Game-environment navigation, editing, LAN ports and game connection status are hidden on web; version/loader metadata, room management, chat and voice remain. Direct game-environment hashes show the same guidance, and stale play actions cannot request game tickets through the new web UI. /launcher, /launcher/ and /launcher/index.html redirect to the official homepage. Native detection uses the existing openLibrary bridge capability; server membership/auth rules remain authoritative.

Validation: 124 full tests passed, including capability detection, web command blocking, native controls/local address preservation and legacy URL routing. Browser 1280px and 390px checks verified download guidance, no horizontal overflow, absent game settings/port controls, deep links, web help and homepage redirects. The isolated Mac Electron client created a local test room, retained game-environment navigation and an enabled start button, and opened the functional local library in the same window. No game or microphone was started; screenshots use disposable local fixtures. Temporary preview processes were stopped.

Public HTTPS checks passed for the four changed frontend assets, all three legacy library redirects, official installer download status/size and service health. The client loads this change after reopening; web pages need a refresh. Screenshots: client-platform-web.jpg, client-platform-mobile.jpg and client-platform-native.jpg. Embedded bridge management and Windows real-game validation remain subsequent work.


## 2026-11-14 · 0.9.22 界面与整合包下载修复

网站和后端发布目录 `/opt/joincraft/releases/0.9.22-20261114-client-fixes`，源码检查点 `a15b35f`；回滚目录 `/opt/joincraft/releases/0.9.21-20261113-zip-import`。服务使用按锁文件全新安装的生产依赖。SQLite schema 7 不变；一致性数据库及当前整合包备份位于 `/opt/joincraft/backups/before-0922.sqlite` 与 `.packs`，备份数据库权限 0600。代理、端口、中继及语音配置未变。

应用采用炭灰/钻石青、一体化原生标题栏，修复房间简称、重复描边和头像尺寸。客户端默认 16 并发下载，按摘要复用已添加 PCL / 其他 Joincraft 实例中的文件；房主新上传的压缩包保存在本地供安装复用。修复主进程 HTTP parser 断流断言与 Forge/NeoForge 错误类型兼容问题，失败返回可重试提示。

已发布安装程序 `joincraft-0.9.22-win-x64-setup.exe`，130400089 bytes，SHA-256 `0aa6896f5d1cf09a4955fb167795e28a28cd4b2672bd76651f803f663dc5ae9c`；应用内更新 `joincraft-0.9.22-win-x64.zip`，167062750 bytes，SHA-256 `43280b925cbb469231d80104dfe98825963f9ed7e250c5b04d90f9743f596c4a`。稳定 EXE/ZIP 别名及两份签名清单均指向 0.9.22；旧 NSIS latest.yml 仍为 0.9.3，签名公钥和应用内更新机制未变。

发布验证：190 项完整回归通过，Go 更新助手测试通过；从最终 Windows EXE/ZIP 检查 Ed25519 签名、大小/SHA-512、相同核心载荷、源码/样式及固定依赖版本，并由 Go 助手校验和提取真实更新归档。提取后的实际应用代码在 Electron Node CLI 中通过 9 项 HTTP/Forge/NeoForge 专项测试。公网页面资源匹配本地字节，0.9.21 客户端检查可发现 0.9.22，ZIP Range 正确，完整公网 EXE 与 ZIP 下载的 SHA-512 匹配清单。当前服务健康。

Windows 真实安装、更新重启、原生窗口控件、完整 Forge 处理器和真实 MC 启动由用户后续实测；本次未执行 Windows 程序或游戏。


## 2026-11-14 · 0.9.23 Forge 下载重试热修复

仅发布 Windows 客户端；网站和后端继续使用 `/opt/joincraft/releases/0.9.22-20261114-client-fixes`，没有重启服务或修改数据库、代理及端口。客户端源码检查点 `126420c`，修复提交 `42ff468`。

真实官方源验证复现 ForgeAutoRenamingTool 连接中断后立即回退 Maven Central 404、错误仍显示 installer.jar 的问题。现为主源 GET/HEAD 增加最多 3 次退避重试，保留真正来源失败，并同步实际依赖文件名。

安装程序 `joincraft-0.9.23-win-x64-setup.exe`，130401085 bytes，SHA-256 `f2fb83269474deea437d1061bb0a2546f61f15679221cb816448fa0fa9bfe74d`；应用内更新 `joincraft-0.9.23-win-x64.zip`，167063337 bytes，SHA-256 `33d8446754a264f9f38ec39ee63e4170734b963930944e289f739fa4c715ea22`。稳定 EXE/ZIP 别名和两份签名清单指向 0.9.23；签名公钥及应用内更新流程沿用原配置，旧 NSIS latest.yml 保持 0.9.3。旧清单备份为 `/opt/joincraft/backups/windows-x64-before-0.9.23.json`。

验证：TypeScript/UI 构建与 193 项完整回归通过；最终 EXE/ZIP 的 Ed25519 签名、大小/SHA-512、核心载荷一致性、打包源码和依赖版本通过；Go 更新助手完成真实更新包校验与解包。提取后的客户端代码与依赖在 Electron Node CLI 通过 12 项 HTTP/Forge 专项测试。公网完整 EXE/ZIP 下载摘要匹配签名清单，0.9.22 客户端能发现 0.9.23，Range、官网安装程序入口、网页资源和服务健康检查均通过。

真实 Forge 1.20.1 / 47.3.33 安装程序与 36 个带摘要依赖校验通过，任务到达 Java 处理器边界并在执行 Java 前主动停止。Windows 实际安装、更新重启、完整 Java 处理器及游戏启动仍待用户实测。


## 2026-11-14 · 0.9.24 VPS 缓存与 Windows 安装登记

客户端源码检查点 `1c8c6aa`；Windows EPERM 修复 `929b64e`，固定来源缓存 `0e468ef`，真实 Forge 进度 `f76f720`。应用服务继续使用 `/opt/joincraft/releases/0.9.22-20261114-client-fixes`，未重启或迁移数据库。更新了同目录的 `public/pack-progress.js`，并重建 nginx 以加载缓存挂载与 128 MiB 内存上限；既有 WebSocket 可自动重连。外部端口、中继与语音配置未变。

缓存目录 `/var/lib/joincraft/download-cache`，容器 UID/GID 101，配置为 3 GiB 上限、至少 4 GiB 空间的清理目标。JSON 元数据绕过缓存，固定公共源二进制缓存 7 天；保留 TLS 验证、来源/方法/查询限制、Range、cache lock、原源备用与客户端摘要校验。代理配置、Compose、进度脚本和前后哈希备份位于 `/opt/joincraft/backups/download-cache-0924`。回滚时恢复其中配置和脚本并只重建 nginx。

安装程序 `joincraft-0.9.24-win-x64-setup.exe`，130402779 bytes，SHA-256 `1d26d9793df1bd57520a8e23e0cc0aba94184fa6b51af2e6cbc8998968ef7c42`；应用内更新 `joincraft-0.9.24-win-x64.zip`，167065823 bytes，SHA-256 `2809de7a3b439100d1722a6bddd284f1e518aa0f0fdfe7ee116a9d5b523ae976`。稳定别名和两个 Ed25519 清单指向 0.9.24；旧清单备份 `/opt/joincraft/backups/windows-x64-before-0.9.24.json`。旧 NSIS latest.yml 仍为 0.9.3。

验证：完整构建与 209 项回归通过，最终客户端载荷的 25 项 HTTP/缓存/Forge/进度检查通过。实际 EXE/ZIP 的签名、大小/SHA-512、核心载荷和打包源码一致性通过；Go 助手成功校验和提取实际更新包。公网完整 EXE/ZIP 下载摘要匹配签名清单，0.9.23 客户端能发现 0.9.24，网站健康及资源字节、更新 Range 检查通过。

缓存先在不开放公网端口的临时 nginx 容器中验证，再验证公网冷/热下载、HEAD、Range、元数据 BYPASS 和限制。该 Mac 到 VPS 的 mixin 文件首次请求 3318 ms，第二次 HIT 127 ms；这不是 Windows 线路测速。已预热并校验 64 个固定官方文件，共 21907097 bytes。真实 Forge 任务 38 个请求全部经 VPS，显示 36/36 文件、10700610 bytes，与实际文件一致。

真实 Forge 验收主动停在 Java 处理器前，没有启动游戏。Windows 完整处理器、末尾登记、应用内更新重启与实际 MC 启动仍待用户实测。


## 2026-11-14 · 0.9.25 取消与已安装状态修复

应用服务发布至 `/opt/joincraft/releases/0.9.25-20261114-pack-cancel`，源码检查点 `dbb8e63`；回滚目录 `/opt/joincraft/releases/0.9.22-20261114-client-fixes`（含 0.9.24 进度脚本覆盖）。SQLite schema 7 未变；一致性数据库和当前整合包备份位于 `/opt/joincraft/backups/before-0925.sqlite` 与 `.packs`，数据库备份权限 0600。生产依赖按锁文件重新安装。nginx 缓存配置、端口、中继和语音配置保持原状。

修复 `90ae1c8` 用标准流桥接 yauzl 2，ZIP 读取/解压、哈希及实例检查可取消；`6aaf707` 允许有固定摘要的合法空文件，兼容原实例记录，个人设置及 MCEF/KubeJS 缓存不作为强制副本依据；`47ef841` 防止旧检查与进度覆盖新状态，并将本地检查错误与未安装区分。

已发布 EXE `joincraft-0.9.25-win-x64-setup.exe`，130404320 bytes，SHA-256 `cf6bd8911d84c76f66488d63f15ce0e9fa3b41ef0f159d95fc913a7cdb53b20a`；更新 ZIP `joincraft-0.9.25-win-x64.zip`，167066371 bytes，SHA-256 `c75825dbb9c8d370abbd91570012b379b3442da986453f3b5918a445e22664f3`。稳定安装与更新别名、两份 Ed25519 清单指向 0.9.25；原更新公钥不变，旧 NSIS latest.yml 继续固定 0.9.3。前版签名清单备份 `/opt/joincraft/backups/windows-x64-before-0.9.25.json`。

验证：构建和 224 项完整回归通过，最终客户端实际载荷在 Electron Node CLI 中通过 32 项 HTTP/缓存/Forge/ZIP 取消检查。实际 EXE/ZIP 的签名、大小/SHA-512、核心载荷及源码匹配、Go 更新助手校验和解包通过。VPS 用一致性备份的临时副本完成健康、界面及真实 ZIP 取消预检后切换服务。公网资源匹配源码，0.9.24 客户端可发现 0.9.25，ZIP Range 及完整公网 EXE/ZIP 摘要校验通过。

用户原始 368,241,711-byte 香草 ZIP 中取消可复现旧任务 7 秒仍未结束；新代码约 991ms 发出取消、994ms 结束读取（本机测量）。真实包的 20 个空文件全部提取并通过固定摘要校验。没有运行实际游戏；Windows 实机取消、旧实例重新识别及完整启动仍待用户验证。旧版若已卡住，先退出重开再更新，升级后优先重新检查现有实例。


## 2026-11-14 · 0.9.26 自有存档与 Forge 自动开房

网站与应用服务发布至 `/opt/joincraft/releases/0.9.26-20261114-world-host`，源码检查点 `7051936`；回滚目录 `/opt/joincraft/releases/0.9.25-20261114-pack-cancel`。SQLite schema 7 未变；一致性数据库与整合包备份为 `/opt/joincraft/backups/before-0926.sqlite` 及 `.packs`，数据库备份权限 0600。先在备份的临时副本上验证健康、ZIP 取消和新版原生入口资源，再切换服务。nginx、外部端口、中继协议与语音配置保持原状。

客户端仅列出 Joincraft 自有实例并展示存档。房主选择世界及端口，游戏通过 Quick Play 进入存档，辅助组件调用集成服务器 API 开放指定端口；客户端确认 MC 状态及房间身份/整合包后建立现有 HTTPS/WSS 中继。成员可复用已保存启动设置直接加入。停止联机保留游戏，已开放的本机 LAN 随退出世界关闭。

辅助组件 `com.joincraft:host-helper:1.0.0` 随客户端资源发布，JAR 10924 bytes，SHA-256 `2280cb319e4f636ef7b70f262e94ab01b6e27315d7bb45b1d9fd3ae0d9fd652e`。客户端校验后安装到 `.minecraft/.joincraft/components/maven`，通过 Forge Maven 参数加载；没有放入 `mods`，不修改房间整合包。编译与独立发现测试基于 Forge 47.3.33 / Minecraft 1.20.1 / Java 17，真实 Forge 加载器已从带中文、空格及逗号的私有路径发现并解析实际 JAR。

已发布安装程序 `joincraft-0.9.26-win-x64-setup.exe`，130425414 bytes，SHA-256 `bee3ede13e4e44f55e90e7b2caa6814288a664aff5cc05abb4fa3d0a9980e548`；应用内更新 `joincraft-0.9.26-win-x64.zip`，167088957 bytes，SHA-256 `a345ed18423414c50130769cd854b987057991df5635a19498702fd6644bcd4a`。稳定安装与更新别名、两份 Ed25519 清单均指向 0.9.26。签名公钥未变，旧 NSIS latest.yml 仍固定为 0.9.3；两份前版清单分别备份到 `/opt/joincraft/backups/windows-x64-before-0.9.26.json` 与 `windows-x64-setup-before-0.9.26.json`。

验证：249 项完整回归、最终客户端实际载荷在 Electron Node 中的 85 项检查、Java 辅助状态机 7 个模拟场景与真实 Forge JAR 发现通过。实际 EXE/ZIP 的签名、大小/SHA-512、核心载荷及新增组件一致，Go 更新助手成功校验并解包实际更新 ZIP。公网网站与入口脚本匹配发布字节，0.9.25 可发现 0.9.26，ZIP Range 及完整公网安装程序/更新 ZIP 的摘要检查通过。Windows 安装程序沿用既有构建方式，未配置 Authenticode；应用内更新继续用固定 Ed25519 公钥验证。

本次没有启动 Minecraft；Windows 双机真实游戏、整合包兼容性、自动端口开放与加入仍待用户实测。未发布新的 macOS DMG。
