# 盐田 Flipbook 动态风格生成工作流

> 版本：v0.3  
> 日期：2026-08-29  
> 状态：参考包已接入百炼请求；尚未经过真实付费模型样本校准

## 1. 结论先行

需要建立工作流，但现在不应先做 Codex Skill。

- **工作流是必需的**：它固定参考图、风格字段、提示词编译、模型参数、首尾帧关系、评分和重试规则。
- **Skill 不是质量保证**：Skill 只能把流程自动化，不能消除生成模型的随机性、版本漂移和视频形变。
- **正确顺序**：先用项目工作流跑出至少 20 条已人工验收的节点跳转，再把稳定步骤封装为 Skill。

“百分之百固定成官网风格”是错误验收口径。即使固定 seed，百炼官方文档也只承诺结果相对稳定，不保证完全一致。应验收为：给定同一 Reference Pack 和 StyleReceipt，连续性、风格一致性、落点一致性达到项目阈值，不合格时可被检测并有界重生成。

## 2. 已确认事实与边界

### 2.1 官网公开信息

- `flipbook.page` 把每个页面定义为一张生成图片，图片内文字也由图像模型渲染。
- 官网称 live video stream 为实验功能，行为仍不可预测且资源消耗高。
- 官网公开的 `ParisExampleVideo.mp4` 明确标注为预生成并为速度剪辑。
- 2026-08-28 对该公开样片的本地探测结果为 1716x1080、30 fps、14.4 秒。视觉观察显示页面外壳基本固定，内容以浅色纸张、细线等距插画、信息图排版为主，页面跳转主要依靠点击中心的推进、平移和画面重组。这是样片观察，不是官网内部风格规范。

### 2.2 当前百炼能力

- `qwen-image-3.0` 支持文生图和 1-3 张参考图的图生图/编辑，可设置 size、negative_prompt、seed 和 prompt_extend。
- Qwen-Image 3.0 的同步接口是 `services/aigc/multimodal-generation/generation`；本项目采用异步任务并设置 `X-DashScope-Async: enable`，因此按官方异步文档使用 `services/aigc/image-generation/generation`，再通过 `/tasks/{task_id}` 轮询。两条路径不能混用。
- `wan2.2-kf2v-flash` 接受首帧和尾帧，固定生成 5 秒视频，适合已知两个页面之间的预生成过渡。
- `wan2.6-i2v-flash` 只锁定首帧，支持 2-15 秒，适合单页环境微动，不能保证最后一帧精确等于下一页。
- 两类视频任务通常需要 1-5 分钟，都是异步任务。它们不能承担点击后的即时反馈。

### 2.3 本项目当前状态

- 已有画布、热点、标签、历史跳转和本地过渡 Mock。
- 已配置百炼服务端地址和模型 ID；是否发起计费请求仍由 `MODEL_REQUESTS_ENABLED` 控制。
- `BailianScenePipeline` 已实现 Qwen 文本/VL、Qwen-Image 异步图像和 Wan 动效 adapter；本次只扩展了风格参考输入，没有发起真实模型调用。
- 本地 Mock 降级管线与云端 adapter 共用 `region → place → object` 的 tap 进阶规则，离线演示不会因降级而跳级。
- 目前仍没有真实百炼样本、OCR/视觉 critic、对象存储和生产级预算计量，因此不能宣称已经达到官方质量或实时性。

## 3. 风格资产的四层结构

### 3.1 Reference Pack

Reference Pack 必须使用自有、已授权或项目生成并经人工批准的素材。官网样片只用于观察，不能直接当作可商用训练资产。

每个风格包建议包含：

| 资产 | 数量 | 用途 |
| --- | ---: | --- |
| 根页面 | 4-8 张 | 固定整体媒介、色板和信息密度 |
| 局部特写 | 8-12 张 | 固定从地图进入建筑、设备、人物时的细节语言 |
| 合格首尾帧对 | 10-20 对 | 训练提示词规则和评测页面间连续性 |
| 失败样本 | 10 张以上 | 定义文字变形、结构融化、风格漂移等拒绝条件 |
| 动效片段 | 每种 motion profile 2-3 条 | 固定运镜速度、方向和允许的局部运动 |

每个资产记录 `asset_id`、SHA-256、权利来源、创建时间、适用场景和人工结论。不要只保存一个文件夹名称。

#### 3.1.1 本次落地的盐田参考包

用户提供的 7 张图已复制到 [`fixtures/style-reference/yantian/`](../../fixtures/style-reference/yantian/)，并由 [`manifest.json`](../../fixtures/style-reference/yantian/manifest.json) 记录原始文件名、尺寸、字节数和 SHA-256。它们是“用户生成的盐田风格参考”，不是官方 Flipbook 资产，也不自动授予对外分发或训练权利。

当前选择顺序按尺度固定：

| `scale_tier` | 参考顺序 | 目的 |
| --- | --- | --- |
| `region` | `region-overview` → `route-and-label-system` → `place-and-object-detail` | 先锁定港区总览、路线与标签，再补局部细节 |
| `place` | `place-and-object-detail` → `route-and-label-system` → `region-overview` | 先锁定地点/建筑细节，同时保留路径和大尺度方位 |
| `object` | `place-and-object-detail` → `sequence-layout` → `region-overview` | 先锁定对象线稿，再保留序列语法和环境上下文 |

`src/style-reference-pack.mjs` 会在校验 SHA-256 后按需把本地 PNG 转成 DashScope 接受的 Base64 `data:` URL；部署到有公网对象存储时，可设置 `STYLE_REFERENCE_BASE_URL`，请求只发送对应 HTTPS URL。每次 I2I 请求最多发送 3 张图，子节点优先发送父图，再取前两张风格图，避免父子空间关系被参考图覆盖。

### 3.2 Style Bible

盐田首版建议采用原创的“港口技术图志”方向，而不是复制官网品牌：

| 维度 | `yantian-editorial-etching-v1` 约束 |
| --- | --- |
| 媒介 | 等距技术插画、细墨线、淡彩地图、纸张底色 |
| 主色 | 纸白 `#F2F0E8`、石墨 `#343735`、海水青 `#6F9C9A`、植被绿 `#7E9877`、警示红 `#B34C43` |
| 构图 | 16:10，主对象占画面 35%-60%，留出 1-2 个信息区，不使用卡片堆叠 |
| 透视 | 近似正交或等距视角，避免夸张广角和景深虚化 |
| 线条 | 细而清楚，结构线优先，阴影用疏密排线，不用厚重 3D 塑料质感 |
| 文字 | 严格像素模式下由图像模型绘制；辅助模式下主图无永久 DOM 覆盖，解释按需出现 |
| 连续性 | 父图主体、点击区域、根风格图始终随子图传入；已有实体描述不可改写 |
| 禁止项 | 风格突变、镜头切换、几何融化、漂浮文字、随机新物体、强景深、霓虹赛博、照片质感 |

这套约束吸收了用户 7 张参考图的共同语言：米白纸张、蓝/青水彩大面、黑色手写标题、珊瑚/橙黄/绿色点缀、细墨线、路线虚线/箭头、浅色有机标签和引线。图中“旅行行程卡片”只作为 `sequence-layout` 参考，不会被默认复制到港口 `region` 页面；否则根页会变成海报拼贴，破坏官方演示那种由总览逐层进入单一目标的空间叙事。

当前 SceneNode 合同使用三档可落地尺度：`region → place → object`。`tap` 由 adapter 严格推进一档；“建筑内部”是 `object` 的构图 profile（剖视/入口揭示），不是另造一个未纳入 schema 的第四档，避免前端和模型对层级产生歧义。

比例边界：官方当前公开 live 画布 CSS 线索约为 16:9，而本项目现有图片/坐标合同是 16:10。此次只更新生图风格与参考输入，没有擅自改动前端比例；如果要追求像素级画布一致，下一步应单独迁移坐标和响应式验收，不能把两种比例混写成已完成。

### 3.3 StyleReceipt

每个 SceneNode 保存一份生成收据。示例：

```json
{
  "schema_version": "1.0",
  "style_id": "yantian-editorial-etching-v1",
  "style_version": 1,
  "reference_pack_id": "refpack_yantian_v1",
  "prompt_template_version": "scene-v2",
  "prompt_hash": "sha256:...",
  "palette": {
    "paper": "#F2F0E8",
    "ink": "#343735",
    "water": "#6F9C9A",
    "vegetation": "#7E9877",
    "accent": "#B34C43"
  },
  "composition": {
    "aspect_ratio": "16:10",
    "projection": "isometric",
    "subject_coverage": [0.35, 0.60]
  },
  "continuity": {
    "parent_asset_sha256": "...",
    "region_crop_sha256": "...",
    "style_reference_sha256": "...",
    "region_box": [0.42, 0.28, 0.21, 0.16],
    "entity_locks": ["container crane A: red boom, grey tower, six legs"]
  },
  "image": {
    "model": "qwen-image-3.0",
    "mode": "i2i",
    "size": "1536*960",
    "seed": 186324901,
    "n": 1,
    "prompt_extend": false
  },
  "motion": {
    "profile": "dive_to_anchor",
    "transition_model": "wan2.2-kf2v-flash",
    "ambient_model": "wan2.6-i2v-flash",
    "resolution": "720P",
    "seed": 78154210,
    "audio": false
  }
}
```

seed 应由 `session_id + edge_id + style_version` 的哈希稳定派生，而不是所有页面共用一个常量。当前 adapter 以请求幂等键、父节点和锚点派生稳定 seed；接入持久化 edge 后应把 edge ID 纳入派生输入。模型版本、完整参数、耗时、费用和输出 SHA 继续写入 ModelReceipt。

### 3.4 Motion Grammar

第一版只允许少量可测试的动作，不让模型自由决定镜头：

| profile | 场景 | 浏览器即时过渡 | 异步视频提示 |
| --- | --- | --- | --- |
| `dive_to_anchor` | 点击建筑、设备、人物 | 围绕点击点放大到裁剪比例 | 单镜头缓慢推进，主体结构保持不变 |
| `pan_to_neighbor` | 同尺度相邻区域 | 水平平移并保留 15% 旧画面上下文 | 单镜头横移，禁止切镜和新增地标 |
| `ascend_to_context` | 返回上层地图 | 从局部缩小到父图位置 | 镜头平稳拉远，尾帧严格落到父图 |
| `diagram_explode` | 展示结构原理 | 局部遮罩展开 | 部件小幅分离，位置可追踪，禁止溶解 |
| `ambient_hold` | 用户停留页面 | 不切页，只做轻微视差 | 水面、云、吊机等局部微动，镜头近似静止 |

## 4. 运行时三级策略

```text
点击
  -> 0-50 ms: 本地命中检测、涟漪和忙碌态
  -> 50-900 ms: 浏览器按 motion profile 做确定性 transform/mask 过渡
  -> 草稿 ready: 解码后替换为新页面，保证最终落点正确
  -> 最终图 ready: 更新锚点、StyleReceipt 和缓存
  -> 后台: 有已知首尾帧时生成 kf2v；需要单页微动时生成 i2v
  -> 下次命中同一 Edge: 直接播放缓存片段或本地过渡，零模型调用
```

### Tier A：本地确定性过渡

- 永远启用，是最低感知延迟的保证。
- 使用 CSS transform、mask 或 Canvas 合成；图片必须先 `decode()` 再换帧。
- 运动终点必须和下一页采用的裁剪窗口一致，否则会出现“先放大这里、结果跳到别处”。
- `prefers-reduced-motion` 下改为短淡入或直接切换。

### Tier B：首尾帧过渡视频

- 只在首图和尾图都已经确定后提交 `wan2.2-kf2v-flash`。
- 默认 720P、5 秒、无水印、固定 seed、`prompt_extend=false`，由自己的 Motion Prompt Compiler 输出完整提示词。
- adapter 按官方限制将首尾帧提示词压到 800 字符、Wan 2.6 单帧提示词压到 1500 字符，并发送短 `negative_prompt`；压缩时保留锁定语句的开头和页面主题的结尾。
- 结果按 `first_sha + last_sha + motion_profile + model_version + seed` 去重并永久转存。
- 生成需要分钟级时间，因此用于预取、回放和热门路径，不能等待它完成后才进入新页面。

### Tier C：单页环境动效

- 使用 `wan2.6-i2v-flash`，首轮参数为 720P、2 秒、`audio=false`、固定 seed。
- 只允许 1 个镜头动作、1 个主体动作、1 个环境动作。
- 视频最后 150-250 ms 与静态最终图交叉淡化，避免尾帧漂移暴露。
- 这一级不负责页面间导航，只是让画面在停留时“活起来”。

真流式推理不属于当前百炼托管 API 已确认能力。把完整视频生成后再通过 WebSocket 分片发送，只是流式传输，不是低首帧延迟的流式生成。

## 5. 提示词编译规则

不要让用户文本直接进入生图或视频模型。先由 PagePlanner 输出严格 JSON，再由确定性模板拼接。

### 5.1 图像正向提示词顺序

```text
[媒介锁] + [色板锁] + [父场景与实体锁] + [点击区域与尺度变化]
+ [本页主题] + [构图] + [需要出现的事实/标签] + [输出语言]
+ [清晰度与可读性]
```

图生图参考顺序固定为：

1. **当前实现**：完整父图（子页）优先，保持局部世界关系。
2. **当前实现**：按尺度选择的风格图，只锁媒介、线条、色板和标签语法，不抢构图。
3. **后续增强**：从父图生成的点击区域裁剪图放在父图之前，作为对象权重最高的局部参考；当前尚未实现远程图片裁剪，因此不把它写成已完成能力。

### 5.2 通用图片反向提示词

```text
photorealistic, 3D plastic render, neon cyberpunk, dramatic depth of field,
fisheye lens, style shift, duplicated structures, floating labels,
warped Chinese text, illegible text, random icons, excessive gradients
```

### 5.3 页面过渡视频提示词

```text
One continuous shot. The camera smoothly dives from the exact selected region
in the first frame into the matching subject and composition in the last frame.
Preserve the editorial isometric ink illustration, paper texture, palette,
architecture, labels and object count. No cut, no new object, no style change.
```

视频反向提示词固定包含：

```text
camera cut, scene replacement, style shift, geometry melting, duplicated object,
new text, warped typography, flicker, unstable border, sudden zoom, motion blur
```

### 5.4 当前 adapter 的确定性编译步骤

代码中的 `planPage` 已将模型返回的自由文本收敛为以下顺序，生图模型不会直接接收用户原句：

```text
[STYLE_LOCK 媒介/色板]
→ [SCALE_GUIDANCE region/place/object]
→ [LABEL_GUIDANCE 标签与引线]
→ [参考包用途声明]
→ [父图/锚点/环境连续性锁]
→ [PagePlanner 的主题 prompt]
→ [中文短标签可读性要求]
```

`renderImage` 的 I2I `content` 顺序也固定：根页为风格参考图 → 单个 text；子页为父节点最终图 → 两张按尺度选择的风格参考图 → 单个 text。该顺序和数量由 `src/style-reference-pack.mjs` 与 `src/bailian-scene-pipeline.mjs` 测试锁定，参考图只用于媒介/线条/色板/标签语法，不复制参考图中的地点文字。

运行时配置：

```text
STYLE_REFERENCE_ENABLED=true
STYLE_REFERENCE_MANIFEST=fixtures/style-reference/yantian/manifest.json
STYLE_REFERENCE_MAX_IMAGES=3
# 有公网对象存储时再设置；本地开发不需要
STYLE_REFERENCE_BASE_URL=https://<public-host>/style-reference/yantian
```

关闭 `STYLE_REFERENCE_ENABLED` 时，流程仍可运行，但只剩文字风格合同；这适合排查模型或请求体问题，不应作为正式风格评测结果。

## 6. 自动评测与有界重生成

每张最终图至少评五个独立轴：

| 轴 | 比较对象 | 拒绝条件 |
| --- | --- | --- |
| 语义命中 | 用户点击目标、计划 JSON、最终图 | 进入了错误对象或尺度 |
| 同一地点 | 父图区域、子图 | 关键结构、方位或实体身份丢失 |
| 媒介一致 | 风格参考、子图 | 从线描淡彩漂移到照片、3D 或其他画风 |
| 构图合规 | Style Bible、子图 | 主体覆盖、留白、透视严重偏离 |
| 文字可读 | 计划文案、OCR | 关键中文错字、乱码或遮挡 |

视频再增加四个轴：首帧相似度、尾帧相似度、时间闪烁、运动方向一致性。

控制规则：

- 每个资源默认最多 2 次尝试。
- 只有 critic 给出明确拒绝原因时才重试；critic 失败时不盲目烧钱。
- 第二次提示词必须带上第一次的具体失败原因。
- 保留评分更高的结果，重试不能覆盖更好的旧结果。
- OCR 关键字错误优先改为 DOM 辅助标签，不无限重生整张图。
- 阈值在首批 20 条人工样本上校准；校准前不宣称“风格已固定”。

## 7. 延迟和成本约束

- 已生成节点、历史和分享链接：只读缓存，不调用模型。
- 新点击：先本地过渡，再草稿，再最终图；视频永远不阻塞静态图。
- 每页最多预取 3 个高置信锚点，默认只预取静态图；视频只预取热门或用户停留概率高的 Edge。
- 视频任务轮询间隔建议 15 秒，任务与结果 URL 24 小时内转存。
- 所有自动重试、预取和视频任务都计入日预算；达到预算后自动降级为 Tier A。

## 8. 何时封装为 Skill

满足以下条件再创建 `yantian-flipbook-style` Skill：

1. 至少 20 条首尾帧路径经人工验收，StyleReceipt 字段不再频繁变动。
2. Motion Grammar 至少有 3 种 profile 通过重复样本。
3. 图片和视频评分脚本能稳定识别主要失败类型。
4. 模型 adapter、预算闸门和缓存键已经实现并有测试。

届时 Skill 应包含工作流说明、JSON Schema、提示词模板、评分脚本和样本清单，不应只是一个长 prompt。Skill 负责重复执行，项目服务仍负责密钥、计费、异步任务、存储和权限。

## 9. 首轮付费评测建议

在轮换 Key、确认模型权限和再次确认费用后，首轮只做小样本：

1. 2 张根页面候选。
2. 2 次基于父图和点击裁剪的图像编辑。
3. 1 条 `wan2.2-kf2v-flash` 首尾帧过渡。
4. 1 条 `wan2.6-i2v-flash` 2 秒无声环境微动。

总计 6 次生成任务。执行前应按控制台实时价格计算上限并取得一次即时确认；本工作流编写过程没有发起这些调用。

## 10. 来源

- [Flipbook 官网](https://flipbook.page/)
- [openflipbook 仓库](https://github.com/eren23/openflipbook)
- [本项目官方公开页面与动效截图分析（2026-08-29）](../research/flipbook-style-and-motion-analysis-2026-08-29.md)
- [本项目官方截图/抽帧 manifest](../research/assets/flipbook-official/manifest.json)
- [千问图像生成与编辑 3.0](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)
- [万相基于首帧图生视频](https://help.aliyun.com/zh/model-studio/image-to-video-api-reference)
- [万相基于首尾帧生视频](https://help.aliyun.com/zh/model-studio/image-to-video-by-first-and-last-frame-api-reference)
