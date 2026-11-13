# VPS 游戏依赖缓存

Windows 客户端的独立实例安装优先使用同站 `/game-downloads/<source>/<path>`。支持 Forge/NeoForge、Minecraft 本体/资源/Java、Fabric/Quilt、Maven Central、Modrinth 和 CurseForge CDN 的固定来源；其他来源、带查询参数的签名 URL 继续直连。微软、Joincraft 登录和账号请求不经过该缓存。

客户端 GET/HEAD 保留 Range/If-Range，不向缓存传送 Cookie 或 Authorization。网关错误时回原来源，短时间跳过不可用网关；Forge 安装任务通过 libraryHost 把缓存 URL 放在官方来源之前，保留原来源备用及取消/重试逻辑。文件仍按清单的摘要校验，缓存不会代替客户端验证。

nginx 使用固定来源映射，仅接受 GET/HEAD；不接收任意 URL，不跟随源站重定向，源站 HTTPS 验证开启，清除账号头和上游 Cookie。客户端正常的并行下载保留。JSON 元数据不缓存，二进制成功响应缓存 7 天；失败响应不缓存，同一文件的冷下载使用 cache lock 合并。支持 HEAD 与 Range，首次冷请求仍受 VPS 到源站速度限制，不能保证所有线路都更快。

磁盘缓存位于宿主机 `/var/lib/joincraft/download-cache`，挂载至 nginx `/var/cache/joincraft-downloads`。缓存上限 3 GiB，清理目标保留至少 4 GiB 空间，14 天未访问条目移除；nginx 内存上限从 64 MiB 调整至 128 MiB。并发及请求频率有限制。无需添加外部端口或重启数据库/应用服务。

部署前创建缓存目录并授权容器 nginx UID/GID 101，检查配置，然后只重建 nginx 服务以加载新增磁盘挂载。先备份 `/opt/joincraft/nginx.conf` 与 `compose.yaml`；失败时恢复配置并重建 nginx。既有房间 WebSocket 可能在代理重建时短暂重连。

验收包括：真实 HTTP 的 Range、凭证隔离、取消、回源、坏摘要拒绝，真实 Forge 任务经本机缓存端点下载；上线后检查冷下载、再次 HIT、实际官方摘要、Range、非法来源/方法/查询拒绝与服务健康。

参考：[nginx proxy_cache 官方文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。
