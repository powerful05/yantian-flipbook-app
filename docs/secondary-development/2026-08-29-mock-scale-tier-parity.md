# 本地降级管线与云端尺度层级对齐

> 日期：2026-08-29  
> 范围：盐田 Flipbook 本地 PoC  
> 状态：已完成并通过离线与浏览器验收

## 变更目的

当百炼请求未启用、失败或等待时，前端会使用 `MockScenePipeline`。此前 Mock 的第一次 `tap` 固定返回 `object`，会让离线演示从区域总览直接跳到对象细节，和云端 adapter 以及官方演示的由远及近叙事不一致。

## 修改范围

- `src/mock-scene-pipeline.mjs`
  - 增加 `region → place → object` 的确定性 `tap` 推进。
  - `object` 层继续点击时保持 `object`，避免超过合同上限。
  - `ascend` 回退一层；`edit` 保留父节点尺度。
- `tests/flipbook-engine.test.mjs`
  - 增加根节点、第一次点击和第二次点击的尺度断言。
- `docs/workflows/flipbook-dynamic-style-workflow.md`
  - 记录云端与本地降级路径的层级一致性。

## 前后行为

变更前：`region → object`。  
变更后：`region → place → object`；搜索栏标题随当前节点更新，标签解释仍在进入下一层前可查看。

## 验证

- `npm test`：32/32 通过。
- `node --check src/mock-scene-pipeline.mjs`：通过。
- 独立 4190 Mock 服务浏览器验收：
  - `REGION / ROOT` → `PLACE / TAP` → `OBJECT / TAP`；
  - 查询框依次为“盐田港”→“集装箱扫描设备”→“近岸礁体”。

本次没有调用百炼，也没有产生付费请求。
