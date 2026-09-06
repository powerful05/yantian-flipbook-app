# 参考图归档、官方动效研究与百炼风格流程接入

> 日期：2026-08-29  
> 范围：盐田 Flipbook 本地 PoC  
> 状态：已完成本地实现与离线验证；未发起百炼付费请求

## 变更目的

把用户提供的 7 张绘画风格图从“聊天附件”变成可追溯的项目参考包，并把公开 Flipbook 演示中可观察到的远近推进、尺度分层和标签语法转成可执行的生图提示词合同。目标是提高国产模型输出的一致性；这不等于模型已经学会官网风格，也不构成对官网后端或品牌资产的复制。

## 文件范围

- 新增 `fixtures/style-reference/yantian/*.png`：7 张用户提供的参考图，使用 ASCII 文件名保存。
- 新增 `fixtures/style-reference/yantian/manifest.json`：原始文件名、尺寸、字节数、SHA-256、用途和参考授权边界。
- 新增 `src/style-reference-pack.mjs`：校验 manifest/哈希，按 `region/place/object` 选择参考图；本地文件转 DashScope Base64，部署时可切换公网 URL。
- 修改 `model-config.mjs`：增加 `STYLE_REFERENCE_ENABLED`、`STYLE_REFERENCE_MANIFEST`、`STYLE_REFERENCE_BASE_URL`、`STYLE_REFERENCE_MAX_IMAGES` 配置及脱敏状态字段。
- 新增 `.env.example`：提供上述非敏感配置模板。
- 修改 `src/bailian-scene-pipeline.mjs`：加入风格/标签/尺度合同、父子深度约束、参考图顺序和 `scene-v2` prompt 收据；子页父图优先，根页按尺度发送最多 3 张参考图。
- 新增 `tests/style-reference-pack.test.mjs`，扩展 `tests/bailian-scene-pipeline.test.mjs`：锁定哈希、选择顺序、Base64/公网 URL、父图优先和 tap 逐层推进。
- 更新 `docs/workflows/flipbook-dynamic-style-workflow.md`：记录实际接入方式和关闭/部署选项。
- 新增 `docs/research/flipbook-style-and-motion-analysis-2026-08-29.md` 及 `docs/research/assets/flipbook-official/`：官方公开页面截图、视频抽帧和事实/推测边界。

## 前后行为

变更前：工作流文档描述了 Reference Pack，但百炼 adapter 的 `planPage` 没有加载本地参考图；生图请求只能收到文本 prompt 和可选父图。

变更后：

1. 根节点按 `region` 选择总览、路线/标签和局部细节参考，作为 I2I `image` 输入。
2. 点击子节点时先发送父节点最终图，再发送两张风格参考，避免风格图抢走空间连续性。
3. `tap` 不接受模型自由跳级：有父尺度时严格按 `region → place → object` 推进一层（到 `object` 后保持 object）。
4. Prompt 固定包含纸张/墨线/色板、尺度职责、标签引线规则、参考图用途声明和父图锚点连续性。
5. 关闭参考包仍可运行，便于排查请求问题，但该模式不应作为正式风格评测结果。

## 接口影响

公开 SSE、Session、SceneNode schema 不变。新增配置只在服务端生效；浏览器不会收到 API Key 或参考图绝对路径。`style_receipt.prompt_template_version` 从 `scene-v1` 更新为 `scene-v2`，`style_version` 保持 1 以避免无必要的数据迁移；新节点记录实际 `reference_pack_id`。

## 验证

- `node --check src/style-reference-pack.mjs`：通过。
- `node --check src/bailian-scene-pipeline.mjs`：通过。
- `npm test`：32/32 通过。
- `npm run validate:dataset`：20 个场景、60 个锚点通过。
- 参考包 manifest JSON、7 个本地图像 SHA-256：通过。
- 官方截图/抽帧 manifest：11 个资源路径和 SHA-256 通过；公开视频经 `ffprobe` 核对为 1716×1080、30 fps、14.4 秒。
- 未提交官方搜索、上传用户文件或百炼付费生成请求。

## 部署与回滚

本地开发默认从 manifest 读取并发送 Base64；生产环境应把参考图转存到已授权的 OSS/S3 公网地址，再设置 `STYLE_REFERENCE_BASE_URL`，避免把大 Base64 放进每个请求。回滚时将 `STYLE_REFERENCE_ENABLED=false` 即可恢复无参考图的旧 prompt 流程；删除新增参考包不会影响已有 SceneNode，但会使后续请求退回文字合同。

## 未完成

- 尚未用真实百炼样本校准风格/连续性/OCR 阈值。
- 官方 live 画布公开 CSS 约为 16:9，而现有项目合同为 16:10；本次未改比例，避免坐标迁移与风格接入混在一起。
- 尚未接入 OSS 永久存储、预算计量、critic 和有界重生成。
- 尚未证明国产模型的真实首帧延迟、视频连续性或与官方演示等质量。
