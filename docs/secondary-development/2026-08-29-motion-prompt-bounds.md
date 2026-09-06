# 万相动效提示词长度与反向约束

> 日期：2026-08-29  
> 范围：盐田 Flipbook 动效 adapter  
> 状态：已完成，未发起付费请求

## 变更目的

百炼文档规定：`wan2.2-kf2v-flash` 首尾帧提示词不超过 800 字符，`wan2.6-i2v-flash` 单帧提示词不超过 1500 字符。此前 adapter 对两者统一截取 1800 字符，且没有发送视频反向提示词，长页面提示可能把连续性指令截断。

## 修改范围

- `src/bailian-scene-pipeline.mjs`
  - 按 profile 使用 800/1500 字符上限。
  - 超长提示保留锁定语句前缀和页面主题后缀。
  - 两种视频请求都发送短 `negative_prompt`，禁止切镜、风格漂移、几何融化、文字变形和闪烁。
- `tests/bailian-scene-pipeline.test.mjs`
  - 增加长度上限和反向提示词断言。
- `docs/workflows/flipbook-dynamic-style-workflow.md`
  - 记录运行时压缩规则。

## 验证

- `npm test`：32/32 通过。
- `npm run validate:dataset`：20 个场景、60 个锚点通过。
- `node --check src/bailian-scene-pipeline.mjs`：通过。

依据：[万相首尾帧 API](https://help.aliyun.com/zh/model-studio/image-to-video-by-first-and-last-frame-api-reference)、[万相首帧 API](https://help.aliyun.com/zh/model-studio/image-to-video-api-reference)。本次没有发送 API Key、图片或付费请求。
