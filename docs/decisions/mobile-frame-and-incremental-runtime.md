# 移动端帧率与增量 Runtime

## 状态

已采用，2026-07-28。

## 依据

- `440 × 956` CSS viewport、DPR 3 的大屏手机环境中，应用按 `1.5` 像素比上限生成 `660 × 1434` drawing buffer，并启用 WebGL2 4x MSAA。
- 相同 seed 的 60fps/40fps A/B 中，40fps 令主回调 CPU 从 `131.05ms/s` 降至 `104.06ms/s`（`-20.6%`），draw calls/s 从 `6165.8` 降至 `4104.4`（`-33.4%`），triangles/s 从 `7.17M` 降至 `4.77M`（`-33.4%`）。
- `1320 × 2868` 完整物理分辨率压力测试中，60fps 目标只能达到 `52.99fps`，40fps 可维持 `39.99fps`；主回调 CPU 降低 `16.8%`，WebGL 提交降低约 `23.7%`。
- 60Hz 权威模拟的主要重复工作是每步扫描 695 个对象并重建索引/空间哈希；实际持续路线运动对象为 55 个（44 辆车、11 个行人），物理只需要处理 active 对象。

## 决策

- 权威模拟固定保持 `60Hz`，不改变移动、碰撞、Bot、技能、计分、计时或联机权威语义。
- `requestAnimationFrame` 继续作为页面调度源；场景同步、WebGL clear/render 使用 deadline 累进的 `45fps` / `60fps` 用户选项，不使用易累积漂移的固定 `setTimeout`。移动端首次默认 `45fps`，桌面端首次默认 `60fps`，保存后以用户选择为准。
- resize、页面可见性恢复、checkpoint 和首帧强制立即渲染；普通权威 step 的变更合并到下一个已选帧率的渲染 deadline。
- offline/host 每局显式创建可从 `SimulationState` 重建的 `SimulationRuntime`，持久保存对象 ID 索引、对象引用索引、静态空间哈希、路线对象、车辆、active 对象、渐隐对象和 dirty 对象集合。
- `SimulationState` 继续是 checkpoint、网络和确定性回放的唯一权威状态；runtime 只保存派生数据，不进入协议，不使用模块全局对局状态。
- 城市渲染器只处理 dirty 对象和仍在下落/渐隐的对象；原有 10Hz 远距裁剪与相机遮挡刷新保留全量可见性检查，避免改变画面规则。
- 不使用 Worker。当前状态所有权、同步和渲染均保留在主线程，避免引入跨线程复制与时序风险。

## 实现验证

- 生产构建在 `440 × 956`、DPR 3 下使用 `660 × 1434` drawing buffer 与 WebGL2 4x MSAA，连续采样保持 45fps。
- 完整 `1320 × 2868` drawing buffer 与 4x MSAA 压力测试连续 10 秒得到 `44.980fps`、`3831` draw calls/s、`4.38M` triangles/s；rAF 主回调 CPU 为 `131.9ms/s`，最大单次回调 `3.3ms`。
- 相同确定性车辆周期测试从本轮改动前约 `664ms` 降至 `313ms`，持久索引/集合路径减少约 `52.9%` 测试运行时间。
- 自动测试验证洞半径变化只增加 ground shape 更新计数，world 与 active body 创建计数不增加；完整吞噬、洞缘承托、落地恢复和确定性回放测试保持通过。
