import {
  BOMB_COOLDOWN_SECONDS,
  INITIAL_HOLE_RADIUS,
  PLAYER_CAPTURE_SCORE,
  MAP_HALF_HEIGHT,
  MAP_HALF_WIDTH,
  MAP_HEIGHT,
  MAP_WIDTH,
  RADIUS_BOOST_COOLDOWN_SECONDS,
  ROAD_X_CENTERS,
  ROAD_Y_CENTERS,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  SPEED_BOOST_COOLDOWN_SECONDS,
  createInitialSimulation,
  createSimulationPhysicsRuntime,
  createSimulationRuntime,
  getHoleProgress,
  routedPositionAt,
  stepSimulation,
  type AbilityId,
  type FootprintStrike,
  type HoleState,
  type PlayerInput,
  type PowerUpType,
  type SimulationEvent,
  type SimulationPhysicsRuntime,
  type SimulationRuntime,
  type SimulationState,
  type Vector2,
  type WorldObjectState,
} from "@hole-io/shared/simulation";
import {
  applyCheckpointToState,
  applyDeltaToState,
  buildFullCheckpoint,
  simulationEventToWorldEvent,
  stateToDeltaSnapshot,
  type FullStateCheckpoint,
  type StateDeltaSnapshot,
  type WorldEvent,
} from "@hole-io/shared/protocol";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { MatchResult } from "../app/matchResult";
import { translate } from "../app/i18n";
import type { GamePreferences } from "../app/preferences";
import { CityObjectRenderer } from "./CityObjectRenderer";
import { Feedback } from "./Feedback";
import { HoleRenderer } from "./HoleRenderer";
import { InputController } from "./InputController";
import { LocalHolePredictor } from "./localHolePredictor";
import { PowerUpRenderer } from "./PowerUpRenderer";
import { SnapshotInterpolator } from "./snapshotInterp";
import { TrafficLightRenderer } from "./TrafficLightRenderer";

const FIXED_STEP_SECONDS = 1 / 60;
/** 单帧最多追赶的模拟步数上限。卡顿（GC/标签页切换/上下文丢失恢复）后只补有限步、丢弃其余积压，
 *  避免"一步慢→多步补→更慢"的螺旋卡死；正常 60Hz 帧只跑 1 步，行为无变化。 */
const MAX_STEPS_PER_FRAME = 5;
/** guest 模式把本地输入上报给 host 的目标频率（~30Hz）。 */
const INPUT_SEND_INTERVAL_SECONDS = 1 / 30;
const MAX_RENDER_PIXEL_RATIO = 1.5;
/** host/offline 传给 CityObjectRenderer 的占位空脚印列表（这两端物体自带 footprintFadeRemaining 字段）。 */
const EMPTY_FOOTPRINTS: readonly FootprintStrike[] = Object.freeze([]);

export type GameMode = "offline" | "host" | "guest";

interface RemoteInput {
  direction: Vector2;
  /** 尚未被权威循环消费的技能意图；host step 后清空。 */
  pendingAbilities: AbilityId[];
  seq: number;
}

export interface GameConfig {
  canvas: HTMLCanvasElement;
  ui: GameUi;
  preferences: GamePreferences;
  initialState: SimulationState;
  /** 本地玩家的 hole id：单机为 "player"，联机为本地 peerId。 */
  localPlayerId: string;
  mode: GameMode;
  /** hole id → 显示名（排名行、结算）。 */
  playerNames: ReadonlyMap<string, string>;
  /** hole id → 圆环颜色 #RRGGBB。 */
  playerColors: ReadonlyMap<string, THREE.ColorRepresentation>;
  /** 联机对局 id；offline 为 null。 */
  matchId: string | null;
  onMatchEnd: (result: MatchResult) => void;
  onPoopHit: (playerCount: number) => void;
  /** host 模式：每 ~100ms 产出一条要广播的 unreliable 增量快照。 */
  onBroadcastSnapshot?: ((delta: StateDeltaSnapshot) => void) | undefined;
  /** host 模式：每步产出已转换的可靠 WorldEvent（driver 直接 reliable 广播）。 */
  onWorldEvents?: ((events: readonly WorldEvent[]) => void) | undefined;
  /** guest 模式：~30Hz 把本地归一化输入 + 技能意图上报给 host。seq 由 Game 生成，驱动客户端预测和解。 */
  onSendLocalInput?:
    | ((seq: number, direction: Vector2, abilities: readonly AbilityId[]) => void)
    | undefined;
}

export interface GameUi {
  score: HTMLElement;
  radius: HTMLElement;
  sizeLevel: HTMLElement;
  growthCopy: HTMLElement;
  growthFill: HTMLElement;
  time: HTMLElement;
  timerRoot: HTMLElement;
  fps: HTMLElement;
  rankingRows: readonly RankingRowUi[];
  dragPad: HTMLElement;
  dragKnob: HTMLElement;
  loading: HTMLElement;
  loadingBar: HTMLElement;
  loadingStatus: HTMLElement;
  scoreEffects: HTMLElement;
  opponentIndicators: readonly OpponentIndicatorUi[];
  abilityButtons: readonly [AbilityButtonUi, AbilityButtonUi, AbilityButtonUi];
  abilityFeedback: HTMLElement;
  powerUpLayer: HTMLElement;
}

export interface AbilityButtonUi {
  root: HTMLButtonElement;
  cooldown: HTMLElement;
  status: HTMLElement;
}

export interface RankingRowUi {
  root: HTMLElement;
  position: HTMLElement;
  avatar: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  score: HTMLElement;
}

export interface OpponentIndicatorUi {
  root: HTMLElement;
  arrow: HTMLElement;
  distance: HTMLElement;
  name?: HTMLElement;
}

export class Game {
  readonly #canvas: HTMLCanvasElement;
  readonly #ui: GameUi;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(43, 1, 0.1, 650);
  readonly #renderer: THREE.WebGLRenderer;
  readonly #input: InputController;
  readonly #feedback = new Feedback();
  readonly #cityObjects: CityObjectRenderer;
  readonly #holeRenderer: HoleRenderer;
  readonly #powerUpRenderer: PowerUpRenderer;
  readonly #trafficLights: TrafficLightRenderer;
  readonly #geometries = new Set<THREE.BufferGeometry>();
  readonly #materials = new Set<THREE.Material>();
  readonly #textures = new Set<THREE.Texture>();
  /** 同材质地面片先收集到这里，#buildScene 结束时合并成单 draw call。 */
  readonly #groundGeometriesByMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly #groundBake = new THREE.Matrix4();
  readonly #cameraTarget = new THREE.Vector3();
  readonly #cameraDesired = new THREE.Vector3();
  readonly #cameraOffset = new THREE.Vector3(0, 20, 15);
  readonly #cameraLookAt = new THREE.Vector3();
  readonly #scoreWorldPosition = new THREE.Vector3();
  readonly #opponentDelta = new THREE.Vector3();
  readonly #cameraForward = new THREE.Vector3();
  readonly #cameraRight = new THREE.Vector3();
  readonly #worldUp = new THREE.Vector3(0, 1, 0);
  #state: SimulationState;
  readonly #mode: GameMode;
  readonly #physicsRuntime: SimulationPhysicsRuntime | null;
  readonly #simulationRuntime: SimulationRuntime | null;
  readonly #localPlayerId: string;
  readonly #playerNames: ReadonlyMap<string, string>;
  readonly #playerColors: ReadonlyMap<string, THREE.ColorRepresentation>;
  readonly #matchId: string | null;
  readonly #onBroadcastSnapshot: ((delta: StateDeltaSnapshot) => void) | undefined;
  readonly #onWorldEvents: ((events: readonly WorldEvent[]) => void) | undefined;
  readonly #onSendLocalInput:
    | ((seq: number, direction: Vector2, abilities: readonly AbilityId[]) => void)
    | undefined;
  // host 权威广播状态
  #snapshotSeq = 0;
  #hostTick = 0;
  #worldRevision = 0;
  #baseWorldRevision = 0;
  #snapshotAccumulator = 0;
  readonly #emittedConsumed = new Set<string>();
  readonly #emittedResized = new Set<string>();
  readonly #initialObjects: readonly WorldObjectState[];
  readonly #remoteInputs = new Map<string, RemoteInput>();
  readonly #lastProcessedInputByPeer = new Map<string, number>();
  // guest 输入上报状态
  #inputSendAccumulator = 0;
  #lastTime = 0;
  #accumulator = 0;
  #renderDeltaAccumulator = 0;
  #nextRenderTime = 0;
  #hudAccumulator = 0;
  #fpsWindowStartedAt = 0;
  #renderedFramesInWindow = 0;
  #matchStarted = false;
  #pageVisible = document.visibilityState !== "hidden";
  #forceRender = true;
  #fullObjectSyncPending = true;
  readonly #guestDirtyObjectIds = new Set<string>();
  readonly #objectIndexById = new Map<string, number>();
  readonly #routedVehicleIndices: readonly number[];
  #guestElapsedFrom = 0;
  #guestElapsedTo = 0;
  #guestElapsedStartedAt = 0;
  #guestElapsedDuration = 0;
  /** guest：快照位置插值器（host 仍权威，仅平滑渲染）。offline/host 不使用。 */
  readonly #interp = new SnapshotInterpolator();
  /** guest 渲染用的 holes：position/radius 已插值，其余字段取最新快照。非 guest 渲染为 null。 */
  #renderHoles: readonly HoleState[] | null = null;
  /** 上次 #buildRenderHoles 的墙钟，用于算插值时钟的 dt（0 表示待初始化）。 */
  #interpLastSampleTime = 0;
  /** guest：本地玩家洞的客户端预测（跟手），快照到达时和解；offline/host 不使用。 */
  readonly #predictor = new LocalHolePredictor();
  /** guest：本地输入序号，随每次上报递增；host 回传 lastProcessedInputSeq 供预测和解。 */
  #inputSeq = 0;
  /** 当前领先者 hole id（12.5Hz HUD 内更新），渲染帧直接读，避免每帧重排 holes。 */
  #leaderId: string | undefined;
  #resizePending = false;
  /** 画布视口尺寸缓存（resize 时刷新）。DOM 叠层/浮字定位只读它，
   *  避免在吞噬等热路径里读 clientWidth/getBoundingClientRect 触发强制布局。 */
  #viewportWidth = 0;
  #viewportHeight = 0;
  readonly #preferences: GamePreferences;
  readonly #renderIntervalMilliseconds: number;
  /** host：增量快照广播间隔（秒），由 host 的「同步频率」偏好决定；guest/offline 不使用。 */
  readonly #snapshotIntervalSeconds: number;
  readonly #onMatchEnd: (result: MatchResult) => void;
  readonly #onPoopHit: (playerCount: number) => void;
  readonly #pendingAbilities = new Set<AbilityId>();
  #abilityFeedbackTimer: number | null = null;
  #lastBombFuseRemaining = 0;
  #playerSwallowCount = 0;

  private constructor(
    config: GameConfig,
    physicsRuntime: SimulationPhysicsRuntime | null,
    simulationRuntime: SimulationRuntime | null,
  ) {
    const { canvas, ui, preferences } = config;
    this.#canvas = canvas;
    this.#ui = ui;
    this.#preferences = preferences;
    this.#renderIntervalMilliseconds = 1_000 / preferences.renderFrameRate;
    this.#snapshotIntervalSeconds = 1 / preferences.snapshotFrequency;
    this.#onMatchEnd = config.onMatchEnd;
    this.#onPoopHit = config.onPoopHit;
    this.#state = config.initialState;
    this.#initialObjects = config.initialState.objects;
    this.#mode = config.mode;
    this.#physicsRuntime = physicsRuntime;
    this.#simulationRuntime = simulationRuntime;
    config.initialState.objects.forEach((object, index) =>
      this.#objectIndexById.set(object.id, index),
    );
    this.#routedVehicleIndices = config.initialState.objects.flatMap((object, index) =>
      object.routeMotion?.kind === "vehicle" ? [index] : [],
    );
    this.#localPlayerId = config.localPlayerId;
    this.#playerNames = config.playerNames;
    this.#playerColors = config.playerColors;
    this.#matchId = config.matchId;
    this.#onBroadcastSnapshot = config.onBroadcastSnapshot;
    this.#onWorldEvents = config.onWorldEvents;
    this.#onSendLocalInput = config.onSendLocalInput;
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: true,
    });
    this.#renderer.setPixelRatio(this.#getPixelRatio());
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.autoClear = false;
    this.#input = new InputController(canvas, ui.dragPad, ui.dragKnob);
    this.#cityObjects = new CityObjectRenderer(this.#scene);
    this.#holeRenderer = new HoleRenderer(this.#scene, {
      colors: config.playerColors,
    });
    this.#powerUpRenderer = new PowerUpRenderer(this.#scene, ui.powerUpLayer);
    this.#trafficLights = new TrafficLightRenderer(this.#scene, config.initialState.objects);
    this.#buildScene();
    this.#holeRenderer.build(config.initialState.holes);
    this.#applyResize();
    this.#updateHud();
    window.addEventListener("resize", this.#resize);
    window.addEventListener("keydown", this.#onShortcut);
    ui.abilityButtons[0].root.addEventListener("click", this.#activateSpeed);
    ui.abilityButtons[1].root.addEventListener("click", this.#activateRadius);
    ui.abilityButtons[2].root.addEventListener("click", this.#activateBomb);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  static async create(
    canvas: HTMLCanvasElement,
    ui: GameUi,
    preferences: GamePreferences,
    onMatchEnd: (result: MatchResult) => void,
    onPoopHit: (playerCount: number) => void,
  ): Promise<Game> {
    const mapSeed = 0x5eed1234;
    const spawnSeed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    const playerNames = new Map<string, string>([
      ["player", preferences.playerName],
      ["bot-1", "BOT 01"],
      ["bot-2", "BOT 02"],
    ]);
    const playerColors = new Map<string, THREE.ColorRepresentation>([
      ["player", preferences.playerRingColor],
      ["bot-1", "#ff8a3d"],
      ["bot-2", "#5aa9e6"],
    ]);
    return Game.#instantiate({
      canvas,
      ui,
      preferences,
      initialState: createInitialSimulation(mapSeed, spawnSeed),
      localPlayerId: "player",
      mode: "offline",
      playerNames,
      playerColors,
      matchId: null,
      onMatchEnd,
      onPoopHit,
    });
  }

  /** 联机工厂：driver 在收到 match-start 并建好初始 state 后调用（mode 为 host/guest）。 */
  static async createOnline(config: GameConfig): Promise<Game> {
    return Game.#instantiate(config);
  }

  static async #instantiate(config: GameConfig): Promise<Game> {
    const physicsRuntime = config.mode === "guest" ? null : await createSimulationPhysicsRuntime();
    const simulationRuntime =
      config.mode === "guest" ? null : createSimulationRuntime(config.initialState);
    let game: Game;
    try {
      game = new Game(config, physicsRuntime, simulationRuntime);
    } catch (error: unknown) {
      physicsRuntime?.dispose();
      throw error;
    }
    try {
      await game.#cityObjects.initialize(game.#state.objects, (loaded, total) => {
        const progress = total === 0 ? 1 : loaded / total;
        config.ui.loadingBar.style.transform = `scaleX(${progress})`;
        config.ui.loadingStatus.textContent = `${loaded.toString().padStart(2, "0")} / ${total
          .toString()
          .padStart(2, "0")}`;
      });
    } catch (error: unknown) {
      game.dispose();
      throw error;
    }
    config.ui.loading.hidden = true;
    game.#syncScene(1);
    return game;
  }

  start(): void {
    this.#feedback.activate();
    this.#matchStarted = true;
    this.#lastTime = performance.now();
    this.#nextRenderTime = this.#lastTime;
    this.#fpsWindowStartedAt = this.#lastTime;
    this.#renderedFramesInWindow = 0;
    this.#ui.fps.textContent = "-- FPS";
    this.#renderDeltaAccumulator = 0;
    this.#forceRender = true;
    this.#renderer.setAnimationLoop(this.#frame);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    if (this.#abilityFeedbackTimer !== null) {
      window.clearTimeout(this.#abilityFeedbackTimer);
    }
    window.removeEventListener("resize", this.#resize);
    window.removeEventListener("keydown", this.#onShortcut);
    this.#ui.abilityButtons[0].root.removeEventListener("click", this.#activateSpeed);
    this.#ui.abilityButtons[1].root.removeEventListener("click", this.#activateRadius);
    this.#ui.abilityButtons[2].root.removeEventListener("click", this.#activateBomb);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#physicsRuntime?.dispose();
    this.#input.dispose();
    this.#feedback.dispose();
    this.#cityObjects.dispose();
    this.#holeRenderer.dispose();
    this.#powerUpRenderer.dispose();
    this.#trafficLights.dispose();
    this.#geometries.forEach((geometry) => geometry.dispose());
    this.#materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#renderer.dispose();
  }

  readonly #frame = (time: number): void => {
    if (!this.#pageVisible) {
      return;
    }
    const frameSeconds = Math.min((time - this.#lastTime) / 1000, this.#state.remaining);
    this.#lastTime = time;
    this.#accumulator += frameSeconds;
    this.#hudAccumulator += frameSeconds;
    this.#renderDeltaAccumulator += frameSeconds;

    if (this.#mode === "guest") {
      // guest 不推进模拟；车辆在渲染时由 host elapsed 的纯函数位置重建。
      this.#accumulator = 0;
      if (this.#matchStarted) {
        this.#inputSendAccumulator += frameSeconds;
        if (this.#inputSendAccumulator >= INPUT_SEND_INTERVAL_SECONDS) {
          this.#inputSendAccumulator = 0;
          this.#emitLocalInput();
        }
      }
    } else {
      let stepsThisFrame = 0;
      while (
        this.#matchStarted &&
        this.#accumulator >= FIXED_STEP_SECONDS &&
        stepsThisFrame < MAX_STEPS_PER_FRAME
      ) {
        this.#stepAuthoritative();
        this.#accumulator -= FIXED_STEP_SECONDS;
        stepsThisFrame += 1;
      }
      // 超过单帧上限的积压直接丢弃，防止卡顿后螺旋追赶。
      if (this.#accumulator > FIXED_STEP_SECONDS) {
        this.#accumulator = 0;
      }
      if (!this.#matchStarted) {
        this.#accumulator = 0;
      }
      if (this.#mode === "host" && this.#matchStarted) {
        this.#snapshotAccumulator += frameSeconds;
        if (this.#snapshotAccumulator >= this.#snapshotIntervalSeconds) {
          this.#snapshotAccumulator = 0;
          this.#broadcastSnapshot();
        }
      }
    }

    if (this.#hudAccumulator >= 0.08 || this.#state.status === "finished") {
      this.#updateHud();
      this.#hudAccumulator = 0;
    }
    const renderDue =
      this.#forceRender ||
      this.#state.status === "finished" ||
      time + Number.EPSILON >= this.#nextRenderTime;
    if (renderDue) {
      const renderElapsed =
        this.#mode === "guest" ? this.#sampleGuestElapsed(time) : this.#state.elapsed;
      if (this.#mode === "guest") {
        this.#syncGuestRoutedObjects(renderElapsed);
        this.#buildRenderHoles(time);
      }
      if (this.#matchStarted || this.#forceRender) {
        this.#syncScene(this.#renderDeltaAccumulator, renderElapsed);
      }
      this.#renderer.clear(true, true, true);
      this.#renderer.render(this.#scene, this.#camera);
      this.#updateFps(time);
      this.#renderDeltaAccumulator = 0;
      this.#forceRender = false;
      if (time < this.#nextRenderTime) {
        this.#nextRenderTime = time + this.#renderIntervalMilliseconds;
      } else {
        const elapsedDeadlines =
          Math.floor((time - this.#nextRenderTime) / this.#renderIntervalMilliseconds) + 1;
        this.#nextRenderTime += elapsedDeadlines * this.#renderIntervalMilliseconds;
      }
    }
    if (this.#state.status === "finished" && this.#matchStarted) {
      this.#matchStarted = false;
      this.#renderer.setAnimationLoop(null);
      this.#onMatchEnd(this.#createMatchResult());
    }
  };

  #updateFps(time: number): void {
    this.#renderedFramesInWindow += 1;
    const elapsed = time - this.#fpsWindowStartedAt;
    if (elapsed < 500) return;
    this.#ui.fps.textContent = `${Math.round((this.#renderedFramesInWindow * 1_000) / elapsed)} FPS`;
    this.#fpsWindowStartedAt = time;
    this.#renderedFramesInWindow = 0;
  }

  /** offline/host：固定步长推进一步权威模拟，并消费本地 + 远端输入。 */
  #stepAuthoritative(): void {
    if (this.#physicsRuntime === null) {
      throw new Error("Guest games cannot run the authoritative simulation");
    }
    const inputs: PlayerInput[] = [
      {
        playerId: this.#localPlayerId,
        direction: this.#input.getDirection(),
        abilities: [...this.#pendingAbilities],
      },
    ];
    this.#pendingAbilities.clear();
    for (const [peerId, remote] of this.#remoteInputs) {
      this.#lastProcessedInputByPeer.set(peerId, remote.seq);
      inputs.push({
        playerId: peerId,
        direction: remote.direction,
        abilities: remote.pendingAbilities,
      });
      remote.pendingAbilities = [];
    }
    if (this.#simulationRuntime === null) {
      throw new Error("Guest games cannot own a simulation runtime");
    }
    const result = stepSimulation(
      this.#state,
      inputs,
      FIXED_STEP_SECONDS,
      this.#physicsRuntime,
      this.#simulationRuntime,
    );
    this.#state = result.state;
    this.#hostTick += 1;
    result.events.forEach((event) => this.#handleEvent(event));
    if (this.#mode === "host" && result.events.length > 0) {
      // 可观察世界的离散变化递增 worldRevision（吞噬/阵亡/道具），供 guest 重同步判定。
      this.#worldRevision += result.events.length;
      const worldEvents: WorldEvent[] = [];
      for (const event of result.events) {
        const worldEvent = simulationEventToWorldEvent(event, {
          matchId: this.#matchId ?? "",
          worldRevision: this.#worldRevision,
          powerUps: this.#state.powerUps,
        });
        if (worldEvent !== null) worldEvents.push(worldEvent);
      }
      if (worldEvents.length > 0) this.#onWorldEvents?.(worldEvents);
    }
  }

  /** guest：把本地归一化输入 + 技能意图上报给 host（driver 包装成 InputPacket）。seq 在此生成并记入预测器。 */
  #emitLocalInput(): void {
    if (this.#onSendLocalInput === undefined) return;
    this.#inputSeq += 1;
    const direction = this.#input.getDirection();
    const abilities = [...this.#pendingAbilities];
    this.#pendingAbilities.clear();
    this.#onSendLocalInput(this.#inputSeq, direction, abilities);
    this.#predictor.recordInput(this.#inputSeq, direction, performance.now());
  }

  /** host：把当前权威状态编码成增量快照，30Hz 广播给所有 guest（guest 渲染时再插值平滑）。 */
  #broadcastSnapshot(): void {
    if (this.#onBroadcastSnapshot === undefined || this.#matchId === null) return;
    const delta = stateToDeltaSnapshot({
      state: this.#state,
      matchId: this.#matchId,
      snapshotSeq: this.#snapshotSeq,
      hostTick: this.#hostTick,
      hostTime: performance.now(),
      baseWorldRevision: this.#baseWorldRevision,
      worldRevision: this.#worldRevision,
      lastProcessedInputByPeer: this.#lastProcessedInputByPeer,
      emittedConsumed: this.#emittedConsumed,
      emittedResized: this.#emittedResized,
      initialObjects: this.#initialObjects,
    });
    this.#snapshotSeq += 1;
    this.#baseWorldRevision = this.#worldRevision;
    this.#onBroadcastSnapshot(delta);
  }

  /** host：driver 收到 guest InputPacket 时缓存，供下一帧权威步消费。 */
  setRemoteInput(
    peerId: string,
    direction: Vector2,
    abilities: readonly AbilityId[],
    seq: number,
  ): void {
    const existing = this.#remoteInputs.get(peerId);
    if (existing === undefined) {
      this.#remoteInputs.set(peerId, { direction, pendingAbilities: [...abilities], seq });
      return;
    }
    existing.direction = direction;
    existing.seq = seq;
    for (const ability of abilities) {
      if (!existing.pendingAbilities.includes(ability)) {
        existing.pendingAbilities.push(ability);
      }
    }
  }

  /** guest：driver 收到 unreliable 增量快照时合并进渲染 state。 */
  applyDelta(delta: StateDeltaSnapshot): void {
    const now = performance.now();
    const renderedElapsed = this.#sampleGuestElapsed(now);
    this.#state = applyDeltaToState(this.#state, delta);
    this.#interp.push(delta);
    this.#reconcileLocalPrediction(delta, now);
    this.#guestElapsedFrom = renderedElapsed;
    this.#guestElapsedTo = delta.elapsed;
    this.#guestElapsedStartedAt = now;
    this.#guestElapsedDuration = Math.min(0.1, Math.max(1 / 60, delta.elapsed - renderedElapsed));
    delta.changedObjects.forEach((object) => this.#guestDirtyObjectIds.add(object.id));
    this.#worldRevision = delta.worldRevision;
  }

  /** guest：用快照里本地玩家的权威位置 + lastProcessedInputSeq 和解预测（回放未确认输入，避免回弹）。 */
  #reconcileLocalPrediction(delta: StateDeltaSnapshot, now: number): void {
    const localSnapshot = delta.players.find((player) => player.peerId === this.#localPlayerId);
    if (localSnapshot === undefined) return;
    const localHole = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    if (localHole === undefined) return;
    if (this.#predictor.position === null) this.#predictor.reset(localSnapshot.position);
    else
      this.#predictor.reconcile(
        localSnapshot.position,
        localSnapshot.lastProcessedInputSeq,
        localHole,
        now,
      );
  }

  /** guest：driver 收到可靠 checkpoint 后重建可观察世界。 */
  applyCheckpoint(checkpoint: FullStateCheckpoint): void {
    this.#state = applyCheckpointToState(this.#state, checkpoint);
    this.#interp.reset();
    this.#renderHoles = null;
    this.#interpLastSampleTime = 0;
    const localHole = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    if (localHole !== undefined) this.#predictor.reset(localHole.position);
    this.#guestElapsedFrom = checkpoint.elapsed;
    this.#guestElapsedTo = checkpoint.elapsed;
    this.#guestElapsedDuration = 0;
    this.#worldRevision = checkpoint.worldRevision;
    this.#guestDirtyObjectIds.clear();
    this.#fullObjectSyncPending = true;
    this.#forceRender = true;
  }

  /** guest 本地 worldRevision，driver 据此与 delta.baseWorldRevision 比对决定是否 resync。 */
  get localWorldRevision(): number {
    return this.#worldRevision;
  }

  /**
   * 用当前渲染 state 构造一局结算结果。供 GamePage 在服务器 match-ended 早于本地 finished
   * 快照到达时兜底用（此时 Game.onMatchEnd 未必触发，但 #state 仍是最近一帧的权威快照）。
   */
  buildCurrentMatchResult(): MatchResult {
    return this.#createMatchResult();
  }

  /** host：driver 收到 guest resync-request 时，编码当前权威世界为可靠 checkpoint。 */
  buildCheckpoint(checkpointId: string): FullStateCheckpoint | null {
    if (this.#matchId === null) return null;
    return buildFullCheckpoint({
      state: this.#state,
      matchId: this.#matchId,
      checkpointId,
      snapshotSeq: this.#snapshotSeq,
      hostTick: this.#hostTick,
      worldRevision: this.#worldRevision,
      hostTime: performance.now(),
      initialObjects: this.#initialObjects,
    });
  }

  #buildScene(): void {
    this.#scene.background = new THREE.Color(0x91b5bf);
    this.#scene.fog = new THREE.Fog(0x91b5bf, 240, 480);
    this.#scene.add(new THREE.HemisphereLight(0xe8f7f4, 0x435646, 2.15));

    const grass = this.#createGroundMaterial(0x6f9d69);
    this.#addGroundPlane(MAP_WIDTH, MAP_HEIGHT, 0, 0, 0, grass);

    const sidewalk = this.#createGroundMaterial(0xc9c5b7);
    const asphalt = this.#createGroundMaterial(0x30383c);
    const lane = this.#createGroundMaterial(0xe8d87c, true);
    const roadAndSidewalkWidth = ROAD_WIDTH + SIDEWALK_WIDTH * 2;
    for (const center of ROAD_Y_CENTERS) {
      this.#addGroundPlane(MAP_WIDTH, roadAndSidewalkWidth, 0, center, 0.03, sidewalk);
      this.#addGroundPlane(MAP_WIDTH, ROAD_WIDTH, 0, center, 0.06, asphalt);
    }
    for (const center of ROAD_X_CENTERS) {
      this.#addVerticalRoadSegments(center, roadAndSidewalkWidth, sidewalk, 0.02);
      this.#addVerticalRoadSegments(center, ROAD_WIDTH, asphalt, 0.05);
    }
    this.#addRoadMarkings(lane);
    this.#flushGroundMeshes();

    this.#camera.position.copy(this.#cameraOffset);
    this.#camera.lookAt(0, 0, 0);
  }

  #createGroundMaterial(color: number, unlit = false): THREE.Material {
    const material = unlit
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshLambertMaterial({ color });
    material.stencilWrite = true;
    material.stencilRef = 1;
    material.stencilFunc = THREE.NotEqualStencilFunc;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.KeepStencilOp;
    this.#materials.add(material);
    return material;
  }

  #addGroundPlane(
    width: number,
    depth: number,
    x: number,
    z: number,
    y: number,
    material: THREE.Material,
  ): void {
    const geometry = new THREE.PlaneGeometry(width, depth);
    // 把"躺平旋转 + 位移"烘焙进顶点，使同材质地面能在 #flushGroundMeshes 合并为单 draw call。
    this.#groundBake.makeRotationX(-Math.PI / 2);
    this.#groundBake.setPosition(x, y, z);
    geometry.applyMatrix4(this.#groundBake);
    const list = this.#groundGeometriesByMaterial.get(material);
    if (list === undefined) {
      this.#groundGeometriesByMaterial.set(material, [geometry]);
    } else {
      list.push(geometry);
    }
  }

  /** 把按材质收集的地面片合并为每材质一个 Mesh，~50 个 draw call → 3 个。 */
  #flushGroundMeshes(): void {
    for (const [material, geometries] of this.#groundGeometriesByMaterial) {
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (merged === null) {
        continue;
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.renderOrder = -11;
      this.#geometries.add(merged);
      this.#scene.add(mesh);
    }
    this.#groundGeometriesByMaterial.clear();
  }

  #addVerticalRoadSegments(
    center: number,
    width: number,
    material: THREE.Material,
    y: number,
  ): void {
    const crossings = [-MAP_HALF_HEIGHT, ...ROAD_Y_CENTERS, MAP_HALF_HEIGHT];
    for (let index = 0; index < crossings.length - 1; index += 1) {
      const start = crossings[index];
      const end = crossings[index + 1];
      if (start === undefined || end === undefined) {
        continue;
      }
      const gap = ROAD_WIDTH / 2 + SIDEWALK_WIDTH;
      const segmentStart = start + (index === 0 ? 0 : gap);
      const segmentEnd = end - (index === crossings.length - 2 ? 0 : gap);
      if (segmentEnd <= segmentStart) {
        continue;
      }
      this.#addGroundPlane(
        width,
        segmentEnd - segmentStart,
        center,
        (segmentStart + segmentEnd) / 2,
        y,
        material,
      );
    }
  }

  #addRoadMarkings(laneMaterial: THREE.Material): void {
    const verticalDashes: THREE.Vector3[] = [];
    const horizontalDashes: THREE.Vector3[] = [];
    for (const center of ROAD_X_CENTERS) {
      for (let along = -MAP_HALF_HEIGHT + 3; along <= MAP_HALF_HEIGHT - 3; along += 7) {
        const insideIntersection = ROAD_Y_CENTERS.some(
          (intersection) => Math.abs(along - intersection) < ROAD_WIDTH / 2 + 3,
        );
        if (!insideIntersection) {
          verticalDashes.push(new THREE.Vector3(center, 0.09, along));
        }
      }
    }
    for (const center of ROAD_Y_CENTERS) {
      for (let along = -MAP_HALF_WIDTH + 3; along <= MAP_HALF_WIDTH - 3; along += 7) {
        const insideIntersection = ROAD_X_CENTERS.some(
          (intersection) => Math.abs(along - intersection) < ROAD_WIDTH / 2 + 3,
        );
        if (!insideIntersection) {
          horizontalDashes.push(new THREE.Vector3(along, 0.095, center));
        }
      }
    }
    this.#addGroundInstances(0.14, 3.2, verticalDashes, laneMaterial);
    this.#addGroundInstances(3.2, 0.14, horizontalDashes, laneMaterial);
  }

  #addGroundInstances(
    width: number,
    depth: number,
    positions: readonly THREE.Vector3[],
    material: THREE.Material,
  ): void {
    const geometry = new THREE.PlaneGeometry(width, depth);
    const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();
    positions.forEach((position, index) => {
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.renderOrder = -10;
    this.#geometries.add(geometry);
    this.#scene.add(mesh);
  }

  /** guest：构造渲染用 holes——本地玩家用客户端预测位置（跟手），其余用快照插值（顺滑）。
   *  插值缓冲不足（首帧 / checkpoint 后）时非本地洞回退到最新快照。 */
  #buildRenderHoles(time: number): void {
    const last = this.#interpLastSampleTime;
    const dtMs = last === 0 ? 0 : Math.min(100, time - last);
    this.#interpLastSampleTime = time;
    const samples = this.#interp.sample(dtMs);

    // 本地洞：用当前输入即时推进预测位置（速度因素取自最新权威快照）。
    const localHole = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    if (this.#predictor.position !== null && localHole !== undefined) {
      this.#predictor.advance(this.#input.getDirection(), dtMs / 1000, localHole);
    }

    this.#renderHoles = this.#state.holes.map((hole) => {
      if (hole.id === this.#localPlayerId && this.#predictor.position !== null) {
        return {
          ...hole,
          position: { x: this.#predictor.position.x, y: this.#predictor.position.y },
        };
      }
      if (samples === null) return hole;
      const sampled = samples.get(hole.id);
      if (sampled === undefined) return hole;
      return { ...hole, position: { x: sampled.x, y: sampled.y }, radius: sampled.radius };
    });
  }

  #syncScene(deltaSeconds: number, renderElapsed = this.#state.elapsed): void {
    const holes = this.#renderHoles ?? this.#state.holes;
    this.#holeRenderer.sync(holes, this.#state.elapsed, deltaSeconds, this.#leaderId);
    const changedObjects = this.#takeChangedObjectsForRender();
    this.#trafficLights.sync(changedObjects, renderElapsed);
    // guest 的被脚印吞噬物体没有 footprintFadeRemaining 字段，改由同步脚印推导 4s 渐隐；
    // host/offline 物体自带该字段，传空数组以完全保持既有行为。
    const fadeFootprints = this.#mode === "guest" ? this.#state.footprints : EMPTY_FOOTPRINTS;

    const player = holes.find((hole) => hole.id === this.#localPlayerId);
    if (!player) {
      this.#cityObjects.sync(changedObjects, deltaSeconds, null, fadeFootprints);
      this.#fullObjectSyncPending = false;
      return;
    }
    this.#cameraTarget.set(player.position.x, 0, player.position.y);
    const radiusRatio = player.radius / INITIAL_HOLE_RADIUS;
    const zoomScale = 1 + Math.max(0, radiusRatio - 1) * 0.5;
    const doubleFoot = player.activePowerUps.some((effect) => effect.type === "doubleFoot");
    const beer = player.activePowerUps.some((effect) => effect.type === "beer");
    this.#cameraOffset.set(
      0,
      doubleFoot ? 32 * zoomScale : 20.5 * zoomScale,
      doubleFoot ? 0.01 : 15 * zoomScale,
    );
    this.#cameraDesired.copy(this.#cameraTarget).add(this.#cameraOffset);
    if (beer) {
      this.#cameraDesired.x += Math.sin(this.#state.elapsed * 3.2) * 0.45;
      this.#cameraDesired.z += Math.cos(this.#state.elapsed * 2.7) * 0.4;
    }
    const followAlpha = 1 - Math.exp(-5.5 * deltaSeconds);
    this.#camera.position.lerp(this.#cameraDesired, followAlpha);
    this.#camera.up.set(0, doubleFoot ? 0 : 1, doubleFoot ? -1 : 0);
    // lookAt 目标必须跟随「已滞后」的相机位置，而不是实时的玩家位置。
    // camera.position 用 lerp 追逐 cameraDesired，必然滞后于 cameraTarget（实时玩家位置）；
    // 若直接 lookAt(cameraTarget)，这个滞后量会混进视线方向，使其随移动方向轻微偏转、
    // 停下又回正——正是移动时「视角轻微旋转马上回正」的来源。
    // 令 lookAt 目标 = cameraTarget + camera.position - cameraDesired，视线方向即恒为
    // -(cameraDesired - cameraTarget)，与滞后无关，移动中不再产生偏转。
    this.#cameraLookAt
      .copy(this.#cameraTarget)
      .add(this.#camera.position)
      .sub(this.#cameraDesired);
    this.#camera.lookAt(this.#cameraLookAt);
    this.#camera.updateMatrixWorld();
    this.#cityObjects.sync(
      changedObjects,
      deltaSeconds,
      {
        player,
        cameraPosition: this.#camera.position,
      },
      fadeFootprints,
    );
    this.#fullObjectSyncPending = false;
    this.#powerUpRenderer.sync(
      this.#state.powerUps,
      this.#state.footprints,
      this.#state.poopHazards,
      holes,
      this.#camera,
      this.#viewportWidth,
      this.#viewportHeight,
    );
    this.#updateOpponentIndicators(player);
  }

  #sampleGuestElapsed(now: number): number {
    if (this.#guestElapsedDuration <= 0) return this.#guestElapsedTo;
    const alpha = Math.min(
      1,
      (now - this.#guestElapsedStartedAt) / (this.#guestElapsedDuration * 1_000),
    );
    return this.#guestElapsedFrom + (this.#guestElapsedTo - this.#guestElapsedFrom) * alpha;
  }

  #syncGuestRoutedObjects(elapsed: number): void {
    let nextObjects: WorldObjectState[] | null = null;
    for (const index of this.#routedVehicleIndices) {
      const object = (nextObjects ?? this.#state.objects)[index];
      if (object === undefined || object.status === "consumed") continue;
      const position = routedPositionAt(object, elapsed);
      if (position.x === object.position.x && position.y === object.position.y) continue;
      nextObjects ??= [...this.#state.objects];
      nextObjects[index] = { ...object, position };
      this.#guestDirtyObjectIds.add(object.id);
    }
    if (nextObjects !== null) this.#state = { ...this.#state, objects: nextObjects };
  }

  #takeChangedObjectsForRender(): readonly WorldObjectState[] {
    if (this.#fullObjectSyncPending) {
      this.#simulationRuntime?.takeDirtyObjects();
      this.#guestDirtyObjectIds.clear();
      return this.#state.objects;
    }
    if (this.#simulationRuntime !== null) {
      return this.#simulationRuntime.takeDirtyObjects();
    }
    const changedObjects: WorldObjectState[] = [];
    for (const objectId of this.#guestDirtyObjectIds) {
      const index = this.#objectIndexById.get(objectId);
      const object = index === undefined ? undefined : this.#state.objects[index];
      if (object !== undefined) {
        changedObjects.push(object);
      }
    }
    this.#guestDirtyObjectIds.clear();
    return changedObjects;
  }

  #updateOpponentIndicators(player: HoleState): void {
    // 同时覆盖单机（对手是 bot）与联机（对手是真人）：联机不生成 bot、单机无其他真人，
    // 故只按 id 排除本地玩家即可；出局/淘汰的由下方 per-slot hidden 处理。
    // 历史上这里曾是 kind === "bot"，后被改成 kind === "human" 导致单机方向标记全部消失。
    const opponents = (this.#renderHoles ?? this.#state.holes).filter(
      (hole) => hole.id !== this.#localPlayerId,
    );
    const width = this.#viewportWidth;
    const height = this.#viewportHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    const horizontalInset = 76;
    const topInset = Math.min(150, height * 0.28);
    const bottomInset = Math.min(82, height * 0.18);
    this.#camera.getWorldDirection(this.#cameraForward);
    this.#cameraForward.y = 0;
    this.#cameraForward.normalize();
    this.#cameraRight.crossVectors(this.#cameraForward, this.#worldUp).normalize();

    this.#ui.opponentIndicators.forEach((indicator, index) => {
      const opponent = opponents[index];
      if (!opponent || opponent.eliminationRemaining > 0 || opponent.isOut) {
        indicator.root.hidden = true;
        return;
      }
      indicator.root.hidden = false;
      if (indicator.name) {
        const displayName = this.#playerNames.get(opponent.id) ?? opponent.id;
        indicator.name.textContent = displayName.toUpperCase();
      }
      this.#opponentDelta.set(
        opponent.position.x - player.position.x,
        0,
        opponent.position.y - player.position.y,
      );
      let directionX = this.#opponentDelta.dot(this.#cameraRight);
      let directionY = -this.#opponentDelta.dot(this.#cameraForward);
      const directionLength = Math.hypot(directionX, directionY);
      if (directionLength < 0.001) {
        directionX = 0;
        directionY = -1;
      }

      const availableX =
        directionX >= 0 ? width - horizontalInset - centerX : centerX - horizontalInset;
      const availableY = directionY >= 0 ? height - bottomInset - centerY : centerY - topInset;
      const scaleX = Math.abs(directionX) > 0.001 ? availableX / Math.abs(directionX) : Infinity;
      const scaleY = Math.abs(directionY) > 0.001 ? availableY / Math.abs(directionY) : Infinity;
      const edgeScale = Math.max(0, Math.min(scaleX, scaleY));
      const x = centerX + directionX * edgeScale;
      const y = centerY + directionY * edgeScale;
      const angle = Math.atan2(directionY, directionX) + Math.PI / 2;
      indicator.root.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      indicator.arrow.style.transform = `rotate(${angle}rad)`;
      indicator.distance.textContent = `${Math.round(
        Math.hypot(
          opponent.position.x - player.position.x,
          opponent.position.y - player.position.y,
        ),
      )}m`;
    });
  }

  #updateHud(): void {
    const player = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    if (!player) {
      return;
    }
    const progress = getHoleProgress(player.score);
    this.#ui.score.textContent = player.score.toString().padStart(5, "0");
    this.#ui.radius.textContent = player.radius.toFixed(2);
    this.#ui.sizeLevel.textContent = (progress.level + 1).toString().padStart(2, "0");
    this.#ui.growthFill.style.transform = `scaleX(${progress.progress})`;
    this.#ui.growthCopy.textContent = progress.nextScore
      ? translate(this.#preferences.language, "toNext", {
          count: progress.nextScore - player.score,
        })
      : translate(this.#preferences.language, "maxSize");
    this.#updateAbilityHud(player);
    const totalSeconds = Math.ceil(this.#state.remaining);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this.#ui.time.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    this.#ui.timerRoot.classList.toggle("is-warn", totalSeconds > 0 && totalSeconds <= 15);
    const rankableHoles = [...this.#state.holes].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.kind !== right.kind) {
        return left.kind === "human" ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    });
    this.#writeRankingRows(this.#ui.rankingRows, rankableHoles);
    // 领先皇冠：复用上面的排序结果（分数降序、人类优先），取首个未出局者。
    const leader = rankableHoles.find((hole) => !hole.isOut && hole.eliminationRemaining <= 0);
    this.#leaderId = leader?.id;
  }

  #updateAbilityHud(player: HoleState): void {
    if (
      this.#lastBombFuseRemaining > 0 &&
      player.bombFuseRemaining === 0 &&
      player.bombCooldown > 0
    ) {
      this.#showAbilityFeedback(translate(this.#preferences.language, "impact"), "bomb", 1_600);
    }
    this.#lastBombFuseRemaining = player.bombFuseRemaining;
    const abilities: readonly [AbilityId, number, number, number, string][] = [
      [
        "speed",
        player.speedBoostRemaining,
        player.speedBoostCooldown,
        SPEED_BOOST_COOLDOWN_SECONDS,
        translate(this.#preferences.language, "ready"),
      ],
      [
        "radius",
        player.radiusBoostRemaining,
        player.radiusBoostCooldown,
        RADIUS_BOOST_COOLDOWN_SECONDS,
        translate(this.#preferences.language, "ready"),
      ],
      [
        "bomb",
        player.bombFuseRemaining,
        player.bombCooldown,
        BOMB_COOLDOWN_SECONDS,
        translate(this.#preferences.language, "ready"),
      ],
    ];
    this.#ui.abilityButtons.forEach((button, index) => {
      const entry = abilities[index];
      if (!entry) return;
      const [, active, cooldown, maxCooldown, readyCopy] = entry;
      const locked = active > 0 || cooldown > 0;
      button.root.disabled = locked;
      button.root.classList.toggle("is-active", active > 0);
      // 冷却从权威发动步开始；E 的激活窗口不能遮住已经开始的冷却计时。
      button.root.classList.toggle("is-cooldown", cooldown > 0);
      const progress = cooldown / maxCooldown;
      button.root.style.setProperty("--ability-progress", `${Math.max(0, Math.min(1, progress))}`);
      button.cooldown.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}s` : "";
      button.status.textContent =
        active > 0
          ? entry[0] === "bomb"
            ? translate(this.#preferences.language, "fuse")
            : translate(this.#preferences.language, "active")
          : cooldown > 0
            ? translate(this.#preferences.language, "recharge")
            : readyCopy;
    });
  }

  #writeRankingRows(rows: readonly RankingRowUi[], rankableHoles: readonly HoleState[]): void {
    const activeHoleCount = rankableHoles.length;
    rows.forEach((row, index) => {
      if (index >= activeHoleCount) {
        row.root.hidden = true;
        return;
      }
      const hole = rankableHoles[index];
      if (!hole) {
        row.root.hidden = true;
        return;
      }
      row.root.hidden = false;
      row.position.textContent = (index + 1).toString();
      const displayName = this.#playerNames.get(hole.id) ?? hole.id;
      const holeProgress = getHoleProgress(hole.score);
      row.avatar.textContent = displayName.charAt(0).toUpperCase() || "·";
      const playerColor = new THREE.Color(this.#playerColors.get(hole.id) ?? "#5f6b7a");
      row.avatar.style.background = `#${playerColor.getHexString()}`;
      const luminance = playerColor.r * 0.2126 + playerColor.g * 0.7152 + playerColor.b * 0.0722;
      row.avatar.style.color = luminance > 0.42 ? "#06121a" : "#ffffff";
      row.name.textContent = displayName.toUpperCase();
      row.meta.textContent = hole.isOut
        ? `Lv.${holeProgress.level + 1} · ${translate(this.#preferences.language, "out")}`
        : `Lv.${holeProgress.level + 1} · R${hole.radius.toFixed(1)}`;
      row.score.textContent = hole.score.toString();
      row.root.classList.toggle("is-player", hole.id === this.#localPlayerId);
      row.root.classList.toggle("is-bot-one", hole.id === "bot-1");
      row.root.classList.toggle("is-bot-two", hole.id === "bot-2");
      row.root.classList.toggle("is-eliminated", hole.eliminationRemaining > 0 || hole.isOut);
      row.root.classList.toggle("is-out", hole.isOut);
      row.root.classList.toggle("was-eliminated", hole.eliminations > 0);
      row.root.dataset.eliminations = hole.eliminations.toString();
    });
  }

  #handleEvent(event: SimulationEvent): void {
    if (event.type === "poop-hit") {
      if (event.holeId === this.#localPlayerId) this.#onPoopHit(this.#state.holes.length);
      return;
    }
    if (event.type === "power-up-collected") {
      if (event.holeId === this.#localPlayerId) {
        const emoji: Record<PowerUpType, string> = {
          magnet: "🧲",
          shrink: "🔍",
          foot: "🦶",
          burger: "🍔",
          poop: "💩",
          doubleFoot: "👣",
          beer: "🍺",
        };
        this.#showAbilityFeedback(
          translate(this.#preferences.language, "itemActivated", {
            emoji: emoji[event.powerUpType],
          }),
          "radius",
          1_400,
        );
      }
      return;
    }
    if (event.holeId !== this.#localPlayerId) {
      return;
    }
    this.#presentLocalSwallow(event.position, event.value, event.type === "player-defeated");
  }

  /**
   * 本地玩家吞噬物体/击败玩家时的瞬时反馈：累计本局吞噬数、播放吞噬音效/震动，
   * 并在物体位置弹出 `+分值` 浮字（击杀转警示色）。host/offline 由 {@link #handleEvent} 触发，
   * guest 由 {@link applyWorldEvent} 触发——三端复用同一份呈现逻辑。
   */
  #presentLocalSwallow(position: Vector2, value: number, isKill: boolean): void {
    this.#playerSwallowCount += 1;
    this.#feedback.swallow();
    this.#scoreWorldPosition.set(position.x, 0.5, position.y).project(this.#camera);
    const popup = document.createElement("span");
    popup.className = `score-pop${isKill ? " is-kill" : ""}`;
    popup.textContent = `+${value}`;
    // 容器是全屏 position:fixed，NDC→screen 用缓存的视口尺寸换算；
    // 不在吞噬热路径里读 clientWidth/getBoundingClientRect，否则连续 appendChild+读尺寸会触发强制布局（reflow）。
    popup.style.left = `${((this.#scoreWorldPosition.x + 1) / 2) * this.#viewportWidth}px`;
    popup.style.top = `${((-this.#scoreWorldPosition.y + 1) / 2) * this.#viewportHeight}px`;
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
    this.#ui.scoreEffects.appendChild(popup);
  }

  /**
   * guest：处理 host 经 reliable channel 广播的离散世界事件，复刻 host/offline 的本地 `+分值` 呈现。
   * guest 不运行模拟循环，吞噬事件只能由 host 广播触发；位置/分值用本地权威快照查表得到，
   * 不依赖事件携带这些可由接收端推导的字段（AGENTS.md §0.1 + webrtc skill 检查单第 5 条）。
   * 只呈现本地玩家自己 credited 的吞噬，与 host/offline 行为一致。
   */
  applyWorldEvent(event: WorldEvent): void {
    if (event.type === "object-consumed") {
      if (!event.creditedPeerIds.includes(this.#localPlayerId)) return;
      const object = this.#state.objects.find((candidate) => candidate.id === event.objectId);
      if (object === undefined) return;
      this.#presentLocalSwallow(object.position, object.value, false);
      return;
    }
    if (event.type === "player-eliminated") {
      if (event.creditedPeerId !== this.#localPlayerId) return;
      const hole = this.#state.holes.find((candidate) => candidate.id === event.peerId);
      if (hole === undefined) return;
      this.#presentLocalSwallow(hole.position, PLAYER_CAPTURE_SCORE, true);
    }
  }

  #createMatchResult(): MatchResult {
    const ranking = [...this.#state.holes]
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (left.kind !== right.kind) return left.kind === "human" ? -1 : 1;
        return left.id.localeCompare(right.id);
      })
      .map((hole) => ({
        id: hole.id,
        name: (this.#playerNames.get(hole.id) ?? hole.id).toUpperCase(),
        score: hole.score,
        isPlayer: hole.id === this.#localPlayerId,
        isOut: hole.isOut,
      }));
    const playerIndex = ranking.findIndex((entry) => entry.isPlayer);
    const playerHole = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    return {
      playerRank: Math.max(1, playerIndex + 1),
      playerScore: ranking[playerIndex]?.score ?? 0,
      ranking,
      swallowCount: this.#playerSwallowCount,
      eliminations: playerHole?.eliminations ?? 0,
      elapsedSeconds: this.#state.elapsed,
      maxRevives: playerHole?.eliminations ?? 0,
    };
  }

  readonly #activateSpeed = (): void => this.#requestAbility("speed");
  readonly #activateRadius = (): void => this.#requestAbility("radius");
  readonly #activateBomb = (): void => this.#requestAbility("bomb");

  readonly #onShortcut = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      return;
    }
    const abilityByCode: Partial<Record<string, AbilityId>> = {
      KeyQ: "speed",
      KeyE: "radius",
      KeyR: "bomb",
    };
    const ability = abilityByCode[event.code];
    if (ability && this.#matchStarted && !event.repeat) {
      event.preventDefault();
      this.#requestAbility(ability);
    }
  };

  #requestAbility(ability: AbilityId): void {
    if (!this.#matchStarted) return;
    const player = this.#state.holes.find((hole) => hole.id === this.#localPlayerId);
    if (!player || player.eliminationRemaining > 0 || player.isOut) return;
    const active =
      ability === "speed"
        ? player.speedBoostRemaining
        : ability === "radius"
          ? player.radiusBoostRemaining
          : player.bombFuseRemaining;
    const cooldown =
      ability === "speed"
        ? player.speedBoostCooldown
        : ability === "radius"
          ? player.radiusBoostCooldown
          : player.bombCooldown;
    if (active > 0 || cooldown > 0) return;
    this.#pendingAbilities.add(ability);
    const label =
      ability === "speed"
        ? translate(this.#preferences.language, "boostOnline")
        : ability === "radius"
          ? translate(this.#preferences.language, "vortexExpanded")
          : translate(this.#preferences.language, "bombArmed");
    this.#showAbilityFeedback(label, ability, ability === "bomb" ? 3_000 : 1_400);
  }

  #showAbilityFeedback(message: string, ability: AbilityId, duration: number): void {
    this.#ui.abilityFeedback.textContent = message;
    this.#ui.abilityFeedback.dataset.ability = ability;
    this.#ui.abilityFeedback.classList.remove("is-visible");
    requestAnimationFrame(() => this.#ui.abilityFeedback.classList.add("is-visible"));
    if (this.#abilityFeedbackTimer !== null) {
      window.clearTimeout(this.#abilityFeedbackTimer);
    }
    this.#abilityFeedbackTimer = window.setTimeout(() => {
      this.#ui.abilityFeedback.classList.remove("is-visible");
      this.#abilityFeedbackTimer = null;
    }, duration);
  }

  readonly #onVisibilityChange = (): void => {
    this.#pageVisible = document.visibilityState !== "hidden";
    if (this.#pageVisible) {
      this.#forceRender = true;
      this.#nextRenderTime = performance.now();
      this.#renderDeltaAccumulator = 0;
      if (this.#matchStarted) {
        this.#renderer.setAnimationLoop(this.#frame);
      } else {
        this.#frame(performance.now());
      }
    } else {
      this.#renderer.setAnimationLoop(null);
      this.#input.reset();
    }
  };

  readonly #resize = (): void => {
    // 移动端浏览器 UI 显隐 / 下拉会连续抛 resize，合并到下一帧只重建一次 drawingbuffer。
    if (this.#resizePending) {
      return;
    }
    this.#resizePending = true;
    requestAnimationFrame(() => {
      this.#resizePending = false;
      this.#applyResize();
      this.#forceRender = true;
    });
  };

  #applyResize(): void {
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    this.#viewportWidth = width;
    this.#viewportHeight = height;
    this.#camera.aspect = width / Math.max(height, 1);
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
    this.#renderer.setPixelRatio(this.#getPixelRatio());
  }

  #getPixelRatio(): number {
    return Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO);
  }
}
