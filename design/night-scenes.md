# 2026-11-14 · 用户选定的夜景插画

用户明确选择 A 夜间营地用于首页，B 地下钻石矿洞用于登录页。通过内置 image_gen 生成，原始输出保持不变；以下 PNG 为项目内保存的选定原稿，WebP 仅转换格式，不改色、裁切或压暗。网页用 object-fit 在不同窗口取景。

| 页面 | 原稿 | 网页资源 | 生成文件 |
| --- | --- | --- | --- |
| 首页 | `homepage/camp-v2.png` | `/home/camp-v2.webp` | `exec-a9aaf6fb-70ec-46d7-8c5b-5e675ae28683.png` |
| 登录 | `login/mine-v2.png` | `/auth/mine-v2.webp` | `exec-1de085f8-5cae-4d74-abb1-5f035f8cfd3a.png` |

每次调用的完整提示词由下面的公共段及各自场景段连接组成。重建网页资源运行 `npm run build:home`。历史 world-v1 文件和地址保留，避免修改已经声明 immutable 的内容。

## 公共提示词

```text
Use case: stylized-concept.
Asset type: preview-only concept artwork for Joincraft, a Minecraft Java multiplayer desktop app and its website.
Create a polished, detailed Minecraft voxel world render, landscape 16:9. True block geometry, readable pixel textures, restrained cinematic game lighting, crisp architectural detail. The app's established palette is charcoal #191B20, slate #24272D and diamond cyan #58C7CF. Make the environment naturally belong to this palette through nighttime materials and motivated light, with small warm amber accents. Preserve visible, attractive shadow detail; dark does not mean muddy, gray or hidden under a black filter.
Composition: the narrative focal area occupies the left and middle 60% of the image, with a quieter, naturally dark continuation of the environment on the right 35% that could sit beside login controls. This must be a complete scenic illustration, not a screenshot of a website. No form, buttons, text, typography, logo, watermark, borders, rounded container or floating UI.
Three Minecraft-style friends with varied practical clothes, distinct silhouettes and natural cooperative actions; block hands and square faces, ordinary player proportions, no toy-like giant heads. Keep them modest in scale inside the world.
Avoid pale white sky, white fog, gray haze, daytime art merely tinted black, excessive bloom, neon cyberpunk, photorealistic people and decorative particles.
```

## A · 首页场景段

```text
Scene: a cozy established survival camp in a spruce forest after sunset. A well-built timber and stone cabin at left, warm light through two windows, a covered workbench, orderly material crates, small garden, and a narrow stream in the foreground. A friend in a slate jacket carries timber toward the workbench, another in a rust-colored coat arranges supplies, and a third in a muted teal scarf greets them at the cabin steps. A tiny cyan soul lantern beside a stone path relates the scene to the brand; amber windows provide the human warmth. The right side recedes into naturally charcoal spruce trunks and a dark hillside, without an artificial vignette. Cool blue-hour moonlight shapes roofs and water. Feel like friends gathering to build a shared home, not a battle poster. Architectural and environmental detail should reward close viewing, with a clear focal hierarchy.
```

## B · 登录场景段

```text
Scene: an expansive underground Minecraft deepslate mining chamber, viewed from a slightly raised three-quarter camera. Layered charcoal stone, readable cubic ledges, a few exposed cyan diamond-ore blocks and a narrow subterranean pool reflect restrained turquoise light. Three friends collaborate in the left-center: one in a gray explorer jacket carefully mines a diamond vein with a pickaxe, one in a brown vest loads a minecart with supplies, one in a muted teal hood sets a warm lantern on a stone ledge. A short section of rails and timber supports adds depth. Diamond cyan and reflected water light reveal the rock surfaces, with one small amber lantern as a counterpoint. The right side continues into a deep, calm slate cave wall, not a blank solid-color field. The result should feel tactile, calm and adventurous; no giant glowing crystals, sci-fi machinery or excessive magical effects.
```

## 页面约束

背景不加黑灰遮罩、不压暗、不加灰色渐隐。桌面登录区向右对齐，落在自然暗色洞壁上；只有表单控件拥有底色。手机端使用短场景图加居中表单。首页仅保留下载客户端和进入 Web 版两个主要入口，保留既定宣传语。像素标题和字标与系统 UI 正文分工，使用客户端共用的炭灰和钻石青令牌。


## 验收

Node 24 TypeScript/UI 构建和 50 项首页、登录、客户端授权及交互回归通过。两张新增 WebP 的类型、公开路由与 immutable 缓存通过真实 HTTP 检查，旧图片地址继续可用。浏览器在 1492×724、768×900、390×844、320×740 检查布局和横向溢出，注册保留 10 字符下限。鼠标点输入框无外描边，键盘 Tab 保留可见焦点；空表单显示行内校验。桌面登录表单在 1492px 窗口的范围为 x1013–1393，手机居中。

截图位于 `docs/screenshots/night-*.jpg`。独立只读视觉评审结论为 ship，范围为这五张最终页面截图及相关源码，未发现需要修正的视觉问题；该评审没有独立执行交互或构建。页面更改在本机预览，尚未部署线上。
