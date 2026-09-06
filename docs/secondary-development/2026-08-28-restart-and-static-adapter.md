# 重启恢复与百炼静态适配器变更记录

> 日期：2026-08-28  
> 范围：盐田 Flipbook 本地 PoC  
> 状态：已完成离线验证，未发起付费模型调用

## 变更目的

电脑重启后恢复 4189 本地服务，完成 P2 浏览器验收，并把架构中的静态国产模型 seam 落成可测试的服务端适配器。默认仍使用确定性 Mock，避免未确认费用时误调用云模型。

## 文件范围

- 新增 `src/bailian-scene-pipeline.mjs`：Qwen 文本/VL、Qwen-Image 异步任务、图片元数据和模型收据。
- 新增 `tests/bailian-scene-pipeline.test.mjs`：伪造 HTTP 响应测试结构化请求、任务轮询、图片资产和已知锚点缓存。
- 修改 `server.mjs`：配置完整且显式打开付费请求时选择百炼适配器，否则选择 Mock。
- 修改 `.env.example`：移除旧 Key，只保留空占位符。
- 修改 `app.js`：显示实际 provider 状态，并把当前本地动效标记为 `MOTION PREVIEW`；过渡焦点跟随点击位置。
- 修改 `styles.css`：移除窄屏 `html` 最小宽度造成的横向滚动条。
- 新增 `docs/PROJECT-STATUS-2026-08-28.md`：阶段状态、验收证据和后续步骤。

## 前后行为

变更前：服务端只有 Mock 场景 pipeline，百炼地址和模型配置存在，但不能执行静态生成。

变更后：

- `MODEL_REQUESTS_ENABLED=false` 或配置不完整时，仍使用 Mock。
- 配置完整并显式打开后，按 `resolveAnchor -> planPage -> renderDraft -> renderFinal` 调用百炼。
- 图片接口采用异步任务创建和轮询，返回的资源包含 URL、尺寸、MIME 和 SHA-256。
- 已知父节点锚点直接复用，不重复调用 VLM。
- 模型响应必须解析为结构化 JSON；失败会进入 SSE 错误事件，错误消息不包含 API Key。

## 验证

- `npm test`：20/20 通过。
- `npm run validate:dataset`：20 场景、60 锚点通过。
- `node --check src/bailian-scene-pipeline.mjs`：通过。
- `GET /api/model/status`：付费关闭、Key 未配置、服务走 Mock。
- 浏览器 P2 冒烟：搜索、SSE、解释、子节点、历史、标签开关、动效开关、分享菜单通过。
- Chrome 320/390 px：无横向溢出，解释面板在视口内；动效开关显示本地预览而非真实视频。
- 非依赖文件敏感信息扫描：未保留完整 Key；脚本中的环境变量赋值属于运行时注入，不是凭据。

## 接口影响

无新增公开接口。现有 `POST /v1/sessions/{id}/generate` 在服务配置完整时由适配器提供同一 SSE 合同。

## 未完成和下一步

- 真实付费静态样本尚未执行，需在执行前确认模型权限、样本数量和费用上限。
- `cost_cny` 仍是占位值，需接入真实计量。
- 视频、持久化、分享恢复、预取、预算和真流式属于 P3-P5，见项目进度文档。

## 回滚

开发环境可将 `MODEL_REQUESTS_ENABLED` 设回 `false`，服务即恢复 Mock；不需要删除数据库或远程资源。本次未创建付费任务，也未修改远程数据。
