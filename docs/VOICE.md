# 房间语音首版

文字聊天：Fastify + SQLite + SSE。音频：浏览器 WebRTC + 本机 LiveKit SFU；音频不写入 SQLite，不录音。房间文字聊天共用，语音按独立分组隔离。

## 本地运行

Node.js 24、Docker Desktop：

```sh
npm ci
npm run voice:up
# 将 .env.example 复制到 .env，启用 LIVEKIT_URL / KEY / SECRET 三行
npm start
```

当前本地开发配置使用 `ws://127.0.0.1:7880`、`devkey`、`secret`。这是只绑定 loopback 的开发实例，不能直接用于公网。`voice:up` 可重复执行，复用本任务容器；`voice:down` 停止它。关闭应用页面会断开语音。

打开 http://127.0.0.1:4180 ，进入已有房间即可看到「游戏」。房主点击「语音分组」右侧 ＋ 创建分组。加入时只收听；麦克风按钮会请求浏览器权限。戴耳机后再开麦可避免本机多标签反馈。

## 权限与连接

- 每个分组对应不同 SFU room，用户同一时间只有一个有效语音 lease。
- 客户端通过 **应用同源 `/voice/rtc` WebSocket 网关**连接；每次首次连接、断线重连都校验签名、有效登录、未关闭房间、成员资格和分组。
- 网关按当前房主限制重新签发上游 token，只允许麦克风发布与音频订阅；禁止摄像头、屏幕共享和 data 发布。原 token/SDK 刷新 token 都不能覆盖当前静音规则。
- 房主移出、主动退出、注销、房间关闭、分组删除会撤销 lease，并断开信令和 SFU 参与者。离线标签未正常退出时，12 秒客户端心跳与 45 秒 lease 配合回收；服务端每 3 秒核对媒体参与者，状态可能有短暂延迟。
- 房主允许发言只恢复发布权限，不远程开启成员麦克风。移出后 60 秒内不能重新申请连接。
- 程序重启撤销旧 lease，成员需重新加入。不能让两个应用实例共用同一个 SQLite 文件运行语音协调。
- 新增 SQLite 迁移 v4，会为原有房间补上「游戏」。消息按房间最近 5,000 条保留；关闭房间不删除历史，但原接口不再允许读取。

自建 LiveKit 不自动撤销已有 JWT；只有短 TTL 不足以防止刷新 token 被重用，因此本版增加了连接网关。**部署时 LiveKit 7880 信令/API 必须只对应用服务器可达，不得把 7880 或绕过网关的 `/rtc` 路径开放给公网。** 这是网关权限生效的部署前提。[LiveKit 官方 token 说明](https://docs.livekit.io/frontends/reference/tokens-grants/)

## VPS 部署状态

已部署至 www.joincraft.top，使用独立密钥、HTTPS/WSS 网关及独立 LiveKit 服务。生产信令 API 为 127.0.0.1:7890，媒体 TCP 7891 / UDP 7892，RTC 只使用 eth0 并公布 VPS 公网地址；本地 loopback 配置保持独立。公网浏览器合成音频收发与解码通过，尚未验证 Windows 麦克风和多人负载；未部署 TURN。安全组及主机防火墙本轮未修改，详情见 [生产部署](DEPLOYMENT.md)。

媒体走 SFU 转发，信令走应用；没有视频的音频负载低于视频会议，但浏览器音频编码、多人同时说话、TURN 和现有 VPS 工作负载均会影响结果。[LiveKit 端口说明](https://docs.livekit.io/transport/self-hosting/ports-firewall/)

## 验证

```sh
npm test            # 45 项：房间、账号、私聊、群聊/分组/权限、MC 中继、PCL 模拟
npm run test:voice  # 需要先 voice:up；本机 SFU + 3 个原生测试客户端
```

真实 SFU 测试生成 440Hz PCM，经 WebRTC 编码、网络转发后解码验证非静音音频；另一个分组不能订阅，静音规则保留，移出后旧 token 重连被网关拒绝。全程不采集真实麦克风，不启动 Minecraft。

浏览器检查覆盖聊天发送、创建分组、加入/切换/退出语音、页面切换持续连接、音频设置、桌面和 390px 窄屏。真人麦克风、Windows 设备权限、回声体验、异地网络和移动后台通话尚未验证。

Electron 已限制为仅可信房间来源可请求音频权限，拒绝视频；正式 dmg 打包仍需要配置 `NSMicrophoneUsageDescription` 与签名/沙盒权限并实机验证。打包 exe/dmg 不在本轮交付范围。
