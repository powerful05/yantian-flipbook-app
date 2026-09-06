# 盐田 Flipbook 最小可实现 MVP 方案

> 版本：MVP v0.1  
> 编写日期：2026-08-30  
> 状态：MVP 已按本方案落地并完成本地验收；后续升级项仍为方案  
> 适用项目：`C:\Users\覃冠杰\Desktop\盐田Flipbook`

## 1. 一句话结论

MVP 采用 **单用户、单进程、2.5D、固定场景清单、浏览器本地交互** 的路线：

```text
结构化 SceneManifest
        ↓
WorldRuntime（命中、动作、状态、历史、过渡）
        ↓
现有 Canvas / 图片 / 视频合成器
        ↓
点击后立即进入下一场景
```

模型不是 MVP 的实时控制器。MVP 先用确定性的场景和资产证明“像游戏一样点击、进入、返回、改变状态”的体验；现有 Qwen/VL、Qwen-Image 和 Wan 链路作为可选适配器接入，不作为 MVP 的通过条件。

这里的“实时”定义为：**已知场景和动作在浏览器本地完成，点击反馈 p95 ≤ 50 ms，场景过渡约 420--650 ms；不等待模型或网络。** 这不等于模型在 50 ms 内生成新图片或视频。

## 2. 先校正目标和范围

### 2.1 本方案解决的问题

用户打开盐田港视觉场景后，可以：

1. 点击“集装箱码头”等实体；
2. 立即看到以点击点为中心的局部推进过渡；
3. 进入下一层场景；
4. 点击下一层的桥吊、堆场或设备；
5. 查看解释面板；
6. 对一个实体执行一个简单动作，例如“启动作业”；
7. 返回上一层；
8. 重复点击同一个实体时复用同一场景，不重复生成、不重复请求；
9. 刷新当前标签页后恢复本次演示状态。

### 2.2 MVP 明确不解决的问题

以下内容不纳入本次 MVP 的验收：

| 不做项 | 原因 | 后续方向 |
|---|---|---|
| 每次点击实时生成完整 3D 世界 | 延迟、成本和几何连续性不可控 | AI 生成候选场景，再审核发布 |
| 全港完整 3D 建模 | 资产生产量过大，无法验证核心交互价值 | 只给高价值对象增加 glTF |
| 物理引擎和自由飞行 | 会引入碰撞、相机、性能和资产管线复杂度 | Three.js/其他 3D renderer |
| 真流式视频推理 | 当前托管异步接口不能证明增量推理 | 独立 GPU worker + MSE/WebSocket |
| MongoDB、Redis、OSS/MinIO | MVP 可由固定 fixture 和内存状态完成 | 持久化阶段接入 Repository/对象存储 |
| 多用户协作和权限 | 与单用户体验验证无关 | 产品化阶段增加鉴权和租户 |
| 自动检索和事实审核 | 会扩大模型、来源和合规范围 | 事实层和引用服务单独建设 |

### 2.3 MVP 的正确产品口径

对外可以说：

> “这是一个可点击、可进入、可返回、可改变局部状态的 2.5D 盐田港交互视觉原型。”

暂时不能说：

> “这是一个每次点击都实时生成完整 3D 世界的系统。”

## 3. 当前项目基础和改造边界

当前项目已经有以下可以复用的能力：

- `SceneNode`、`Edge`、`SemanticAnchor` 数据概念；
- `region → place → object` 场景层级；
- 归一化 `point`、`bbox` 坐标；
- 本地锚点命中和 `object-fit: contain` 坐标处理；
- 浏览器本地缩放、平移和焦点过渡；
- 现有图片、视频和热点合成；
- SSE 生成事件和失败回退；
- `MockScenePipeline` 确定性场景素材。

当前代码中的 `SceneNode` 是“生成页面合同”，不是完整的游戏运行时合同。MVP 不直接把碰撞体、动作和运行时状态塞进 `SceneNode`，而是新增一个独立的、可替换的 `SceneManifest` 适配层。

### 3.1 MVP 的最小改动原则

1. 不修改现有 `GenerationRequest`、`GenerationEvent` 和 `SceneNode` 的必填字段；
2. 不要求真实百炼 Key；
3. 不引入 Three.js、数据库或新后端服务；
4. 保留当前 AI/SSE 路径，MVP 只新增一个本地 World Mode；
5. 通过一个 feature flag 开关新路径，旧页面可以回退；
6. 所有命中、动作和过渡逻辑集中在一个深模块 `WorldRuntime` 中，不继续堆在 `app.js` 的点击回调里。

## 4. MVP 用户流程

### 4.1 固定演示路径

第一条必须打通的垂直路径如下：

```text
盐田港总览（region）
  └─ 集装箱码头（place）
       └─ 自动化桥吊（object）
            └─ 吊具小车 / 装卸动作（local state）
```

建议同时放置两个旁支，用于证明分支和返回：

```text
盐田港总览
  ├─ 集装箱码头       → 码头作业场景
  ├─ 深水航道         → 航道场景
  └─ 盐田河口         → 生态场景
```

MVP 不要求旁支继续无限生成；旁支可以是两个固定的终端场景。

### 4.2 用户看到的时序

```text
点击实体
  ↓ 0--50 ms
本地命中、焦点环、目标提示、按钮禁用
  ↓ 420--650 ms
摄像机缩放/平移，旧画面保持可见
  ↓
目标 SceneManifest 载入并显示
  ↓
热点重新绑定到当前场景
```

执行“启动作业”时：

```text
点击按钮
  ↓ < 50 ms
实体 state.enabled = true
  ↓ 0--2 s
本地吊具、车辆或指示线做 CSS/Canvas 动画
  ↓
状态保留在当前 sessionStorage
```

### 4.3 首屏入口

MVP 采用显式演示入口，避免用户输入任意查询导致结果不确定：

```text
/?demo=mvp
```

也可以在界面上增加一个不影响现有搜索的“打开盐田 MVP 演示”按钮。

普通搜索仍走当前 `requestScene()` 和 SSE 路径；MVP 演示模式只在 `demo=mvp` 时启用固定世界。

## 5. 总体架构

```mermaid
flowchart TD
  URL[/?demo=mvp] --> Loader[WorldManifestLoader]
  Loader --> Runtime[WorldRuntime]
  Runtime --> Hit[HitTester]
  Runtime --> Actions[ActionDispatcher]
  Runtime --> Camera[TransitionController]
  Runtime --> History[History + sessionStorage]
  Runtime --> Adapter[SceneRendererAdapter]
  Adapter --> Canvas[现有 Canvas / SVG 资产]
  Adapter --> Hotspots[现有热点层]
  Adapter --> Panel[现有解释面板]
  Runtime -. 未知场景/可选 .-> SSE[现有 GenerationClient + SSE]
  SSE -. 可选 .-> Engine[现有 FlipbookEngine]
```

### 5.1 模块和 seam

| 模块 | MVP 接口 | 实现 | 允许替换的部分 |
|---|---|---|---|
| `WorldManifestLoader` | `load()` | 读取 `/fixtures/mvp-world.json` 并校验 | 未来改为 API/数据库 |
| `WorldRuntime` | `loadScene`、`hitTest`、`dispatch`、`back`、`snapshot` | 纯状态机和动作规则 | 未来接入服务器世界状态 |
| `HitTester` | `findEntityAtPoint(entities, point)` | bbox 命中；兼容现有坐标函数 | 未来 polygon/3D raycast |
| `TransitionController` | `focus(entity)`、`play(profile)` | 现有 CSS transform/Canvas 过渡 | 未来 WebGL/3D camera |
| `SceneRendererAdapter` | `render(scene, state)` | 调用当前 `drawScene`、热点和视频层 | 未来 Three.js renderer |
| `GenerationAdapter` | `generate(request)` | 复用现有 `createGenerationClient` | 未来模型编排服务 |

`WorldRuntime` 是 MVP 的外部 seam。页面只知道运行时接口，不知道实体命中、历史回退和状态变更的内部细节。这样以后替换 Canvas 为 WebGL/Three.js 时，不需要重写业务动作。

## 6. 数据合同

### 6.1 `SceneManifest` 最小结构

文件：`fixtures/mvp-world.json`

```json
{
  "schema_version": "mvp-1",
  "world_id": "yantian-port-mvp",
  "title": "盐田港交互视觉 MVP",
  "start_scene_id": "scene_region",
  "scenes": [
    {
      "id": "scene_region",
      "title": "盐田港总览",
      "scale_tier": "region",
      "asset": {
        "url": "/fixtures/mvp/region.svg",
        "width": 1536,
        "height": 960,
        "mime_type": "image/svg+xml"
      },
      "camera": {
        "mode": "orthographic",
        "zoom": 1
      },
      "entities": [
        {
          "id": "entity_terminal_01",
          "label": "集装箱码头",
          "kind": "place",
          "point": { "x": 0.70, "y": 0.35 },
          "bbox": { "x": 0.62, "y": 0.25, "w": 0.16, "h": 0.20 },
          "summary": "盐田港的集装箱装卸作业区域。",
          "actions": [
            {
              "type": "enter",
              "target_scene_id": "scene_terminal",
              "transition": "dive_to_anchor"
            },
            { "type": "inspect" }
          ]
        }
      ]
    }
  ]
}
```

### 6.2 实体字段

MVP 只允许以下字段：

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 在同一个 world 内唯一，建议 `entity_*` |
| `label` | string | 1--80 字符 |
| `kind` | string | `place`、`machine`、`vehicle`、`waterway`、`ecology` 等 |
| `point` | `{x,y}` | 原图归一化坐标，0--1 |
| `bbox` | `{x,y,w,h}` | 原图归一化矩形，0--1 |
| `summary` | string | 解释面板显示文本；不是事实数据库 |
| `asset_id` | string/null | 可选局部图层资源 |
| `actions` | array | 只允许下方定义的动作类型 |
| `initial_state` | object | 只放本地演示状态 |

MVP 暂不使用 polygon collider。bbox 命中不够准确的对象应扩大 bbox 或拆成多个实体；不要在 MVP 中临时引入一套未测试的多边形算法。

### 6.3 动作合同

```json
{
  "type": "enter",
  "target_scene_id": "scene_crane",
  "transition": "dive_to_anchor"
}
```

允许的动作：

| 动作 | 必填字段 | 行为 |
|---|---|---|
| `inspect` | 无 | 打开现有解释面板，不切换场景 |
| `enter` | `target_scene_id`、`transition` | 本地过渡并加载目标场景 |
| `toggle` | `state_key` | 切换一个布尔状态并播放本地动效 |
| `back` | 无 | 恢复历史快照 |

MVP 禁止从 JSON 执行任意 JavaScript、URL 跳转或网络请求。动作目标必须能在加载时校验通过。

### 6.4 运行时状态

```ts
type WorldRuntimeState = {
  worldId: string;
  sceneId: string;
  phase: "ready" | "transitioning" | "inspecting" | "failed";
  selectedEntityId: string | null;
  history: Array<{
    sceneId: string;
    selectedEntityId: string | null;
    entityState: Record<string, Record<string, unknown>>;
  }>;
  entityState: Record<string, Record<string, unknown>>;
  lastError: { code: string; message: string } | null;
};
```

状态只保存在：

1. 内存中的 `WorldRuntime`；
2. 当前标签页的 `sessionStorage`。

MVP 不承诺跨浏览器、跨设备或服务重启后的持久化。

## 7. `WorldRuntime` 接口和行为

### 7.1 外部接口

```js
const runtime = createWorldRuntime({
  manifest,
  storage: sessionStorage,
  onChange: (snapshot) => renderSnapshot(snapshot),
});

runtime.loadScene("scene_region");
runtime.hitTest({ x: 0.70, y: 0.35 });
runtime.dispatch({ type: "inspect", entityId: "entity_terminal_01" });
runtime.dispatch({ type: "enter", entityId: "entity_terminal_01" });
runtime.dispatch({ type: "toggle", entityId: "entity_crane_01", stateKey: "running" });
runtime.back();
runtime.snapshot();
```

### 7.2 接口不变量

- `loadScene(sceneId)` 只接受 manifest 中存在且已发布的场景；
- `hitTest(point)` 只接受 0--1 的归一化坐标；
- `dispatch` 在 `transitioning` 阶段拒绝新的 `enter`；
- `enter` 的目标场景必须在 manifest 中存在；
- `back` 没有历史时不改变状态；
- 同一实体重复 `enter` 时复用同一场景，不创建副本；
- 所有状态变化通过 `onChange` 输出，页面不直接修改运行时对象；
- 运行时错误返回稳定错误码，不抛出未处理异常到 DOM 事件回调。

### 7.3 状态机

```text
READY
  ├─ inspect ───────> INSPECTING ── close ──> READY
  ├─ enter ─────────> TRANSITIONING ────────> READY
  ├─ toggle ────────> READY（更新本地状态）
  └─ back ──────────> READY（恢复历史）

TRANSITIONING
  ├─ 动画完成 ──────> READY
  ├─ 用户取消 ──────> READY（恢复父场景）
  └─ 资源失败 ──────> FAILED ── retry ──> READY
```

### 7.4 命中优先级

```text
1. 当前场景中包含点击点的 bbox
2. 若有多个，选择 bbox 面积较小者
3. 否则选择距离最近且小于 maxDistance 的实体
4. 没有命中则返回 null，不猜测对象
```

实现应复用 `client/anchor-hit-testing.mjs` 的归一化坐标原则，并保留 `object-fit: contain` 的画布内容区转换。点击画布留白区域必须返回 null。

## 8. 视觉和交互实现

### 8.1 不引入新渲染引擎

MVP 继续使用当前：

- Canvas 主画面；
- SVG/图片资源；
- DOM 热点层；
- CSS `transform` 过渡；
- 现有解释面板和 motion video 层。

不要为了制造“游戏感”在 MVP 阶段引入完整 3D 引擎。当前目标是验证世界状态和点击路径，而不是验证 3D 资产管线。

### 8.2 三层视觉结构

```text
背景层：港区地图、海岸线、纸张纹理
主体层：码头、桥吊、船舶等图片或 SVG
交互层：焦点环、热点、目标提示、解释面板
```

每个实体最多配置一个局部 `asset_id` 和一个深度值 `z`。MVP 的深度只用于轻微视差，不用于真实遮挡。

### 8.3 过渡 profile

只实现两个 profile：

| profile | 实现 | 使用场景 |
|---|---|---|
| `dive_to_anchor` | 以 bbox 中心为 transform origin，缩放和平移 | 从总览进入码头/桥吊 |
| `return_to_parent` | 反向缩放和平移 | 返回上一层 |

过渡参数：

```text
duration: 520 ms（允许范围 420--650 ms）
easing: cubic-bezier(.22,.72,.25,1)
scale: 根据 bbox 计算，限制在 1.35--2.60
filter: 轻微 blur/saturate，仅在过渡中使用
```

这些参数沿用当前 `computeTransitionFocus()` 和 `MIN_LOCAL_TRANSITION_MS` 的设计，不把本地 CSS 动画称作模型视频。

### 8.4 实体状态动效

MVP 只做一个可见状态示例：

```json
{
  "entity_id": "entity_crane_01",
  "state": { "running": true }
}
```

状态为 `true` 时：

- 吊具沿预定义路径往返移动；
- 显示“作业中”状态点；
- 不调用模型、不请求服务器；
- 离开并返回场景后状态仍从 `sessionStorage` 恢复。

不做物理模拟、不做真实机械约束。动画路径是固定的、可测试的演示逻辑。

## 9. 与现有 AI/SSE 链路的关系

### 9.1 MVP 默认模式

默认环境配置保持：

```text
MODEL_REQUESTS_ENABLED=false
MOTION_GENERATION_MODE=off
MVP_WORLD_MODE=false
```

`MVP_WORLD_MODE` 只控制是否把固定本地世界作为无参数首页的默认体验；显式打开 `/?demo=mvp` 始终可用。MVP 演示路径不产生付费请求，也不读取模型状态接口，不依赖百炼可用性。

### 9.2 可选 AI 预览路径

如果需要在 MVP 中展示“未知点击”的后续能力，按以下方式接入：

1. 已知 manifest 实体：直接 `WorldRuntime.dispatch({type:"enter"})`，禁止先调用模型；
2. manifest 未知区域：保留现有 `requestScene()`，走当前 SSE；
3. SSE 返回 `SceneNode` 后，用 `manifestFromNode(node)` 把 anchors 转成临时实体；
4. 临时实体只在当前标签页有效，不写入正式世界 manifest；
5. 生成失败时保持父场景，不切换到无关本地场景；
6. 视频只在静态节点完成后异步增强，绝不阻塞点击进入。

因此 AI 路径是“可选增强”，不是固定演示路径的依赖。

### 9.3 不修改现有生成事件合同

MVP 不把 `manifest` 强行塞进现有 `final` SSE 事件，避免破坏 `contracts/generation-event.schema.json`。临时实体由客户端适配器从已有 `SceneNode.anchors` 构造；正式世界 manifest 在后续持久化阶段再增加独立接口。

## 10. 实际文件变更清单

以下是本次实际落地的最小文件范围；动态 3D、持久化和真流式仍不在本次实现内。

### 10.1 新增文件

```text
fixtures/mvp-world.json
client/world-runtime.mjs
client/world-manifest.mjs
contracts/scene-manifest.schema.json
tests/world-runtime.test.mjs
tests/world-manifest.test.mjs
docs/secondary-development/2026-08-30-world-runtime-mvp.md
```

本次没有创建 `fixtures/mvp/*.svg`：5 个固定场景直接复用现有 Canvas 绘制函数，避免为 MVP 额外引入一套资产加载路径。

### 10.2 修改文件

```text
app.js
index.html
styles.css
model-config.mjs
.env.example
tests/model-config.test.mjs
```

### 10.3 每个文件的责任

| 文件 | 只负责什么 |
|---|---|
| `fixtures/mvp-world.json` | 场景、实体、坐标、动作和解释数据 |
| `client/world-manifest.mjs` | 读取、校验和索引 manifest |
| `client/world-runtime.mjs` | 状态机、命中、动作、历史和 sessionStorage |
| `app.js` | 把 DOM 事件转成 runtime 调用，把 runtime 快照渲染到现有 UI |
| `index.html` | 增加 MVP 入口和必要的状态提示，不重做页面结构 |
| `styles.css` | 过渡态、作业中状态和 320/390px 适配 |
| `contracts/scene-manifest.schema.json` | 固定 manifest 字段和引用完整性 |
| `tests/*.test.mjs` | 纯函数、状态机和合同测试 |
| `model-config.mjs` | 服务端 `MVP_WORLD_MODE` 开关和非敏感状态 |

不要在 `app.js` 里重新实现第二套 hit test、history 或 transition 算法。

## 11. Manifest 场景清单

MVP 固定 5 个场景，足够证明层级、分支、返回和状态：

| 场景 ID | 层级 | 主要实体 | 是否可继续进入 |
|---|---|---|---|
| `scene_region` | `region` | 集装箱码头、深水航道、盐田河口 | 是 |
| `scene_terminal` | `place` | 自动化桥吊、集装箱堆场、无人集卡 | 是 |
| `scene_crane` | `object` | 前伸臂、吊具小车、门架行走机构 | `toggle` |
| `scene_channel` | `place` | 深水航道、引航船、航道浮标 | 否/返回 |
| `scene_estuary` | `place` | 红树林、潮间带、滨水步道 | 否/返回 |

实体 ID 必须稳定，例如：

```text
entity_terminal_01
entity_channel_01
entity_estuary_01
entity_crane_01
entity_stack_01
entity_vehicle_01
entity_crane_boom_01
entity_crane_trolley_01
```

不要使用数组下标作为实体 ID。数组顺序以后调整时，历史和状态不能因此失效。

## 12. 实施步骤和产出

### Step 1：冻结 MVP 合同

工作内容：

- 写 `scene-manifest.schema.json`；
- 写 `fixtures/mvp-world.json`；
- 为 5 个场景补齐实体、bbox、动作和解释；
- 增加加载时引用完整性校验。

验证：

```text
npm test
npm run validate:dataset
```

新增合同测试必须覆盖：重复 ID、非法坐标、缺失目标场景、未知动作和空场景。

### Step 2：实现 `WorldRuntime`

工作内容：

- 实现 `loadScene`、`hitTest`、`dispatch`、`back`、`snapshot`；
- 实现 `ready/transitioning/inspecting/failed` 状态；
- 实现 sessionStorage 序列化和恢复；
- 实现重复进入复用和过渡锁。

验证：

- 纯 Node 测试不依赖 DOM；
- 同一输入得到同一快照；
- 过渡期间第二次点击不会创建第二个导航；
- 返回后父场景、选中实体和状态正确恢复。

### Step 3：接入现有画布

工作内容：

- `demo=mvp` 时加载 manifest；
- 现有热点层从 manifest entities 渲染；
- 点击事件先交给 runtime，再由 `onChange` 更新 UI；
- 复用 `setTransitionFocus()`、`computeTransitionFocus()` 和现有解释面板；
- 关闭 MVP 模式时保留现有搜索/SSE 行为。

验证：

- 入口页面不再需要模型请求；
- 点击实体后 50 ms 内出现焦点反馈；
- 目标场景显示正确标题和热点；
- 空白区域点击不会误命中。

### Step 4：加入一个本地状态动作

工作内容：

- 在 `scene_crane` 增加“启动作业”按钮；
- 绑定 `entity_crane_trolley_01.running`；
- 用固定路径实现 2 秒循环动画；
- 将状态写入 sessionStorage。

验证：

- 点击后状态立即变更；
- 返回再进入状态不丢失；
- 刷新标签页后状态可恢复；
- 没有额外网络请求。

### Step 5：浏览器回归和交付

工作内容：

- 验证桌面、390px、320px；
- 验证键盘焦点和 `prefers-reduced-motion`；
- 验证视频开关仍不影响固定场景；
- 记录截图、操作路径和测试结果。

## 13. 测试方案

### 13.1 单元测试

`tests/world-manifest.test.mjs`：

1. manifest 可以加载；
2. 所有场景 ID 唯一；
3. 所有实体 ID 唯一；
4. 所有坐标在 0--1；
5. 所有 `enter.target_scene_id` 存在；
6. 所有动作类型属于白名单；
7. 起始场景存在。

`tests/world-runtime.test.mjs`：

1. 初始场景为 `scene_region`；
2. bbox 内点击命中正确实体；
3. 点击留白返回 null；
4. `inspect` 不改变场景；
5. `enter` 记录历史并切换场景；
6. 过渡中拒绝第二次 `enter`；
7. 重复进入同一实体不产生副本；
8. `back` 恢复父场景；
9. `toggle` 只修改允许的状态键；
10. 错误目标返回稳定错误码；
11. sessionStorage 恢复后快照一致。

### 13.2 浏览器验收路径

固定记录以下操作：

```text
打开 /?demo=mvp
→ 点击“集装箱码头”
→ 点击“自动化桥吊”
→ 查看解释
→ 点击“启动作业”
→ 返回
→ 再次进入“自动化桥吊”
→ 刷新页面
→ 继续查看作业中状态
```

### 13.3 性能和稳定性目标

| 指标 | MVP 目标 | 测量方式 |
|---|---:|---|
| 本地命中反馈 | p95 ≤ 50 ms | `performance.now()` |
| 场景过渡 | 420--650 ms | 浏览器 Performance 记录 |
| 已知场景网络请求 | 0 | DevTools Network |
| 重复进入重复场景数 | 0 | runtime 快照断言 |
| 连续点击测试 | 100 次无状态错误 | 自动化脚本/手测 |
| 320px 横向溢出 | 0 | 浏览器几何检查 |
| reduced-motion | 不出现长过渡 | 浏览器设置检查 |

这些指标只适用于固定本地 MVP。不能拿它们代表百炼模型生成延迟或真流式视频性能。

## 14. 运行和验证命令

### 14.1 安全默认配置

```text
MODEL_REQUESTS_ENABLED=false
MOTION_GENERATION_MODE=off
```

MVP 不需要把任何 API Key 写入文档、fixture、日志或浏览器。

### 14.2 本地启动

PowerShell 示例：

```powershell
$env:PORT = "4189"
$env:MODEL_REQUESTS_ENABLED = "false"
$env:MOTION_GENERATION_MODE = "off"
$env:MVP_WORLD_MODE = "false"
npm run dev
```

启动后打开：

```text
http://127.0.0.1:4189/?demo=mvp
```

如果端口被占用，换一个本地端口并以终端实际输出为准。

### 14.3 验证顺序

```powershell
npm test
npm run validate:dataset
node --check client/world-runtime.mjs
node --check client/world-manifest.mjs
```

若增加浏览器自动化，再补充：

```text
桌面宽度 → 390px → 320px → prefers-reduced-motion
```

## 15. MVP Definition of Done

只有下面全部满足，才算 MVP 完成：

- [x] `/` 之外有明确的 `/?demo=mvp` 演示入口；
- [x] 5 个固定场景和至少 9 个稳定实体 ID 已通过 manifest 校验；
- [x] 用户可以完成“总览 → 码头 → 桥吊”两次进入；
- [x] 点击后出现本地反馈并进入确定性过渡；
- [x] 已知场景进入不触发模型、SSE 或视频请求；
- [x] 解释面板可以显示实体名称、类型和摘要；
- [x] `启动作业` 状态可以切换并产生本地动画；
- [x] 返回可以恢复上一场景；
- [x] 重复点击同一实体不产生重复场景；
- [x] 刷新当前标签页后可以恢复场景和演示状态；
- [x] 空白区域点击不误命中；
- [x] 320px、390px 和桌面宽度无横向溢出；
- [x] `prefers-reduced-motion` 下过渡会降级为短提交等待；
- [x] `npm test` 和数据集校验通过；
- [x] 旧的普通搜索/SSE 路径仍可关闭 MVP 模式后使用；
- [x] 文档记录了测试日期、浏览器和实际端口（截图在本次浏览器验收中核对）。

## 16. 估算和人员安排

以下是单个熟悉当前代码的开发者的初步估算，不是承诺工期：

| 工作 | 估算 |
|---|---:|
| manifest 和合同 | 0.5--1 天 |
| `WorldRuntime` 和单测 | 1.5--2 天 |
| 现有画布接入 | 1--1.5 天 |
| 本地状态动作和动画 | 0.5--1 天 |
| 响应式/无障碍/浏览器回归 | 1 天 |
| 文档、截图和回滚记录 | 0.5 天 |
| 合计 | 5--7 个工作日 |

估算成立的前提：继续使用现有 Canvas、SVG fixture、Node server 和 Mock pipeline，不新增 3D 资产制作、模型付费调用或数据库迁移。

## 17. 回滚方案

MVP 必须有一个显式开关：

```text
MVP_WORLD_MODE=false
```

该开关关闭时，只有显式 `/?demo=mvp` 才会进入固定世界；因此可以关闭首页默认 MVP 而不删除实现。完整回滚步骤：

1. 将 `MVP_WORLD_MODE` 设为 `false`；
2. 重启 Node 服务；
3. 刷新页面；
4. 确认普通搜索仍进入原有 `requestScene()` 路径；
5. 保留 manifest 和测试文件，便于再次启用。

MVP 不写数据库、不覆盖现有生成资源，因此回滚不需要数据迁移或删除远程资源。

## 18. MVP 之后的升级顺序

MVP 通过后，按以下顺序扩展，不要直接跳到完整 3D：

### V0.2：动态节点适配

- 将 `manifestFromNode(node)` 变成正式适配器；
- 生成后的 anchor 绑定稳定 entity ID；
- 支持未知点击生成临时场景；
- 增加候选预取和取消。

### V0.3：持久化世界

- MongoDB 保存 Session、SceneNode、SceneManifest、Edge 和状态；
- MinIO/OSS 保存图片、视频和局部图层；
- 分享链接恢复已发布场景；
- 已知 Edge 零模型调用打开。

### V0.4：更精确的空间命中

- polygon collider；
- 场景坐标和局部坐标；
- 标签碰撞避让；
- 多层视差和局部遮罩。

### V0.5：混合 3D

- 只给桥吊、船舶、集装箱等关键实体增加 glTF；
- 新增 `ThreeRendererAdapter`；
- 复用同一个 `WorldRuntime`；
- 通过统一 entity ID 绑定 2D/3D 表现。

### V0.6：动效和真流式实验

- Wan 异步首尾帧过渡作为后台资源；
- 单页环境微动；
- 独立 GPU worker；
- WebSocket + MSE + fMP4 增量片段；
- 分别测量暖实例、冷启动、排队和首片段时间。

## 19. 风险控制

### 风险一：MVP 变成“顺序播放幻灯片”

处理：必须包含 `inspect`、`toggle`、历史和实体状态；验收不只看场景是否切换，还要看点击对象和状态是否真正影响运行时。

### 风险二：把固定 fixture 误称为 AI 生成

处理：界面明确显示 `MVP / LOCAL FIXTURE`；模型收据不伪造；AI 路径单独标注 `CLOUD` 或 `MOCK SSE`。

### 风险三：热点坐标再次全部落到中心

处理：manifest 和现有生成节点统一使用 `point`/`bbox`；禁止只读旧的 `anchor.x/y`；加入每个实体的几何断言。

### 风险四：动作逻辑重新散落到 `app.js`

处理：所有动作必须通过 `WorldRuntime.dispatch()`；页面只负责事件转换和渲染。

### 风险五：为了“像游戏”过早引入 3D

处理：MVP 不安装 Three.js；只有当 2.5D 路径通过并且有明确的遮挡/旋转需求时，才创建 3D renderer seam。

## 20. 最终实施决策

本 MVP 采用以下决策：

```text
固定 5 场景 manifest
+ 稳定 entity ID
+ bbox 命中
+ WorldRuntime 状态机
+ 本地 CSS/Canvas 过渡
+ 一个可见状态动作
+ sessionStorage 恢复
+ 现有 AI/SSE 作为可选路径
+ Mock-first，付费模型不作为验收依赖
```

完成这条最小闭环后，才能有证据判断用户是否真正感受到“像游戏一样点击和探索”。如果这条闭环都没有稳定，直接投入完整 3D、视频流或大规模模型生成，只会把交互问题隐藏在更复杂的技术栈里。
