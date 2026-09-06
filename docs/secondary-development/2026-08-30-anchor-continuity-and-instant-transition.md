# 锚点连续性与即时过渡修复

## 范围

修复“点击海洋世界后回到小梅沙/根图”的导航连续性问题，并把点击后的第一段反馈改为浏览器本地确定性过渡。未发起新的百炼付费请求。

## 修改内容

- `src/flipbook-engine.mjs`
  - 对 tap 计划执行目标锚点锁：子节点标题固定为已选锚点，提示词禁止替换为其他地点。
  - 以 `session + parent_node + anchor_id` 建立进程内已知导航索引，重复点击直接返回已有子节点。
  - 计划器返回冲突地点时清理冲突描述，不把冲突标题写入节点。
- `src/bailian-scene-pipeline.mjs`
  - 客户端未传 `anchor_id` 时，优先按查询文本、父图 bbox 和邻近点复用已知锚点，再调用 VL。
- `src/mock-scene-pipeline.mjs`
  - 子场景把目标锚点提升为首个锚点，Mock 与云端目标连续性规则保持一致。
- `app.js`、`client/transition-focus.mjs`、`styles.css`
  - 热点点击同时打开解释并立即进入。
  - 根据锚点 `point/bbox` 计算缩放中心、平移和尺度；过渡期间不等待模型或视频。
  - 已知子节点在浏览器端直接复用；生成失败时保留父图，不切换到无关根图。
  - 分享链接改为 `session + node`，同进程内可零模型 hydrate 已知节点。
- `client/generation-client.js`、`server.mjs`
  - 增加节点/会话只读读取接口客户端方法；静态服务器正确返回 `.mjs` 的 JavaScript MIME 类型。

## 验证

- `npm test`：40/40 通过。
- `npm run validate:dataset`：20 个场景、60 个唯一锚点通过。
- `node --check`：前后端变更文件通过。
- Mock 浏览器验收：点击锚点约 40ms 内进入 bbox 聚焦过渡；最终节点保留目标标签且不出现“小梅沙”；重复点击命中 `LOCAL / KNOWN NODE`。
- 4189：已重启，空画布和空搜索框状态正常；没有执行真实生成请求。

## 尚未完成

当前 `FlipbookEngine` 的 session/node/edge/idempotency 仍保存在进程内 `Map`。项目没有 MongoDB/MinIO SDK、对象存储转存、任务流水账本、预算扣费记录或供应商取消 API；分享链接因此只能在同一运行进程中恢复，重启后仍会失效。这些能力不能仅凭 URL 参数或 `AbortController` 宣称已完成。

