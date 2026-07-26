// 联机对局驱动：把 WebRTC DataChannel（经 MultiplayerSession）与 Game 桥接。
// host：发 match-start、建 host 权威 Game、~10Hz 广播增量快照、reliable 广播 WorldEvent、
//       收 guest InputPacket 喂循环、响应 resync 发分块 checkpoint。
// guest：收 match-start 建 guest Game、~30Hz 上报 InputPacket、收增量快照 applyDelta、
//        revision 不连续时发 resync-request、收 checkpoint 分块原子恢复。
// 严格遵守 AGENTS.md §0.1：guest 永不本地模拟，只渲染 host 快照。
import {
  createMultiplayerSimulation,
  type AbilityId,
  type SimulationState,
  type Vector2,
} from "@hole-io/shared/simulation";
import {
  MULTIPLAYER_MAP_ID,
  MULTIPLAYER_MAP_REVISION,
  assembleCheckpointChunks,
  serializeCheckpoint,
  splitCheckpointIntoChunks,
  tryCompleteCheckpoint,
  type CheckpointChunk,
  type GameEvent,
  type InputPacket,
  type PlayerAssignment,
  type StateDeltaSnapshot,
} from "@hole-io/shared/protocol";
import * as THREE from "three";

import type { MatchResult } from "../app/matchResult";
import type { GamePreferences } from "../app/preferences";
import { Game, type GameConfig, type GameUi } from "../game/Game";
import { multiplayerStore } from "../store/multiplayerStore";
import { decodeGameData, encodeGameData, type GameDataMessage } from "./dataChannel";
import type { GameChannelKind } from "./starConnection";
import type { MultiplayerSession } from "./multiplayerSession";
import { SnapshotInterpolator } from "./snapshotInterp";

const MAP_SEED = 0x5eed1234;
const MATCH_DURATION_SECONDS = 180;

export interface OnlineGameDriverOptions {
  session: MultiplayerSession;
  canvas: HTMLCanvasElement;
  ui: GameUi;
  preferences: GamePreferences;
  onMatchEnd: (result: MatchResult) => void;
  onPoopHit: (playerCount: number) => void;
}

interface MatchConfig {
  matchId: string;
  seed: number;
  players: readonly PlayerAssignment[];
}

export class OnlineGameDriver {
  readonly #opts: OnlineGameDriverOptions;
  #game: Game | null = null;
  readonly #interp = new SnapshotInterpolator();
  #matchConfig: MatchConfig | null = null;
  #initialState: SimulationState | null = null;
  readonly #checkpointPending = new Map<string, readonly CheckpointChunk[]>();
  #disposed = false;
  #inputSeq = 0;
  #resyncInFlight = false;

  constructor(opts: OnlineGameDriverOptions) {
    this.#opts = opts;
  }

  get game(): Game | null {
    return this.#game;
  }

  async start(): Promise<void> {
    this.#opts.session.setGameMessageHandler((peerId, channel, data) => {
      this.#handleMessage(peerId, channel, data);
    });
    if (this.#opts.session.isHost) {
      await this.#startHost();
    }
    // guest：等待 reliable match-start，到达后在 #handleMessage 内建游戏。
  }

  dispose(): void {
    this.#disposed = true;
    this.#opts.session.setGameMessageHandler(null);
    this.#game?.dispose();
    this.#game = null;
  }

  async #startHost(): Promise<void> {
    const state = multiplayerStore.getState();
    const matchId = state.matchId;
    const room = state.room;
    if (matchId === null || room === null) {
      throw new Error("host 启动缺少 matchId/room");
    }
    const players = this.#buildPlayerAssignments(room);
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    this.#matchConfig = { matchId, seed, players };
    this.#initialState = createMultiplayerSimulation(
      MAP_SEED,
      seed,
      players.map((p) => p.peerId),
    );
    const matchStart: GameEvent = {
      type: "match-start",
      matchId,
      seed,
      mapId: MULTIPLAYER_MAP_ID,
      mapRevision: MULTIPLAYER_MAP_REVISION,
      matchDurationSeconds: MATCH_DURATION_SECONDS,
      players,
    };
    this.#sendToAllPeers("reliable", matchStart);
    await this.#instantiateGame("host");
  }

  async #onGuestMatchStart(message: Extract<GameEvent, { type: "match-start" }>): Promise<void> {
    if (this.#opts.session.isHost || this.#game !== null || this.#matchConfig !== null) return;
    this.#matchConfig = { matchId: message.matchId, seed: message.seed, players: message.players };
    this.#initialState = createMultiplayerSimulation(
      MAP_SEED,
      message.seed,
      message.players.map((p) => p.peerId),
    );
    await this.#instantiateGame("guest");
  }

  async #instantiateGame(mode: "host" | "guest"): Promise<void> {
    if (this.#matchConfig === null || this.#initialState === null) {
      throw new Error("缺少 matchConfig/initialState");
    }
    const localPeerId = multiplayerStore.getState().peerId;
    if (localPeerId === null) throw new Error("缺少本地 peerId");
    const playerNames = new Map(this.#matchConfig.players.map((p) => [p.peerId, p.playerName]));
    const playerColors = new Map<string, THREE.ColorRepresentation>();
    const room = multiplayerStore.getState().room;
    if (room !== null) {
      for (const peer of room.peers) playerColors.set(peer.peerId, peer.profile.color);
    }
    const config: GameConfig = {
      canvas: this.#opts.canvas,
      ui: this.#opts.ui,
      preferences: this.#opts.preferences,
      initialState: this.#initialState,
      localPlayerId: localPeerId,
      mode,
      playerNames,
      playerColors,
      matchId: this.#matchConfig.matchId,
      onMatchEnd: (result) => this.#opts.onMatchEnd(result),
      onPoopHit: this.#opts.onPoopHit,
      onBroadcastSnapshot:
        mode === "host" ? (delta) => this.#sendToAllPeers("unreliable", delta) : undefined,
      onWorldEvents:
        mode === "host"
          ? (events) => {
              for (const event of events) this.#sendToAllPeers("reliable", event);
            }
          : undefined,
      onSendLocalInput:
        mode === "guest"
          ? (direction, abilities) => this.#sendInput(direction, abilities)
          : undefined,
    };
    const game = await Game.createOnline(config);
    if (this.#disposed) {
      game.dispose();
      return;
    }
    this.#game = game;
    game.start();
  }

  #buildPlayerAssignments(
    room: NonNullable<ReturnType<typeof multiplayerStore.getState>["room"]>,
  ): readonly PlayerAssignment[] {
    return [...room.peers]
      .filter((peer) => peer.entered)
      .sort((a, b) => a.peerId.localeCompare(b.peerId))
      .map((peer, index) => ({
        peerId: peer.peerId,
        playerName: peer.profile.playerName,
        holeIndex: index,
      }));
  }

  // ---- DataChannel 收消息分发 ----
  #handleMessage(peerId: string, channel: GameChannelKind, data: string): void {
    void channel;
    const message = decodeGameData(data);
    if (message === null) return;
    if (!this.#isRelevant(message)) return;
    switch (message.type) {
      case "input":
        if (this.#opts.session.isHost) {
          this.#game?.setRemoteInput(
            peerId,
            message.direction,
            message.abilities ?? [],
            message.seq,
          );
        }
        return;
      case "state-delta":
        if (!this.#opts.session.isHost) this.#onDelta(message);
        return;
      case "match-start":
        if (!this.#opts.session.isHost) void this.#onGuestMatchStart(message);
        return;
      case "resync-request":
        if (this.#opts.session.isHost) this.#onResyncRequest(peerId, message);
        return;
      case "checkpoint-chunk":
        if (!this.#opts.session.isHost) this.#onCheckpointChunk(message);
        return;
      case "match-end":
      case "object-consumed":
      case "player-eliminated":
      case "player-revived":
      case "power-up-changed":
        return; // v1：guest 的世界信息已由增量快照承载，离散事件不单独处理
    }
  }

  #isRelevant(message: GameDataMessage): boolean {
    if (this.#matchConfig === null) {
      // 建游戏前只接受 match-start（任意 matchId，本机尚未确立 config）
      return message.type === "match-start";
    }
    if (message.type === "match-start") return false;
    return message.matchId === this.#matchConfig.matchId;
  }

  #onDelta(delta: StateDeltaSnapshot): void {
    const game = this.#game;
    if (game === null) return;
    const latest = this.#interp.push(delta);
    if (latest === null) return;
    if (latest.baseWorldRevision !== game.localWorldRevision) {
      this.#requestResync(game.localWorldRevision, latest);
      return;
    }
    game.applyDelta(latest);
  }

  #requestResync(localRevision: number, delta: StateDeltaSnapshot): void {
    if (this.#resyncInFlight || this.#matchConfig === null) return;
    this.#resyncInFlight = true;
    const request: GameEvent = {
      type: "resync-request",
      matchId: this.#matchConfig.matchId,
      expectedWorldRevision: localRevision,
      receivedBaseWorldRevision: delta.baseWorldRevision,
      lastSnapshotSeq: delta.snapshotSeq,
    };
    this.#sendToAllPeers("reliable", request);
  }

  #sendInput(direction: Vector2, abilities: readonly AbilityId[]): void {
    if (this.#matchConfig === null) return;
    this.#inputSeq += 1;
    const packet: InputPacket = {
      type: "input",
      matchId: this.#matchConfig.matchId,
      seq: this.#inputSeq,
      direction,
      clientTime: Date.now(),
      abilities,
    };
    this.#sendToAllPeers("unreliable", packet);
  }

  #onResyncRequest(peerId: string, request: Extract<GameEvent, { type: "resync-request" }>): void {
    void request;
    const game = this.#game;
    if (game === null || this.#matchConfig === null) return;
    const checkpoint = game.buildCheckpoint(
      `${this.#matchConfig.matchId}-${request.lastSnapshotSeq}`,
    );
    if (checkpoint === null) return;
    const payload = serializeCheckpoint(checkpoint);
    const chunks = splitCheckpointIntoChunks({
      matchId: checkpoint.matchId,
      checkpointId: checkpoint.checkpointId,
      payload,
    });
    const encoded = chunks.map((chunk) => encodeGameData(chunk));
    for (const data of encoded) this.#opts.session.sendGameData(peerId, "reliable", data);
  }

  #onCheckpointChunk(chunk: CheckpointChunk): void {
    const existing = this.#checkpointPending.get(chunk.checkpointId) ?? [];
    const merged =
      assembleCheckpointChunks(
        new Map([[chunk.checkpointId, existing]]),
        new Map([[chunk.checkpointId, [chunk]]]),
      ).get(chunk.checkpointId) ?? [];
    const next = [...merged];
    this.#checkpointPending.set(chunk.checkpointId, next);
    const complete = tryCompleteCheckpoint(next);
    if (complete === null) return;
    this.#checkpointPending.delete(complete.checkpointId);
    this.#resyncInFlight = false;
    this.#interp.reset();
    this.#game?.applyCheckpoint(complete);
  }

  /** host 广播给所有已连 guest；guest 发给 host（getGamePeerIds 在两端都返回对端列表）。 */
  #sendToAllPeers(channel: GameChannelKind, message: GameDataMessage): void {
    const data = encodeGameData(message);
    for (const peerId of this.#opts.session.getGamePeerIds()) {
      this.#opts.session.sendGameData(peerId, channel, data);
    }
  }
}
