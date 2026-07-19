# Phase 0 Notes

## 已完成

- pnpm workspace：`packages/client`、`packages/shared`。
- Vite + Three.js + TypeScript strict 客户端。
- 方向键/WASD 与指针拖拽移动输入。
- 平面场地、可移动洞标记、俯视跟随摄像机。
- oxlint、oxfmt、Prettier Markdown 回退、lint-staged 与 Husky pre-commit。

## 已知问题

- 当前没有 React UI 外壳和 zustand；Phase 0/1 的 HUD 使用轻量 DOM，后续 UI 阶段再引入。
- 尚未进行移动端触控体验与性能专项优化。
