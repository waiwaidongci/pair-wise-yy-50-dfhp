# 印刷拼版预检与打样轮次审批平台

面向印刷生产团队的拼版工作台，支持页面尺寸与印刷规格、Canvas 版位编辑、出血/安全区/折手/页码检查、打样反馈、版本并排对比、审批锁定和可恢复导出任务。

## 技术栈

Vue 3 + PrimeVue + Pinia + Vue Router + TanStack Query + Axios + Canvas + Vite + TypeScript

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62050`。

## 核心工作流

- 导入页面尺寸、出血、安全区、折手和装订方向，在 Canvas 中拖拽版位。
- 自动检查页面缺失、出血不足、页序冲突、版位重叠和装订错误。
- 每轮打样记录样张照片、色差反馈、修正说明和负责人决定。
- 版本并排对比、审批锁定，并恢复中断的导出任务。
