---
name: threejs-scene
description: Hole.io 客户端的 three.js 场景性能约定——渲染循环里禁止做的事、几何/材质/draw call 合并、资源压缩与释放、DOM 叠层节流、移动端兜底。修改 packages/client/src/game 下的渲染、场景搭建、资源加载代码时使用。
---

# Three.js 场景性能

针对本项目"俯视 city、695 个可吞噬物件、host 权威 60Hz 模拟、移动端优先"的场景。所有建议遵循一条硬规则：**任何优化不得以可观测地降低画质或帧率为代价**。

## 1. 渲染循环里禁止做的事（`setAnimationLoop` 回调内）

- **禁止 `new` 几何体/材质/纹理/Color/Vector3**。进度环、引信弧这类"形状随数值变化"的需求，用单份完整几何 + shader uniform（`uThetaStart`/`uThetaLength`）或 `uv` 裁剪驱动，不要每帧 `new RingGeometry` + `dispose`。
- **禁止每帧排序/分配大数组**做派生计算。领先者、排名这类慢变量，放进已有的节流 HUD pass（~12Hz）算一次缓存，渲染帧只读。
- **禁止每帧 `getBoundingClientRect`**（强制布局）。DOM 叠层定位用 `clientWidth/Height`（全屏容器等价），或缓存 rect 仅在 resize 时刷新。
- **禁止每帧 `computeBoundingSphere` 重算静态 batch**。`InstancedMesh` 的球是 O(实例数)；只有实例位置真的变了（动态 batch）才需要重算，静态 batch 初始化算一次即可。
- **禁止在循环里追加/移除 DOM 节点**做一次性反馈（如吞噬浮字）。用预建 span 池复用，或至少把"强制布局"调用移出热路径。

## 2. draw call / 几何 / 材质合并

- **同材质的静态地面/装饰片，合并成单个 `BufferGeometry`**：把"旋转+位移"烘焙进顶点（`geometry.applyMatrix4`），再用 `mergeGeometries`（`three/addons/utils/BufferGeometryUtils.js`）按材质分组合并。逐顶点表现完全一致，draw call 数量级下降。
- **大量同形物件用 `InstancedMesh`**，并按空间 cell 分批（本项目 32 格），让 batch 级视锥剔除有效。动态物件（车辆）单列 batch。
- **材质按可视属性去重**：`(map uuid, 颜色, transparent, opacity, alphaTest, side, vertexColors)` 作 key 缓存复用。注意：会被逐对象改 opacity/depthWrite 的材质（吞噬淡出）必须 **先 clone 再改**，绝不共享后原地改。
- **能 unlit 就 unlit**：俯视扁平画风下，可吞噬物件统一 `MeshBasicMaterial`（无逐片光照）；地面若无明显光照梯度也可降级。但**已确立画风的材质类型/色调映射不要为性能擅自切换**——属画质变更，需单独决策。

## 3. 资源加载与显存

- **glTF 几何必须压缩**：`gltfpack -cc`（Meshopt，解码快）或 Draco（压缩比更高）。解码走 WebWorker（`MeshoptDecoder` / `DRACOLoader`），不卡主线程。这是大场景下**单笔收益最大**的一项。
- **纹理转 KTX2/Basis**：`toktx` 生成，GPU 原生格式、显存与上传都优于 ImageBitmap→RGBA8。UASTC 档可做到视觉无损。
- **加 decoder 的前提是资源已压缩**：未压缩时不要预挂 `DRACOLoader`（白白增大 bundle）。
- **加载用并发上限**（本项目 4），按 prefab 而非按 object 加载（同 prefab 只解析一次）。
- **释放要走 `dispose()`**：geometry / material / texture / renderer 都要在 teardown 释放；纹理 `map` 多处共享时由一处统一 dispose。

## 4. DOM × 3D 叠层（标签、指示器、浮字）

- **DOM 叠层不必跟 60Hz 渲染同频**。屏幕空间投影（`vector.project`）+ `style.transform` 写入，~30Hz 足够，相机跟随时步进 <1px 不可见。
- **叠层容器加 `contain: strict` + `will-change: transform`**，把合成隔离出主布局。
- **批量更新 DOM**：先算好所有 transform 再写，避免读写交替触发 reflow。
- **3D 内动画（如下坠/淡出 mesh）仍按渲染帧更新**，不要被 DOM 节流误伤。

## 5. 移动端兜底

- **`pixelRatio` 封顶**（本项目 1.5）。可暴露"画质档"让低端机降到 1.0，但默认值变更属画质决策。
- **`resize` 用 `requestAnimationFrame` 合并**：移动端浏览器 UI 显隐会连续抛 resize，合并避免 drawingbuffer 反复重建。
- **页面隐藏即停 loop**（`document.visibilityState` → `setAnimationLoop(null)`），可见时再恢复。
- **关闭 shadow**：俯视场景下静态物件 `castShadow/receiveShadow = false`，不做阴影贴图。
- **fog 用线性 `Fog`** 而非 `FogExp2`，且只覆盖远处，兼顾"遮挡边界"与"省填充"。

## 6. 先测量，再归因（最高优先级）

"卡"不等于"three.js 卡"。本项目实测过：渲染主线程上跑的**权威模拟**（`stepSimulation`）才是大头，不是 three.js。动手优化渲染前先：

- 用 CPU profiler（`node:inspector` 跑 N 步 `stepSimulation`，或 Chrome DevTools 录一帧）确认时间到底花在哪，不要凭"标题写了 threejs"就归因到渲染。
- 区分**稳态帧预算**（每帧固定开销）与**尖峰**（GC、layout thrash、螺旋追赶）——优化手段不同。
- 模拟侧已知大头：cannon-es 每步为每个洞重建 96 段地面楔形（按 `hole.radius` 缓存可省 ~20%）、`SpatialHash` 用字符串 key（改数值 key 可省 ~15%）。这些都不在渲染管线里。

## 7. 实施前自检清单

每条优化落地前回答：

1. 它**可观测地**改变画面吗？（材质类型、色调映射、几何段数、纹理精度、pixel ratio 默认值——任何一项变更都算画质变更，需单独确认。）
2. 它在**连锁/爆炸等瞬时高频场景**下也成立吗？（按最坏帧评估，不是平均帧。）
3. 改完能说出"参考了上面哪一条"吗？说不出来就说明可能走偏。
4. 释放路径是否同步更新？（合并/去重后，dispose 要按合并后的资源走，避免双重释放或泄漏。）
