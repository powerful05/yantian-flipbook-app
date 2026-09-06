# 盐田 Flipbook

盐田 Flipbook 原型项目，包含本地静态媒体、场景数据、客户端交互和 Node.js 服务端。

## 本地运行

要求 Node.js 18 或更高版本。

```bash
npm ci
npm test
npm run validate:dataset
npm run dev
```

默认使用本地 Mock 场景管线，不需要模型密钥。真实模型调用需要在本机配置 `.env.local`；该文件不会提交到仓库。

打开 `http://localhost:4173` 查看 Flipbook。

## 目录

- `client/`：浏览器端运行时和交互逻辑
- `src/`：服务端路由、场景管线和领域模块
- `contracts/`：JSON Schema 契约
- `fixtures/`：测试场景和静态参考素材
- `tests/`：Node.js 测试
- `docs/`：架构、研究和开发记录
