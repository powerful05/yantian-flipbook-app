# Flipbook 一手来源研究笔记

研究日期：2026-08-28（Asia/Shanghai）  
来源范围：仅使用 `flipbook.page` 官方公开页面/公开静态资源，以及 `eren23/openflipbook` GitHub 仓库自身文件。  
仓库证据固定版本：`main` 当前提交 [`70d6478f2371d33ddac797dc02d2a8c8e0735149`](https://github.com/eren23/openflipbook/commit/70d6478f2371d33ddac797dc02d2a8c8e0735149)。  
本笔记没有调用任何付费图像、视频或大模型服务。

## 先给结论

1. 这两个来源共同指向的不是传统 PDF 翻页，而是“图片即界面”的生成式视觉浏览器：查询或上传得到一张页面图片，点击图片中的对象后继续探索。
2. `flipbook.page` 官网可以确认产品理念和公开 UX：页面是按需生成的图像，官方文字说明宣称无 HTML/代码/字段叠加；公开站点还提供搜索、上传、清空历史、分享入口，以及一个“实时视频流”实验开关的产品说明。
3. 官网没有公开其服务端实现、模型型号、延迟 SLA 或官方源码声明。官网演示视频明确写着使用预生成视频且为加速而剪辑，不能作为实时延迟证明。
4. `openflipbook` 是独立的 MIT 复刻，不是官方源代码；其 README 明确说基于公开 bundle inspection、没有使用 Flipbook 源码。它补齐了可复用的工程实现：Next.js + FastAPI/Modal、SSE 生成、VLM 点击解析、候选预计算/悬停预取、Mongo/R2 持久化、LTXF WebSocket/MSE 动画、节点图历史、引用和 World Mode。
5. “百分之百达到官网演示效果”不是当前证据支持的工程承诺。可以把官网外观/交互定义为验收目标，但必须把模型质量、实时视频首字节、网络、GPU 冷启动、第三方服务可用性单独做基准和降级；来源本身反而说明官方实时视频目前资源密集、行为不可预测。

## A. `flipbook.page` 官网：已确认事实

### A.1 产品模型与像素边界

- 官方首页标题/说明把产品定义为“infinite visual browser generated entirely on demand in real time”。每个“page”是一张图片；点击图片中任何内容会得到一张更深入探索该内容的新图片。官方页面进一步说画面不包含 HTML、代码、具体链接或字段，整个 web 是屏幕上的生成像素。[官网首页](https://flipbook.page/)
- 官网对文字渲染的回答是：屏幕上的文字也由图像模型渲染为像素，页面没有在图片上叠加文本；官方承认模型可能把文字画错或放错位置。[官网首页](https://flipbook.page/)
- 官网对信息来源的说明是：图像中的信息来自“agentic web search + image model 自身世界知识”的组合，可能有错误，但通常以在线真实数据为基础。[官网首页](https://flipbook.page/)

### A.2 当前公开页面可观察到的入口与控件

对 `https://flipbook.page/` 做了当前浏览器 DOM 快照和首屏观察，确认有：

- 搜索表单/搜索框（可见 placeholder 为 `Ask about anything`，表单 GET action 为站点根路径）；[官网当前 DOM（可复核的公开页面）](https://flipbook.page/)
- 文件上传入口（`Choose File` 隐藏文件 input、`Upload image` 按钮）；[官网当前 DOM](https://flipbook.page/)
- 浏览器窗口样式的历史清除按钮，首屏空状态时处于 disabled；[官网当前 DOM](https://flipbook.page/)
- `Open share menu` 分享按钮；在无页面内容时打开 `Share` 对话框，显示 `Copy current link` disabled，并提示先打开页面创建分享链接；[官网当前 DOM](https://flipbook.page/)
- 空状态提示为“Type something in the search bar or upload an image to begin.”，底部提示“Tap anywhere on the page to expand”。[官网当前 DOM](https://flipbook.page/)

这些是当前公开页面的可见行为，不等价于已经验证生成请求成功；本次未提交查询或上传，因此没有触发任何模型调用。

### A.3 实时视频与演示视频的边界

- 官网把 live video stream 描述为实验性功能：把静态生成图片变成更连续的视频流，动画化每次探索并创建无缝过渡；官方同时写明当前行为有些不可预测、资源消耗非常大，因此放在可开关的 toggle 后面。[官网首页](https://flipbook.page/)
- 官网说明当前实时视频由“定制的高优化视频生成模型 + 图像生成系统”两个系统组合而成，未来可能整合为单一系统；官网没有公开模型名称、协议、GPU 规格或延迟数字。[官网首页](https://flipbook.page/)
- 官网公开的 [`ParisExampleVideo.mp4`](https://flipbook.page/ParisExampleVideo.mp4) 响应是 `video/mp4`、支持 Range；媒体元数据显示约 14.4 秒、1716x1080、H.264、30 fps。官网文案明确标注：`This demonstration uses pre-generated video and has been cut for speed`。[官网首页](https://flipbook.page/)
- 因此，演示视频只能证明站点提供了一个预生成示例资源，不能证明“任意点击后的实时生成”具有同样的首帧时间、连续性或无缝程度。

### A.4 官网可见静态资源中的技术线索（不是官方后端证明）

公开 HTML 引用了 Vite 风格的 hashed bundle，例如 [`/assets/main-BPJa3Dcu.js`](https://flipbook.page/assets/main-BPJa3Dcu.js)、[`/assets/BrowserWindow-BMaBY18o.js`](https://flipbook.page/assets/BrowserWindow-BMaBY18o.js) 和对应 CSS。对公开前端 bundle 的只读字符串检查可见：

- 前端存在 `/api/iteratively-generate-next-page`、`/api/nodes`、`/api/nodes/upload`、`/api/image-proxy`、`/api/waitroom` 等路径字符串，以及可选的 `wss://…modal.run/ws/stream` LTX 流地址；[官网公开 bundle](https://flipbook.page/assets/main-BPJa3Dcu.js)
- bundle 中存在 `precompute-candidates`、`resolve-click`、`shareStatus`、`session_id`、`parent_id`、`image_variants`、`text/event-stream` 等字符串，说明公开客户端包含候选预计算、点击解析、节点/会话持久化和 SSE/流式相关代码路径；[官网公开 bundle](https://flipbook.page/assets/main-BPJa3Dcu.js)
- bundle 中有 `Connect to Live Video Stream`、`Disconnect from Live Video Stream`、`Live looping video is playing.` 等 UX 文案，以及 `LTXF`/`set_target_image`/`start` 相关字符串；[官网公开 bundle](https://flipbook.page/assets/main-BPJa3Dcu.js)

上述只是客户端公开 bundle 的技术线索：没有服务端源码、模型请求响应、数据库或实际付费调用验证，不能据此还原官方完整实现或给出真实性能结论。

## B. `eren23/openflipbook`：仓库事实

### B.1 定位、许可与非官方边界

- README 将项目定位为“open-source flipbook.page clone, image-is-the-UI”，核心闭环是 AI 生成插图、点击任意位置、视觉模型解析点击内容并生成下一页；支持文本查询或拖入图片。[README](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/README.md)
- 仓库根目录 [`LICENSE`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/LICENSE) 是 MIT；根 [`package.json`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/package.json) 的 `license` 也是 MIT，要求 Node >=20、pnpm 9.12.0。
- README 明确说它是独立的 open-source re-implementation，基于公开 bundle inspection，**没有使用 Flipbook 源码**；因此应把它当作借鉴/复刻实现，不把任何实现细节误称为官网官方源码。[README](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/README.md)
- GitHub 当前仓库元数据可确认：公开、非 fork、MIT、默认分支 `main`；研究时 `main` 指向提交 `70d6478f…`。[GitHub repository API](https://api.github.com/repos/eren23/openflipbook)

### B.2 总体部署与模块边界

仓库架构文档把系统拆成：

- `apps/web`：Next.js 15，页面包含 `/play`、`/n/[id]`、`/atlas`、`/status`；
- `apps/modal-backend`：FastAPI/Modal，提供 SSE 生成、点击 VLM、可选 LTX worker；
- `packages/config`：共享 TypeScript 类型（`GenerateEvent`、`GenerateRequestBody`、LTX/World 协议等）；
- `infra` 与 `docs`：Mongo 数据形状、部署和测试说明。[`docs/ARCHITECTURE.md`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/docs/ARCHITECTURE.md)

Web 端通过 Next `/api/*` 路由以 SSE/JSON 代理到 `MODAL_API_URL`；唯一的浏览器直连后端例外是可选 LTX WebSocket。[`docs/ARCHITECTURE.md`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/docs/ARCHITECTURE.md)

根依赖/脚本可确认 web 使用 Next 15、React 19、MongoDB driver、AWS S3 SDK（R2/MinIO）、Vitest 和 Playwright；后端 `pyproject.toml`/`requirements.txt` 可确认 FastAPI、Modal、OpenAI SDK、fal-client、Pydantic、Uvicorn、Pillow 等依赖。[根 `package.json`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/package.json)、[web `package.json`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/package.json)、[后端 `pyproject.toml`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/pyproject.toml)、[后端 `requirements.txt`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/requirements.txt)

### B.3 生成闭环与 SSE

`apps/modal-backend/generate.py` 的模块 docstring 和 `_event_stream` 入口给出了可确认顺序：

1. tap 模式先用 `click_to_subject` VLM 解析点击坐标对应的主题短语；
2. `plan_page` 规划页面标题、图像 prompt、事实和引用；
3. 图像生成，可选 progressive draft 与主渲染竞速；
4. 通过 SSE 发送状态、progress/draft、final 或 error；每个昂贵阶段轮询客户端是否断开，以便取消后续花费。[`generate.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/generate.py)、[`providers/generate_modes/tap.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/generate_modes/tap.py)

Web BFF [`apps/web/app/api/generate-page/route.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/api/generate-page/route.ts) 在转发前做会话所有权校验、幂等 key、Mongo 额度/消费上限检查，并把持久化图片 URL 尽力内联为 data URL；若有 World 状态，还注入精简 `world_context`。这说明“打开已存页面”与“重新生成”是不同路径，不能把 hydrate 当作一次模型调用。

`apps/web/app/play/page.tsx` 的 `generate` 回调消费 SSE：收到 status/progress/final/error 后更新页面、渐进草图、引用、历史和节点持久化；请求带 `AbortController`，导航或新生成会中止旧请求。[`page.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/play/page.tsx)

### B.4 任意跳转的低延迟策略：点击、预计算与预取

- 点击通过 [`normalizeClickOnImage`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/image-click.ts) 把指针坐标换算为图片内 0..1 坐标，并处理 `object-fit: contain` 的留白；Shift+drag 还可把自由笔画归纳为 bbox/centroid，并把红色十字或笔画重新编码进发送给 VLM 的图像。
- 页面准备完成且有稳定 `nodeId` 时，`page.tsx` 会调用 [`/api/precompute-candidates`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/api/precompute-candidates/route.ts)。后端 [`precompute_click_candidates`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/llm/click.py) 一次让 VLM 返回最多 8 个候选对象的坐标、主题、样式、显著性及 World 分类；客户端把候选放入同一缓存。
- `usePrefetchCache` 使用 `${nodeId}:${xBucket}:${yBucket}` 键；当前实现把每轴约 3% 网格量化为约 33×33 桶，候选预计算上限为 8，悬停完整解析每页上限为 6，缓存全局 FIFO/LRU 上限 200；悬停 debounce 450ms，只有一个解析请求在途，新的 hover 会 abort 旧请求。[`usePrefetchCache.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/hooks/usePrefetchCache.ts)、[`page.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac02d2a8c8e0735149/apps/web/app/play/page.tsx)
- 点击命中完整 hover 缓存时，生成请求直接带 `prefetched_subject/style/...`，后端 tap 流程跳过 VLM round-trip；候选-only 条目若缺少 `groundable/confidence`，允许后续 hover 升级为完整解析。[`providers/generate_modes/tap.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/generate_modes/tap.py)、[`page.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/play/page.tsx)
- 完整点击解析的结构包含 `subject`、`style`、`subject_context`、`groundable`、`confidence`、point/bbox、relative scale，以及可选 World `enter_as`、`place_form`、`clarifiers`、`surroundings`。[`providers/llm/click.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/llm/click.py)、[`packages/config/src/index.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/packages/config/src/index.ts)

这套设计能把“多数显著热点”的点击延迟压低，但**不能保证任意坐标零延迟**：未命中缓存仍要 VLM，缓存只在满足页面稳定/模式/预算条件时预热，而且预计算本身也会消耗一次 VLM 调用。

### B.5 标签、解释和引用：与官网“纯像素”目标的冲突点

- World Mode 的地图标签由 [`MapLabelOverlay`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/PlayPage/MapLabelOverlay.tsx) 以 DOM `<span>` 叠加，数据来自当前节点实体 bbox 或世界几何锚点；标签布局在 [`map-labels.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/map-labels.ts) 做碰撞避让，并明确只在 map frame 渲染。
- 规划器在线搜索产生的来源通过 [`CitationsChip`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/citations-chip.tsx) 作为 DOM chip/弹层展示；点击可打开来源 URL。
- 点击解释/摄像机设置通过 [`ClickDetailPopover`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/PlayPage/ClickDetailPopover.tsx) 提供 scene/submap、map/street/building/eye、投影、靠近/后退、仰视/俯视等控制；这是可用性增强，不是官网所说的“所有文字均为像素”的严格复刻。
- README 同时列出 `BranchBeacons`（已探索分支的点击点）、面包屑、`Time-scrubber (T)`（线性胶片式历史跳转）和可分享/可嵌入世界；这些功能使任意跳转可做成节点图导航，而不是依赖重新生成。[README](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/README.md)、[`BranchBeacons.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/PlayPage/BranchBeacons.tsx)、[`time-scrubber.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/time-scrubber.tsx)

### B.6 持久化、分享与零生成跳转

- 节点保存在 MongoDB，图片对象保存到 Cloudflare R2 或本地 MinIO；`NodeDoc` 至少含 `parent_id`、`session_id`、`click_in_parent`、sources、scene_view 和可选 `descent_video_url`。[`apps/web/lib/db.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/db.ts)
- `/n/[id]` 通过节点 ID 从 Mongo + R2 hydrate，而不是重新生成；README 明确将其描述为 permalink/zero-regenerate。[README](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/README.md)、[`apps/web/app/api/nodes/[id]/route.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/api/nodes/[id]/route.ts)
- 已发布 world 的 `/embed/[sessionId]` 是只读交互查看器，点击已生成页面的点位不再调用模型；这是低延迟回放路径，而不是开放式新探索。[`docs/ARCHITECTURE.md`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/docs/ARCHITECTURE.md)、[README](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/README.md)
- `selectFromMap`、面包屑、时间轴和分支信标都直接选择已有 `nodeId`；导航会 abort 当前生成、更新 URL/history，并把地图跳转追加到可回退 trail。[`page.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/app/play/page.tsx)、[`time-scrubber.tsx`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/components/time-scrubber.tsx)

### B.7 动画与低延迟边界

- 普通动画 provider [`providers/video.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/video.py) 的默认路径是 fal 图生视频，返回完整 MP4 URL；仓库 README 以约 5 秒 clip 描述它，属于异步生成后播放。
- 可选 LTX worker [`ltx_stream.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/ltx_stream.py) 使用 Modal GPU、LTX-Video pipeline、WebSocket 和 LTXF 分片协议；代码文件头明确写明当前 scaffold 会先生成完整 clip，再发一个 init + 一个 media segment，未来才切换为真正的多 segment 增量发射。首次空闲后冷启动约 60–90 秒也写在该文件注释中。
- 浏览器端 [`stream-client.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/stream-client.ts) 最多重连 3 次、以 `position` 请求恢复，并按 sequence 去重；[`mse-player.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/mse-player.ts) 通过 MediaSource/SourceBuffer 顺序追加 fMP4。
- LTXF 的公开格式是 `LTXF` magic + 大端 header 长度 + JSON header + fMP4 payload；服务端 [`ltxf.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/ltxf.py) 与浏览器 [`ltxf-parser.ts`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/web/lib/ltxf-parser.ts) 对应。

所以，“可以接入实时动画”已被代码结构证明；“点击后立即看到真正增量视频”没有被当前 worker 代码证明，文件本身反而将其标注为未来升级方向。

### B.8 国产/可替换模型接入的真实范围

- LLM/VLM 客户端 [`providers/llm/client.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/llm/client.py) 通过 OpenAI-compatible `AsyncOpenAI`，默认 OpenRouter；环境变量 `LLM_PROVIDER`/`LLM_BASE_URL` 可切换到 OpenAI、Anthropic、Google 或自定义兼容服务（如 Ollama、LM Studio、vLLM），模型名由环境变量覆盖。
- 结构化输出按模型家族在 `json_object`、tool、prompt/repair 梯度间降级；仓库代码把 `qwen` 列入可识别结构化模型家族，但并没有随仓库提供一个已验证的国产云厂商端点或真实 Qwen 运行结果。[`client.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/llm/client.py)
- 图像 provider [`providers/image.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/image.py) 默认走 fal，也可通过 OpenAI Images-compatible `IMAGE_PROVIDER`/`IMAGE_BASE_URL` 接入自定义服务；代码没有把“国产图像模型”作为已部署、已验收的固定实现。
- 动画 provider 当前是 fal LTX/Wan 等和自托管 LTX worker；没有国产视频模型适配器的仓库内事实。[`providers/video.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/providers/video.py)、[`ltx_stream.py`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/apps/modal-backend/ltx_stream.py)

## C. 合理推测（必须标注为推测）

1. `flipbook.page` 的公开 bundle 同时出现 `precompute-candidates`、`resolve-click`、`/ws/stream`、`LTXF` 与 `modal.run`，合理推测其生产前端与 openflipbook 采用了相近的候选预热 + 点击解析 + LTXF/MSE 思路；但这不能证明两者后端实现相同，官网服务端不可见。
2. 官网的“点击任意位置”体验要做到可接受延迟，工程上很可能需要缓存、候选预计算、图片代理/存储和异步状态流；openflipbook 的实现可作为可操作参考，但不能把缓存命中率或官网内部阈值写成事实。
3. “标签解释”更适合采用双轨：严格官网视觉模式让标签随图片像素生成；可访问性/准确性模式使用 DOM 标签、来源 chip 和结构化解释。这样可以兼顾官网外观与实际可读性，但这是本项目的设计建议，不是来源已经规定的行为。
4. 国产模型替换应优先从 OpenAI-compatible LLM/VLM seam 开始，随后分别验证图像生成的参考图/编辑能力和视频模型的首帧/尾帧约束；只替换模型名而不重做结构化输出、坐标归一化和视频协议适配，不能推导出等价体验。

## D. 无法验证 / 不应承诺

- 无法从公开官网确认官方后端源码、数据库 schema、真实模型型号/版本、服务端队列、GPU 数量、SLA、缓存命中率或任何具体延迟数字。
- 无法从演示 MP4 确认实时点击生成的首帧时间、实时帧率、过渡是否每次成功、视频生成是否真正增量输出；官网明确说示例是预生成并为速度剪辑。
- 无法确认官网当前页面是否对所有用户开放生成、是否需要 waitroom、是否存在地区/账户/额度限制；本次只做了未提交请求的公开页面观察。
- 无法确认 `openflipbook` 当前代码在本地无密钥、真实 Mongo/R2/Modal、真实 fal/OpenRouter 或国产模型端点上端到端可运行；源码审阅不等于部署/模型运行验证。
- 无法确认任何国产模型（通义/Qwen、智谱、豆包、百度、腾讯等）在该仓库的点击定位、中文文字渲染、图像编辑连续性或视频首帧性能上达到官网同等质量；需要独立、经授权的基准测试。本文没有发起付费请求。
- 无法从 MIT 许可推导出可以复制 `flipbook.page` 的品牌、专有资产或未公开服务实现；MIT 只覆盖 `openflipbook` 仓库按其许可证授予的代码范围。[`LICENSE`](https://github.com/eren23/openflipbook/blob/70d6478f2371d33ddac797dc02d2a8c8e0735149/LICENSE)

## E. 给后续架构文档的硬约束

- 把“视觉纯像素模式”和“DOM 辅助/解释模式”做成明确 feature flag，并分别验收，不能一边声称所有文字均为图片像素、一边把 DOM 标签算作官网 100% 复刻。
- 把已生成节点的本地/持久化跳转和未命中缓存的新生成拆成两条延迟预算：前者目标应为不调用模型，后者只能做 P50/P95 预算，不能承诺零延迟。
- 动画至少定义 `fallback MP4`、`LTXF WebSocket/MSE`、静态图片三档降级；在声称“实时”前，必须把增量推理、fMP4 分片、取消、重连、背压和 GPU 冷启动分别测量。
- 国产模型接入要保留 provider interface、结构化 JSON 校验/repair、坐标与 bbox 归一化、引用抽取和模型/成本/延迟观测；“国产”是供应商约束，不是质量或兼容性证明。
- 任何“达到官网演示效果”的验收都要排除官网预生成演示视频，增加真实交互的可重复场景、首状态/草图/最终图时间、点击命中率、视频首帧时间、连续性评分和失败降级统计。

