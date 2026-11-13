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


## 0.9.23 主源瞬断与备用源 404

真实 1.20.1 / Forge 47.3.33 验证复现：ForgeAutoRenamingTool 的官方源在 TLS 握手前断开，旧逻辑立即切换至不提供该 Forge 专有文件的 Maven Central。后者的 404 被优先展示，且界面仍保留前一个 installer.jar 文件名。

现为 GET/HEAD 在主源进行最多 3 次有退避的重试，覆盖连接重置、超时和可重试 HTTP 状态；支持取消与重定向。聚合错误保留第一个真实来源失败，忽略随后空文件校验产生的派生错误；最终错误和当前文件同步到真实依赖名。

本机真实官方源验收：安装程序 SHA-1 与 [Forge 官方发布记录](https://files.minecraftforge.net/net/minecraftforge/forge/index_1.20.1.html) 的 `9184fd6fa83455a2d6cf196551eded07bcc8c984` 一致，36 个带摘要的配置依赖全部通过校验，任务已进入 Java 处理器边界。验收在执行 Java 前主动停止，未启动游戏。

回归覆盖主源两次中断后第三次成功且不访问备用源、依赖失败时当前文件名、主源网络错误不被备用 404 覆盖，以及真实 404 仍被保留。测试服务器仅监听 loopback，并在 DNS 层拒绝外部连接。


## Windows 安装末尾 EPERM

旧流程在解压完成后将整个 `.staging-UUID` 目录改名为 `UUID`。Windows 拒绝该目录重命名时，安装在步骤 6 失败，即使所有文件已经写完。截图不能确定是扫描程序、仍在结束的子进程还是其他句柄占用。

安装现在从开始就使用最终 UUID 目录。只有完整安装结束，才原子发布小型 `instance.json` 登记文件；没有登记文件的目录不会出现在游戏库。登记文件遇到 EPERM/EACCES/EBUSY 有有界、可取消重试，错误和取消继续清理未完成目录。既有实例和存档不移动。

验证稳定目录、半成品不可见、真实文件登记、两次共享冲突后成功、持久冲突上限和取消清理；不执行真实 Windows 程序。


## ZIP 读取时取消卡住

真实香草纪元 ZIP 在 KubeJS 条目读取回调中取消，可复现旧任务 7 秒后仍未结束。yauzl 2 的条目流 destroy() 不遵守现代 close 生命周期，直接交给 Node pipeline 后，取消会等待一个不再到达的 close。

新增标准 PassThrough 桥接，把旧条目流排除在 pipeline 的关闭等待之外；ZIP 条目枚举也监听取消和提前关闭。压缩条目、落盘解压、整包哈希、本地文件哈希和实例匹配均传递取消信号；取消不会被吞成文件变化，检查阶段不会继续标记安装成功。

同一真实 ZIP 在约 991ms 发出取消，约 994ms 结束读取（本机测试，不代表 Windows 时延）。40 项相关回归通过，包括取消后重试、条目等待、输出关闭和校验中断；未执行游戏。


## 刚安装完就显示本地文件变化

用户提供的香草纪元包包含 20 个合法空文件（配置和 MCEF 浏览器缓存）。原实例匹配复用了“下载文件必须非空”的检查，导致空文件即使 SHA-512 正确也被当作损坏。已允许带固定摘要的空内容文件；JAR 下载仍必须非空，文件缺失和错误大小仍失败，旧 schema-1 本地记录无需迁移或重装。

房间兼容性继续严格校验模组、defaultconfigs、脚本和 KubeJS 固定内容，以及游戏运行文件；个人 config、KubeJS 设置与生成缓存、MCEF 浏览器缓存、存档不作为强制重装依据。正常运行改写设置不会创建新副本，改动模组/脚本、额外模组或损坏运行文件仍会拒绝直接启动。匹配结果区分 pack-file、extra-mod 和 runtime，并返回相对问题文件供界面说明。

43 项相关回归通过，覆盖新/旧记录的空文件、正常配置/缓存变化、存档保留、脚本改动和坏 JAR/缺失文件拒绝。
