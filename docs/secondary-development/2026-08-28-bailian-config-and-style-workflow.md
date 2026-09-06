# 百炼安全配置与动态风格工作流变更记录

> 日期：2026-08-28  
> 范围：盐田 Flipbook 本地 PoC

## 变更目的

在不把长期 API Key 写入前端、项目文件或日志的前提下，固定百炼业务空间地址和模型 ID，并建立动态风格的项目级生成规范。此次变更不发起付费模型调用。

## 文件范围

- 新增 `.gitignore`、`.env.example`：忽略本地环境文件并给出非敏感配置模板。
- 新增 `model-config.mjs`：读取、校验并脱敏展示服务端模型配置。
- 修改 `server.mjs`：增加只读 `GET /api/model/status`。
- 修改 `package.json`：支持 `.env.local`、隐藏输入 Key 的启动方式和 Node 内置测试。
- 新增 `scripts/start-with-model-key.ps1`：Key 仅进入当前 Node 子进程环境，不落盘。
- 新增 `tests/model-config.test.mjs`：验证默认锁费、地域 Host 一致性和 Key 不被序列化。
- 更新 `docs/research/cloud-model-selection-2026-08-28.md`：区分首尾帧过渡与单页环境动效模型。
- 新增 `docs/workflows/flipbook-dynamic-style-workflow.md`：定义 Reference Pack、Style Bible、StyleReceipt、Motion Grammar 和评测闭环。

## 前后行为

变更前：项目只有静态文件服务，模型地址、Key 状态和计费开关没有服务端配置边界。

变更后：服务端可以报告模型配置是否完整，默认 `MODEL_REQUESTS_ENABLED=false`；浏览器只能看到布尔状态和非敏感模型信息，看不到 API Key。当前仍没有真实模型生成路由。

## 接口影响

新增：

```text
GET /api/model/status
```

该接口返回供应商、地域、非敏感 Endpoint、模型 ID、Key 是否存在、付费请求是否启用、动效模式和配置问题。响应使用 `Cache-Control: no-store`。

## 验证要求

- `npm test`
- `node --check server.mjs`
- 启动后检查 `/` 和 `/api/model/status`
- 全项目扫描 API Key 模式，结果必须为空
- 不调用百炼生成接口

## 部署与回滚

开发环境可复制 `.env.example` 为被忽略的 `.env.local`，但更推荐运行 `npm run dev:models` 后在隐藏提示中输入已轮换 Key。生产环境应使用平台 Secret，不使用 `.env.local`。

回滚只需恢复 `server.mjs` 和 `package.json`，并移除本记录列出的新增文件；没有数据库迁移、远程资源或付费任务需要回滚。

