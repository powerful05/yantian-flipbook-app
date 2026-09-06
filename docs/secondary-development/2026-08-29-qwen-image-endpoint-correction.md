# Qwen-Image 3.0 同步/异步端点核对

> 日期：2026-08-29  
> 范围：盐田 Flipbook 百炼图像生成 adapter  
> 状态：已完成核对，未发起付费请求

## 发现

百炼公开文档同时列出两条路径：同步调用使用 `services/aigc/multimodal-generation/generation`；异步调用在请求头加入 `X-DashScope-Async: enable` 后，创建任务必须使用 `services/aigc/image-generation/generation`。本项目是异步调用，因此原有 `image-generation` 路径是正确的。

## 修改

- `src/bailian-scene-pipeline.mjs`：保持异步 `image-generation/generation`，并继续发送父图优先、最多 3 张参考图和单个 text。
- `tests/bailian-scene-pipeline.test.mjs`：保持异步路径断言，防止将来误改为同步端点。
- `docs/workflows/flipbook-dynamic-style-workflow.md`：记录同步/异步端点区别。

## 验证

- `npm test`：32/32 通过。
- `npm run validate:dataset`：20 个场景、60 个锚点通过。
- `node --check src/bailian-scene-pipeline.mjs`：通过。
- 依据：[百炼 Qwen-Image 3.0 API 文档](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)。

本次没有发送 API Key、图片或付费请求到百炼。
