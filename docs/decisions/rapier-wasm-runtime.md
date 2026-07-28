# Rapier Wasm 物理 Runtime

## 状态

已采用，2026-07-28。

## 依据

- Rapier 官方文档说明 JavaScript 包是 WebAssembly，必须异步加载：<https://rapier.rs/docs/user_guides/javascript/getting_started_js/>。
- 标准 `@dimforge/rapier3d` 包保留独立 `.wasm`；Rapier 官方文档明确说明 `-compat` 才会将 Wasm 以 base64 嵌入 JS。Vite 官方文档规定 `.wasm?init`/`.wasm?url` 的加载方式，WebAssembly ESM integration 由 `vite-plugin-wasm` 处理。
- Rapier 0.19.3 的根包入口元数据不能被 Vite 7 直接解析，因此运行时显式导入包内声明的 `rapier.js` ESM 入口；client 和 Vitest 同时启用 `vite-plugin-wasm` 与 `vite-plugin-top-level-await`。生产构建使用插件文档支持的 `esnext` target，避免将 Rapier 生成的 Wasm 初始化代码降级到不支持的旧语法目标。
- Vitest 默认外置 `node_modules` 依赖；测试配置内联 `@dimforge/rapier3d`，确保其 `.wasm` import 经过 Vite 插件转换，而不是交给 Node 原生模块加载器。
- 官方碰撞组文档规定左 16 位为 membership、右 16 位为 filter：<https://rapier.rs/docs/user_guides/javascript/collider_collision_groups/>。
- 官方质量、摩擦、反弹与固定步长文档：
  - <https://rapier.rs/docs/user_guides/javascript/collider_mass_properties/>
  - <https://rapier.rs/docs/user_guides/javascript/collider_friction/>
  - <https://rapier.rs/docs/user_guides/javascript/collider_restitution/>
  - <https://rapier.rs/docs/user_guides/javascript/integration_parameters/>
- 官方 JavaScript API 提供 `ColliderDesc.trimesh(vertices, indices)` 与 `Collider.setShape(shape)`；洞缘使用这两个 API 合并固定碰撞体并原地更新半径。

## 决策

- offline 和 host 在异步创建 `Game` 时创建一份 `SimulationPhysicsRuntime`；guest 不创建 runtime。
- 浏览器开发和生产环境均加载独立 `.wasm` 资源，不使用 base64 compat 包。
- runtime 是显式传入 `stepSimulation` 的可丢弃派生缓存，不是权威状态。全部刚体状态每步写回 `SimulationState`，runtime 可从该状态重建。
- 每个洞口独立复用一个 Rapier `World`、一个 96 段精度的闭合环形 trimesh collider 和当前活跃刚体；洞半径变化时只替换 collider shape，不重建 world、固定地面刚体或活跃刚体。
- 游戏销毁时调用 `World.free()`；禁止模块全局保存对局 world。
- 保持现有物理常量、形状尺寸、碰撞参与关系、吞噬阈值、车辆旁路与协议不变。

## 边界

Cannon 与 Rapier 使用不同求解器，不能保证逐浮点轨迹相同。回归标准是已定义的玩法行为契约：激活、洞缘承托、完整穿过后计分、落地恢复、活跃物体互撞、重力倍率、车辆旁路与权威边界。
