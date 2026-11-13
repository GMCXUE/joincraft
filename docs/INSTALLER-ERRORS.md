# 下载与加载器安装异常修复

## 主进程 Parser.finish 断言

截图中的 `AssertionError: assert(!this.paused)` 来自 Electron/Node 内置 Undici 的 socket EOF 处理。应用接收流因背压暂停时，对端关闭连接可能使断言从 socket 事件回调直接抛出，普通请求 try/catch 不能接住。

原问题与上游修复：https://github.com/nodejs/undici/pull/5389 。

客户端现在使用固定 Undici 8.12.4 和独立 Agent。只换 fetch 函数还不够，默认全局 dispatcher 可能仍是旧版本；因此请求必须显式使用自己的连接池。资源下载、整合包传输、客户端更新和账号请求共用该实现，保留 TLS 校验、地址限制、重定向策略、取消和文件校验。

`http-client.test.mjs` 使用独立子进程和真实 TCP/HTTP 服务，覆盖暂停读取时 FIN、截断响应、断流重试及临时文件清理。测试过程中已在旧全局 dispatcher 路径复现相同断言；新路径保留可捕获错误。Electron Node CLI 也运行同样的测试。

## Forge instanceof 错误

原安装库 6.0.1 的下载模块依赖旧 Undici 错误类型，在升级底层 HTTP 依赖后，成功请求后的类型检查也可能引用不存在的 `ResponseStatusCodeError`，抛出 `Right-hand side of instanceof is not an object`。

安装库更新为保留既有任务接口的 6.1.2，移除该成功路径检查；其下载依赖仍保留过时的 HTTP 错误构造分支。因此 `launcher/installer-compat.mjs` 在响应头阶段将失败状态变为可捕获错误，避免错误响应进入旧 body 处理器。不修改第三方模块导出，不降级安全补丁。安装器和文件传输模块的 Undici 均明确固定为 7.30.2，不依赖 npm 偶然的提升或去重结果。

Forge 默认优先使用 HTTPS Maven 地址。聚合错误保留原 cause，并将 HTTP 状态或连接中断转换为可重试的应用内提示；校验和取消约束保留。

`forge-installer.test.mjs` 使用真实本机 HTTP 和生成的 ZIP/JAR 测试数据运行官方 Forge/NeoForge 安装任务，完成下载、解压 install_profile.json 和 version.json、生成版本文件，并覆盖连接中断、HTTP 503、取消及重定向。测试不执行 Java，不启动游戏，测试服务拒绝访问外部网络。

运行：`npm run test:packs`。这些检查验证安装管线和错误边界；Windows 实机、真实 Forge 处理器及完整整合包启动仍需在新客户端发布后验证。
