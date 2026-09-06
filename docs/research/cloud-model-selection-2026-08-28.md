# 盐田 Flipbook 云端模型最小选型

> 核验日期：2026-08-28  
> 范围：中国大陆 PoC，优先单一供应商、按量付费，不自建 GPU。  
> 本文只记录官方公开资料，未创建、读取或调用任何真实 API Key。

## 结论

可以先用阿里云百炼 DashScope 完成 PoC，不需要先租一台 GPU 云服务器。最小方案使用同一个华北 2（北京）业务空间和一把 DashScope API Key，先接入三个静态链路模型，再按动效用途选择一个或两个视频模型：

| 职责 | PoC 模型 ID | 用途 | 启动策略 |
| --- | --- | --- | --- |
| 页面计划 | `qwen3.8-flash` | 结构化 JSON、标签文案、生图与动效提示词 | 默认使用 |
| 视觉理解 | `qwen3-vl-flash` | 图像理解、点击目标识别、Box/Point 定位 | 默认使用；质量不足再升级 `qwen3-vl-plus` |
| 生图与编辑 | `qwen-image-3.0` | 文生图，以及基于 1-3 张参考图的图生图/图像编辑 | 先用标准版；质量评测后再考虑 `qwen-image-3.0-pro` |
| 页面间过渡 | `wan2.2-kf2v-flash` | 用已确定的首帧和尾帧生成平滑过渡 | 第二阶段优先验证；固定 5 秒，异步预生成 |
| 单页环境动效 | `wan2.6-i2v-flash` | 从最终静态图生成局部运动和镜头运动 | 可选增强；不负责精确落到下一页 |

为了更小的第一阶段账单，可先只开 `qwen3-vl-flash` 和 `qwen-image-3.0`；视觉模型暂时兼任页面计划，视频功能关闭。

质量评测不达标时再逐项升级，不要一开始全部使用高价模型：

| 默认 PoC | 质量升级 |
| --- | --- |
| `qwen3-vl-flash` | `qwen3-vl-plus` |
| `qwen-image-3.0` | `qwen-image-3.0-pro` |
| `wan2.2-kf2v-flash` | 暂不盲目升级，先评测首尾帧一致性 |
| `wan2.6-i2v-flash` | `wan3.0-video` |

## 一把 Key 能做什么

官方文档明确说明，API Key 的调用权限由其归属业务空间决定，不需要为文生文、文生图、视频生成分别创建 Key。默认业务空间的 Key 可调用标准模型；专用子空间的 Key 只能调用该空间已授权的模型。

但是，**一把 Key 不等于一种 API 协议**：

- 文本和 VL 优先走 OpenAI-compatible Chat Completions。
- `qwen-image-3.0` 走 DashScope 多模态生成原生接口，可同步或异步调用。
- `wan2.2-kf2v-flash` 和 `wan2.6-i2v-flash` 都走 DashScope 原生异步视频接口；创建任务后保存 `task_id`，按建议间隔轮询，成功后立即转存结果。

因此后端仍需要 `TextPlanner` / `VisualResolver` / `ImageRenderer` / `MotionRenderer` 四个 adapter，不能把所有调用硬塞进一个 OpenAI 客户端。

## 地域与 Base URL

PoC 固定选择**华北 2（北京）**，不混用其他地域的 Key、模型或地址。生产建议使用业务空间专属域名：

```text
OpenAI-compatible:
https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1

DashScope native:
https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1
```

存量兼容域名 `https://dashscope.aliyuncs.com` 仍可使用，但官方建议生产迁移至业务空间专属域名。北京、新加坡等地域拥有独立的 API Key、接入域名和模型列表，跨地域混用会鉴权失败或调用报错。

## 计费边界

这四个都是商业云模型，不应把新用户限时免费额度当作长期成本。计费单位不相同：

| 能力 | 官方计费单位 | 成本闸门 |
| --- | --- | --- |
| 文本 / VL | 输入 Token + 输出 Token；图片会换算为视觉 Token | 限制图片尺寸、输出 Token 和重试次数 |
| 生图 / 图像编辑 | 按输入/输出图片张数计费，分辨率档位影响单价 | PoC 每次 `n=1`，禁止无上限预取 |
| 图生视频 | 按输出视频秒数计费，分辨率和有声/无声档位影响单价 | 默认无声、最短时长，只在静态图成功后异步触发 |

**生图和视频不是按 Token 计费**。上线前必须设置每会话、每用户和全局日预算；任何付费冒烟调用都要在执行前再确认。

建议 PoC 首次充值 100--200 元，先设置 20 元/日的软告警；这是项目启动预算建议，不是官方套餐或性能保证。静态链路稳定前不自动生成视频。

## 用户需要准备的内容

1. 一个完成实名认证、能使用按量付费的阿里云账号，并开通大模型服务平台百炼。
2. 在华北 2（北京）创建一个 PoC 专用业务空间，记录 `WorkspaceId` 和控制台给出的 API Host。
3. 确认上述模型在该地域的控制台中可用/已授权；模型 ID 会随产品更新，以开通当日控制台为准。
4. 为该业务空间创建**一把** PoC Key，配置允许的模型范围和服务端公网 IP 白名单。
5. 设置低额预算、账单告警和异常调用告警。

PoC 不强制准备 OSS AccessKey。后端可先把模型返回的临时图片/视频 URL 立即下载到现有存储；进入部署阶段再配置 OSS 或其他 S3 兼容对象存储。百炼生成资源 URL 和异步任务信息通常只保留 24 小时，不能当作永久存储。

## 密钥安全要求

- 不要把 Key 发到聊天、提交到 Git，或写入前端 `index.html` / `app.js`。
- Key 只放在服务端 Secret 或本机未入库的环境变量 `DASHSCOPE_API_KEY`中；浏览器只调用自己的 BFF。
- 优先使用 RAM 用户和独立业务空间，不使用主账号的宽权限 Key。
- 按模型范围和 IP 白名单限权；泄露后立即删除并旋转，不在日志中打印完整 Key。
- 如果必须在不可信环境短时使用，改用官方最长 1800 秒的临时 API Key，不下发长期 Key。

## 实施顺序

1. `qwen3-vl-flash + qwen-image-3.0` 打通“点击 -> 定位 -> 页面计划 -> 静态图”。
2. 引入 `qwen3.8-flash` 单独负责规划，对比 VL 兼任时的延迟、质量和成本。
3. 静态链路稳定后先开 `wan2.2-kf2v-flash` 验证首尾帧过渡，全程异步、可取消，失败不影响静态页。
4. 需要单页微动时再开 `wan2.6-i2v-flash`；它只锁定首帧，不能代替页面间的确定性落点。

## 官方来源

1. [获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)：业务空间权限、同一 Key 可调用不同类型标准模型、IP/模型范围限制、临时 Key。
2. [选择地域、服务部署范围和接入域名](https://help.aliyun.com/zh/model-studio/regions)：地域隔离、业务空间专属域名、OpenAI-compatible 与 DashScope Base URL。
3. [图像与视频理解](https://help.aliyun.com/zh/model-studio/vision)：OpenAI-compatible 调用、二维 Box/Point 定位和 Qwen3-VL 坐标规则。
4. [千问-图像生成与编辑 3.0](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference)：`qwen-image-3.0` / `qwen-image-3.0-pro`、T2I/I2I、同步/异步接口和 24 小时临时资源。
5. [万相-图生视频](https://help.aliyun.com/zh/model-studio/image-to-video-api-reference)：`wan2.6-i2v-flash`、异步任务、视频 URL 时效与限制。
6. [模型调用计费](https://help.aliyun.com/zh/model-studio/model-pricing)：文本/VL 按 Token，图像按张，视频按秒，以及各地域实时价格和限时免费额度。
7. [万相-基于首尾帧生视频](https://help.aliyun.com/zh/model-studio/image-to-video-by-first-and-last-frame-api-reference)：`wan2.2-kf2v-flash`、首尾帧约束、固定 5 秒与异步任务接口。
