# AGENTS.md

本文件是给 AI 编码 agent(Codex / Claude Code)的项目说明书。开始写任何代码前，请先完整阅读本文件，并阅读 `SPEC.md` 了解当前需求现状。**AGENTS.md 管"怎么写代码"（工程规则，改动频率低），SPEC.md 管"做什么"（需求现状，随功能迭代更新）**，不要把两者内容混着写。

这是一个 Hole.io 风格的 Web 3D 休闲游戏，默认单机（带 AI 机器人），可选联机（WebRTC P2P，房主权威广播架构）。

## 0. 核心设计原则（优先级最高，任何实现都不能违反）

1. **客户端永不信任自己的状态**。位置、分数、体积、吞噬判定，全部由联机模式下的 host 或单机模式下的本地权威循环计算，客户端只渲染。路由车辆的渲染位置由初始相位与 host 权威 `elapsed` 的共享纯函数确定，guest 不做本地推进。任何"客户端自己算出结果再上报"的写法都是错误实现。
2. **单机与联机复用同一套模拟代码**。游戏核心逻辑（移动、碰撞、吞噬判定、bot AI）写在 `packages/shared/simulation`，不依赖浏览器 DOM/WebRTC/Node API。单机模式下由本地循环直接调用，联机模式下由 host 客户端调用后广播结果。不要为单机和联机各写一套判定逻辑，也不要因为它现在只在浏览器里跑就依赖浏览器全局对象。
3. **后端只做"不方便 P2P 的事"**：信令转发、TURN 中继、存档持久化。不要把游戏逻辑往后端塞。
4. **性能优先照顾移动端**。任何美术资源、渲染决策，先问"这个在千元机的移动浏览器上跑得动吗"。
5. **已知的架构性限制不要试图在代码层"修复"**，见第 8 节。除非用户明确要求做架构升级（比如切换到服务器权威模式），否则不要自作主张引入复杂的反作弊/一致性方案。
6. **代码不能沦为黑盒**：本文件规定的 lint 规则、skills、SPEC.md 更新义务都是硬性约束，不是可选建议。agent 写完代码后必须能解释"这段代码符合哪条约定、参考了哪个 skill"，写不出这个解释就说明可能走偏了。

## 1. 技术栈

### 前端

- **构建工具**：Vite。不用 Next.js —— 本项目没有 SSR/SEO 需求，游戏主体是 canvas 里的实时渲染，Next.js 的服务端渲染心智模型和这种强客户端、强命令式的场景不匹配，只会增加不必要的复杂度。如果未来需要一个独立的营销落地页，那是一个单独的小项目，不要并入游戏本体。
- **渲染**：Three.js，纯 TypeScript 命令式写法。**不引入 react-three-fiber**：渲染循环是 60fps 高频更新，塞进 React 的 diff/reconcile 机制没有收益，还会拖慢 AI agent 生成代码时"该用 hooks 还是该直接操作 three.js 对象"的判断，出错率明显更高。
- **UI 外壳**：React，只负责 canvas 之外的所有界面（主菜单、房间加入、皮肤商店、HUD、设置面板）。这部分是状态驱动的表单/列表场景，是 React 的舒适区，也是 AI 训练语料覆盖最好的部分。
- **状态桥接**：zustand。它的 store 是框架无关的，可以在 vanilla 的 game loop 里直接 `store.getState()`/`store.setState()`，同时又给 React UI 层提供 hook 订阅——分数、连接状态、房间号这类"引擎更新、UI 展示"的数据用它，不走 props 层层传递。
- **物理**：`cannon-es`，只用于"物体被吞噬时的下坠/倾倒动画"，不要给地图上所有静态物件都创建刚体。
- **语言**：TypeScript，`strict: true`。

### 后端

- **语言**：Node.js + TypeScript（不用 Rust —— 后端职责薄，全是 I/O 转发/存储，用不上 Rust 的性能优势，反而拖慢 agent 迭代速度）。
- **进程**：一个 **Fastify** 进程同时承担信令 WebSocket（`@fastify/websocket`）和存档 REST API，不单独起两个服务。Ubuntu 生产环境使用一个 systemd 服务，不使用 PM2、Node cluster 或 Docker。
- **不用 socket.io**：信令消息就是几种简单 JSON 转发，原始 WebSocket 够用，不需要 socket.io 那套自动重连/命名空间机制。
- **数据库**：PostgreSQL（用户和数据库名均为 `holeio`），连接池使用 `pg` / `@fastify/postgres`，查询和 migration 使用 **Drizzle**。密码、连接串、TURN secret 等敏感信息只从环境变量、`.env.local` 或 `.env` 读取。
- **TURN/STUN**：`coturn`，在 Ubuntu 生产机上使用原生 systemd 服务；coturn 本身不是我们写代码的部分。

### 联机协议

- WebRTC `RTCDataChannel`，高频输入/位置增量用 `{ordered: false, maxRetransmits: 0}`（类 UDP，允许丢包不重传），世界事件、重同步请求和分块 checkpoint 用默认 reliable channel。联机每房最多 5 名真人，禁止 Bot 和断线 Bot 接管。

### 代码质量工具

- **Lint**：`oxlint`。已是稳定产品（v1.x，841 条内置规则），官方建议大部分项目直接用它替代 ESLint，速度是 ESLint 的 50-100 倍，适合 agent 高频迭代时的即时反馈。
- **格式化**：`oxfmt`。目前仍是 beta（截至 2026 年年中），大部分场景够用，但部分文件类型（例如 Markdown）内部仍依赖 Prettier 兜底，还没到完全替代 Prettier 的成熟度。配置里保留"oxfmt 处理有问题的文件类型回退 Prettier"的口子，不要因为 oxfmt 的边缘 case 卡死 CI。
- **提交前检查**：`lint-staged` + git hook，跑 `oxlint --fix` + `oxfmt`，未通过禁止提交。
- **CI**：PR 阶段跑 `oxlint`（不自动 fix，报错即失败）+ `tsc --noEmit` 类型检查。

## 2. Monorepo 结构

pnpm workspace，不引入 Nx/Turborepo 这类重工具（项目规模用不上）。

```
/packages
  /client                  # Vite + Three.js + React(UI壳) + zustand
    /src
      /game                  # three.js 场景、渲染循环、输入采集、动画
      /ui                     # React 组件：菜单、房间、商店、HUD
      /net
        signaling.ts           # 连接信令服务器、房间心跳、交换 SDP/ICE
        dataChannel.ts         # 封装 DataChannel 收发、心跳、断线检测
        snapshotInterp.ts      # 快照插值
      /map
        editor/                 # 地图编辑器（网格摆放、导出 JSON）
        loader.ts                # 加载地图 JSON + glTF 预制件
      /save
        client.ts               # 存档 API 调用、本地密钥管理
      /store                  # zustand stores
      main.tsx

  /server                   # Fastify：信令 WS + 存档 REST API 合一进程
    /src
      signaling/               # 房间管理（内存态 Map），SDP/ICE 转发
      saveApi/                  # REST 路由
      db/                        # Drizzle schema + migrations

  /shared                   # client 和 server 都直接 import，禁止两边各写一份
    /simulation               # 纯逻辑：移动、碰撞、吞噬判定、bot AI（0.2 条）
    /protocol                  # 输入包/快照/信令消息的类型定义（见第 4 节）

/assets
  /kits                     # Kenney / Quaternius 等 CC0 素材，按主题分子目录
  /maps                     # 地图编辑器导出的 JSON

/infra
  /coturn                    # 原生 coturn 配置模板

/.claude/skills             # 见第 5 节
SPEC.md                      # 见第 6 节
AGENTS.md                    # 本文件
```

## 3. 目录/协议约定（不要违反）

- `packages/shared/protocol` 里的类型定义（输入包、状态快照、信令消息）是 client 和 server 的唯一真源，两边必须直接 `import`，禁止手动复制一份保持同步。
- `packages/shared/simulation` 必须是纯函数/无副作用风格，不引入浏览器全局对象（`window`/`document`）或 Node 专属 API，保证它既能在浏览器主线程（单机/host）跑，也能在未来迁移到 server 权威模式时原封不动搬进 Node 进程。

## 4. 核心数据协议

（协议字段的当前定义以 `packages/shared/protocol` 源码为准，本节只描述结构性约定，不重复维护字段级细节，避免和代码本身产生不一致。）

- **输入包**（guest → host，高频约 30Hz）：只携带 matchId、归一化输入方向、序号、客户端时间戳和技能意图，不携带任何位置/分数字段——这是硬性规则，位置和分数永远由 host 计算，不接受 guest 上报。
- **状态增量**（host → guest，约 10Hz）：携带 `snapshotSeq`、`baseWorldRevision/worldRevision`、全部玩家当前状态和本次改变的世界对象。快照序号允许断层；世界 revision 不连续时通过 reliable channel 请求分块 checkpoint。checkpoint 包含全部玩家/道具/临时实体，以及所有偏离地图初始基线的物体；初始状态物体不传。
- **信令消息**（客户端 ↔ 信令服务，WebSocket）：创建/进入房间、ready、SDP/ICE、固定对局计时和 4 秒 application heartbeat。WSS 在 playing 期间保持连接，服务端只处理 heartbeat 和主动 `leave-room`；游戏数据不经后端。
- **存档协议**（客户端 ↔ 存档 API，HTTPS REST）：客户端本地生成 `{ playerId, secret }` 存 localStorage，所有存档读写请求必须带这对凭证校验；写入是"事件化"（如 `POST /save/coins { delta: +50 }`），不是客户端直接上报最终数值——这能降低但不能杜绝被篡改的风险，见第 8 节。

## 5. Skills 目录与使用规则

`/.claude/skills` 下维护项目专属的领域最佳实践，和 lint 分工不同：**lint 管语法/格式层面，skills 管架构/领域层面的约定**。Agent 在动手写某个领域的代码前，必须先读对应 skill 文件，写完后要能说出参考了哪一条。

推荐建立以下 skills（内容随项目推进逐步补充，不要求一开始就写满）：

- **`webrtc-protocol`**：DataChannel 建连流程、reliable/unreliable channel 的选用场景、协议字段改动时必须同步修改的位置清单（对应第 3 节的单一真源规则）、host 权威循环的写法约定。
- **`react-zustand-ui`**：UI 层和 game 层的边界在哪、store 拆分粒度、哪些状态该进 zustand 哪些该是组件内部 state。
- **`drizzle-postgres`**：schema 变更流程、migration 写法、存档相关表的事件化写入模式（对应第 4 节）。
- **`map-data-format`**：地图 JSON 结构、预制件引用规则、可吞噬阈值字段的语义，供地图编辑器和程序化生成算法共同遵守。

每个 skill 文件保持精简（几十到一两百行），只写"容易做错的地方"和"这个项目特有的约定"，不要重复写框架官方文档已经讲清楚的通用知识。

## 6. SPEC.md 工作流规则

`SPEC.md` 是需求现状的唯一真源，要求：

- **只记录"是什么"，不记录"为什么这样设计"**（设计权衡的讨论记录放 `docs/decisions/` 之类的地方，不进 SPEC.md）。
- 保持轻量，用列表/表格代替大段叙述，一眼能扫完当前有哪些功能、哪些参数。
- **任何影响到玩法规则、协议字段、界面流程的改动，必须在同一次提交里同步更新 SPEC.md**，agent 完成一个功能后如果没有更新 SPEC.md，视为任务未完成。
- 不确定某个改动算不算"需要更新 SPEC"，按"如果三个月后一个新加入项目的人只读 SPEC.md 能不能准确还原这个功能"来判断。

## 7. 开发阶段规划

1. **Phase 0 — 脚手架**：pnpm workspace 搭起来，`packages/client` 里 Vite + Three.js 跑起来，一个可控制移动的球体 + 一个平面地板。
2. **Phase 1 — 单机核心玩法**：`packages/shared/simulation`（碰撞检测、吞噬判定、体积增长）、硬编码几十个静态预制件摆出一个小场景、bot AI（简单的追逐/游荡状态机）。
3. **Phase 2 — 地图编辑器**：网格吸附摆放预制件、导出/导入 JSON、把 Phase 1 的硬编码地图迁移成编辑器产出的数据。
4. **Phase 3 — 联机**：`packages/server` 信令、DataChannel 建连、host 广播循环、快照插值、TURN 兜底。
5. **Phase 4 — 存档系统**：存档 API、皮肤/地图购买、本地密钥方案。
6. **Phase 5 — 打磨**：移动端触控优化、性能优化、音效、UI 完整度。

每个 Phase 结束应该有可玩/可演示的版本，不要跳阶段。每完成一个 Phase，写一份简短的 `docs/phase-N-notes.md` 记录做了什么、还有什么已知问题，方便后续 agent 接手。

## 8. 已知架构限制（不要试图代码层面"解决"，除非用户明确要求架构升级）

- **Host 作弊**：host 是在玩家自己浏览器里跑的代码，没有中立方审计，理论上可以偷改自己的分数/体积再广播。缓解手段（限速、异常值检测）可以做，但不要指望能根除，这是纯 P2P 架构的结构性代价。
- **存档经济系统可被篡改**：没有权威对战服务器验证"这局分数是不是真实打出来的"，客户端理论上可以伪造事件请求刷金币。第 4 节的"事件化 + 频率限制"是缓解手段，不是根治方案。
- **TURN 带宽是硬约束**：TURN 中继连接数和流量存在部署上限，上线后要用 coturn 日志监控实际用量，不要只信理论计算。
- **Host 掉线 = 房间解散**：v1 不做 host 迁移，掉线直接结算/解散，所有人回退单机继续。

## 9. 给 agent 的编码约定

- TypeScript `strict` 模式，禁止 `any`（`packages/shared/protocol` 里的类型尤其要严格）。
- 提交前本地跑 `oxlint --fix && oxfmt`，CI 会重复检查，不要绕过 git hook。
- 涉及协议改动时，先改 `packages/shared/protocol`，再改 client/server 两端实现，禁止两端手动维护重复的接口定义。
- 写某个领域的代码前先读 `/.claude/skills` 里对应的 skill 文件；发现某个坑反复出现但没有对应 skill 记录，主动创建一个新的 skill 文件而不是只在代码注释里提一句。
- 完成任何影响玩法/协议/界面的改动后，同步更新 `SPEC.md`（见第 6 节），这是任务完成的必要条件，不是可选步骤。

## 其他

### 开发规范

- 必须使用 pnpm / pnpx 替代 npm / npx
- 禁止编写任何 js 文件

### skills

需要预装的 skills:

- react-best-practices
- web-design-guidelines
- [fastify-best-practices](https://www.skills.sh/mcollina/skills/fastify-best-practices)
- threejs-fundamentals
- threejs-geometry
- threejs-loaders
- hreejs-interaction
- hreejs-animation
- hreejs-shaders
- hreejs-materials
- hreejs-lighting
- threejs-textures
