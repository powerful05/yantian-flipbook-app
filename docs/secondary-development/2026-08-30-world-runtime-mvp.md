# WorldRuntime MVP 二次开发记录

## 变更范围

本次按《盐田 Flipbook 最小可实现 MVP 方案》落地一个固定的本地 2.5D 交互世界。目标是验证用户是否可以像游戏一样点击实体、进入下一层、返回上一层，并在对象场景中触发一个可见的本地状态动作。

MVP 范围保持为单用户、单进程、固定场景、浏览器 Canvas、客户端状态机和 `sessionStorage`。本次没有引入 Three.js、数据库、Redis、OSS/MinIO 或真流式视频，也没有发起百炼模型请求。

## 修改文件

| 文件 | 责任 |
| --- | --- |
| `fixtures/mvp-world.json` | 固定 5 个场景、15 个实体、坐标、动作和解释摘要 |
| `contracts/scene-manifest.schema.json` | `WorldManifest` 的字段、坐标、动作和引用合同 |
| `client/world-manifest.mjs` | manifest 加载、校验和场景/实体索引 |
| `client/world-runtime.mjs` | 命中、动作、状态、历史、过渡锁和存储恢复 |
| `app.js` | 将现有 Canvas、热点层和解释面板接入 `WorldRuntime` |
| `index.html` / `styles.css` | MVP 入口、过渡提示、状态面板和移动端布局 |
| `model-config.mjs` | 增加服务端 `MVP_WORLD_MODE` 配置和公开状态字段 |
| `.env.example` | 增加 `MVP_WORLD_MODE=false` 示例 |
| `tests/world-manifest.test.mjs` | manifest 合同和引用完整性测试 |
| `tests/world-runtime.test.mjs` | 状态机、命中、过渡、返回和恢复测试 |
| `tests/model-config.test.mjs` | MVP 默认模式开关测试 |

## 前后行为

之前页面只有空白画布、普通搜索/SSE 和生成节点路径；没有一个独立的固定世界状态模型。

现在打开 `http://127.0.0.1:4190/?demo=mvp` 后可以完成：

```text
盐田港总览
  → 集装箱码头
    → 自动化桥吊
      → 吊具小车：启动/停止作业
```

已知 manifest 实体的点击只经过本地 `WorldRuntime`，使用确定性的 Canvas 绘制和约 520 ms 的 CSS/Canvas 聚焦过渡，不走 `/v1/sessions`、`/generate` 或视频生成接口。实体解释面板显示名称、类型、摘要和本地状态；返回和刷新不会撤销已启动的吊具小车状态。

## 配置边界

`MVP_WORLD_MODE` 只决定无参数首页是否自动进入 MVP：

- `MVP_WORLD_MODE=false`：默认首页保持原有空白/搜索路径，显式 `?demo=mvp` 仍然可用；
- `MVP_WORLD_MODE=true`：无 `demo`、`session`、`node` 参数时，首页根据 `/api/model/status` 自动进入 MVP；
- 显式 `?demo=mvp` 时跳过模型状态读取，固定世界不依赖百炼可用性；
- 退出 MVP 后 URL 清除 `demo` 和 `scene`，普通搜索/SSE 路径恢复。

浏览器只接收 `mvpWorldMode`、模型是否配置等公开布尔/非敏感状态，不接收任何 API Key。新增文档、fixture 和前端代码均未写入密钥。

## 外部接口

`WorldRuntime` 暴露以下客户端接口：

```js
loadScene(sceneId)
hitTest({ x, y })
dispatch({ type: "inspect" | "enter" | "toggle", entityId, stateKey? })
completeTransition(transitionId)
cancelTransition(transitionId)
closeInspect()
back()
snapshot()
```

状态快照包含 `worldId`、`sceneId`、`phase`、`selectedEntityId`、`history`、`entityState` 和 `lastError`。存储键为 `yantian-flipbook:mvp:yantian-port-mvp`，存储不可用时内存状态仍然有效。

## 验证记录

验证日期：2026-08-30。浏览器：Codex In-app Browser。实际页面端口：`4190`。

已完成的浏览器路径：

1. 打开 `/?demo=mvp`，标题为“盐田港总览”，显示 4 个热点；
2. 点击“集装箱码头”，约 520--750 ms 后标题为“集装箱码头”，URL 含 `scene=scene_terminal`；
3. 点击“自动化桥吊”，标题为“自动化桥吊”，URL 含 `scene=scene_crane`；
4. 点击“吊具小车”，解释面板显示“作业中 / LIVE STATE”和“停止作业”；
5. 返回码头再进入桥吊，点击吊具小车会显示“作业已停止”，证明深层状态仍保留；
6. 刷新桥吊页面，场景仍为“自动化桥吊”，解释面板恢复 `STATE / ACTIVE`，状态按钮仍为“停止作业”；
7. 关闭解释面板后点击场景左上空白区域，提示“点击场景中的标记区域继续探索”，没有误命中；
8. 320 px 和 390 px 视口均无横向溢出，解释面板右边界未越过内容视口；桌面宽度同样无横向溢出；
9. 控制台未发现 error 或 warning。

`prefers-reduced-motion` 已保留在 `styles.css` 的全局降级规则中；同时 `app.js` 会把 MVP 场景提交等待从 520 ms 降到 40 ms。MVP 场景切换不依赖动效开关，降级时仍会提交目标场景和本地状态。

## 自动化测试

```text
node --check app.js
node --check client/world-runtime.mjs
node --check client/world-manifest.mjs
npm test
npm run validate:dataset
```

结果：`npm test` 共 55 个测试，全部通过；`npm run validate:dataset` 通过。Manifest 读取结果为 5 个场景、15 个实体。

## 部署和回滚

本地启动：

```powershell
$env:PORT = "4190"
$env:MODEL_REQUESTS_ENABLED = "false"
$env:MOTION_GENERATION_MODE = "off"
$env:MVP_WORLD_MODE = "false"
npm run dev
```

回滚只需将 `MVP_WORLD_MODE` 设为 `false` 并重启 Node 服务；已有测试、manifest 和代码可以保留，显式 `?demo=mvp` 仍作为开发验收入口。MVP 没有数据库迁移、对象存储写入或远程资源删除，因此不需要数据回滚。

## 明确不包含的能力

- 不是完整 3D 建模、真实碰撞检测或物理模拟；
- 不是实时模型生成，也不是百炼真流式视频；
- 不是跨设备/跨服务重启的持久化世界；
- 没有真实百炼样本、视频质量指标、鉴权、预算审计或生产压测。
