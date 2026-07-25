import {
  BOMB_COOLDOWN_SECONDS,
  INITIAL_HOLE_RADIUS,
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
  getHoleProgress,
  stepSimulation,
  type HoleState,
  type AbilityId,
  type SimulationEvent,
  type SimulationState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";

import type { MatchResult } from "../app/matchResult";
import type { GamePreferences } from "../app/preferences";
import { CityObjectRenderer } from "./CityObjectRenderer";
import { Feedback } from "./Feedback";
import { HoleRenderer } from "./HoleRenderer";
import { InputController } from "./InputController";

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_SECONDS = 0.1;

export interface GameUi {
  score: HTMLElement;
  radius: HTMLElement;
  sizeLevel: HTMLElement;
  growthCopy: HTMLElement;
  growthFill: HTMLElement;
  time: HTMLElement;
  timerRoot: HTMLElement;
  rankingRows: readonly [RankingRowUi, RankingRowUi, RankingRowUi];
  dragPad: HTMLElement;
  dragKnob: HTMLElement;
  loading: HTMLElement;
  loadingBar: HTMLElement;
  loadingStatus: HTMLElement;
  scoreEffects: HTMLElement;
  opponentIndicators: readonly [OpponentIndicatorUi, OpponentIndicatorUi];
  abilityButtons: readonly [AbilityButtonUi, AbilityButtonUi, AbilityButtonUi];
  abilityFeedback: HTMLElement;
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
  readonly #geometries = new Set<THREE.BufferGeometry>();
  readonly #materials = new Set<THREE.Material>();
  readonly #textures = new Set<THREE.Texture>();
  readonly #cameraTarget = new THREE.Vector3();
  readonly #cameraDesired = new THREE.Vector3();
  readonly #cameraOffset = new THREE.Vector3(0, 20, 15);
  readonly #scoreWorldPosition = new THREE.Vector3();
  readonly #opponentDelta = new THREE.Vector3();
  readonly #cameraForward = new THREE.Vector3();
  readonly #cameraRight = new THREE.Vector3();
  readonly #worldUp = new THREE.Vector3(0, 1, 0);
  #state: SimulationState;
  #lastTime = 0;
  #accumulator = 0;
  #hudAccumulator = 0;
  #matchStarted = false;
  #pageVisible = document.visibilityState !== "hidden";
  #sceneDirty = true;
  readonly #preferences: GamePreferences;
  readonly #onMatchEnd: (result: MatchResult) => void;
  readonly #pendingAbilities = new Set<AbilityId>();
  #abilityFeedbackTimer: number | null = null;
  #lastBombFuseRemaining = 0;
  #playerSwallowCount = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    ui: GameUi,
    preferences: GamePreferences,
    initialState: SimulationState,
    onMatchEnd: (result: MatchResult) => void,
  ) {
    this.#canvas = canvas;
    this.#ui = ui;
    this.#preferences = preferences;
    this.#onMatchEnd = onMatchEnd;
    this.#state = initialState;
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: true,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.autoClear = false;
    this.#input = new InputController(canvas, ui.dragPad, ui.dragKnob);
    this.#cityObjects = new CityObjectRenderer(this.#scene);
    this.#holeRenderer = new HoleRenderer(this.#scene, preferences);
    this.#buildScene();
    this.#holeRenderer.build(initialState.holes);
    this.#resize();
    this.#syncScene(1);
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
  ): Promise<Game> {
    const mapSeed = 0x5eed1234;
    const spawnSeed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    const game = new Game(
      canvas,
      ui,
      preferences,
      createInitialSimulation(mapSeed, spawnSeed),
      onMatchEnd,
    );
    try {
      await game.#cityObjects.initialize(game.#state.objects, (loaded, total) => {
        const progress = total === 0 ? 1 : loaded / total;
        ui.loadingBar.style.transform = `scaleX(${progress})`;
        ui.loadingStatus.textContent = `${loaded.toString().padStart(2, "0")} / ${total
          .toString()
          .padStart(2, "0")}`;
      });
    } catch (error: unknown) {
      game.dispose();
      throw error;
    }
    ui.loading.hidden = true;
    game.#cityObjects.sync(game.#state.objects);
    return game;
  }

  start(): void {
    this.#feedback.activate();
    this.#matchStarted = true;
    this.#lastTime = performance.now();
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
    this.#input.dispose();
    this.#feedback.dispose();
    this.#cityObjects.dispose();
    this.#holeRenderer.dispose();
    this.#geometries.forEach((geometry) => geometry.dispose());
    this.#materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#renderer.dispose();
  }

  readonly #frame = (time: number): void => {
    if (!this.#pageVisible) {
      return;
    }
    const frameSeconds = Math.min((time - this.#lastTime) / 1000, MAX_FRAME_SECONDS);
    this.#lastTime = time;
    this.#accumulator += frameSeconds;
    this.#hudAccumulator += frameSeconds;

    while (this.#matchStarted && this.#accumulator >= FIXED_STEP_SECONDS) {
      const result = stepSimulation(
        this.#state,
        [
          {
            playerId: "player",
            direction: this.#input.getDirection(),
            abilities: [...this.#pendingAbilities],
          },
        ],
        FIXED_STEP_SECONDS,
      );
      this.#pendingAbilities.clear();
      this.#state = result.state;
      result.events.forEach((event) => this.#handleEvent(event));
      this.#accumulator -= FIXED_STEP_SECONDS;
    }
    if (!this.#matchStarted) {
      this.#accumulator = 0;
    }

    if (this.#hudAccumulator >= 0.08 || this.#state.status === "finished") {
      this.#updateHud();
      this.#hudAccumulator = 0;
    }
    if (this.#matchStarted || this.#sceneDirty) {
      this.#syncScene(frameSeconds);
      this.#sceneDirty = false;
    }
    this.#renderer.clear(true, true, true);
    this.#renderer.render(this.#scene, this.#camera);
    if (this.#state.status === "finished" && this.#matchStarted) {
      this.#matchStarted = false;
      this.#renderer.setAnimationLoop(null);
      this.#onMatchEnd(this.#createMatchResult());
    }
  };

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
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.renderOrder = -11;
    this.#geometries.add(geometry);
    this.#scene.add(mesh);
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

  #syncScene(deltaSeconds: number): void {
    const leader = [...this.#state.holes]
      .filter((hole) => !hole.isOut && hole.eliminationRemaining <= 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.kind === "human" ? -1 : 1;
      })[0];
    this.#holeRenderer.sync(this.#state.holes, this.#state.elapsed, deltaSeconds, leader?.id);

    const player = this.#state.holes.find((hole) => hole.id === "player");
    if (!player) {
      this.#cityObjects.sync(this.#state.objects, deltaSeconds);
      return;
    }
    this.#cameraTarget.set(player.position.x, 0, player.position.y);
    const radiusRatio = player.radius / INITIAL_HOLE_RADIUS;
    const zoomScale = 1 + Math.max(0, radiusRatio - 1) * 0.5;
    this.#cameraOffset.set(0, 20.5 * zoomScale, 15 * zoomScale);
    this.#cameraDesired.copy(this.#cameraTarget).add(this.#cameraOffset);
    const followAlpha = 1 - Math.exp(-5.5 * deltaSeconds);
    this.#camera.position.lerp(this.#cameraDesired, followAlpha);
    this.#camera.lookAt(this.#cameraTarget);
    this.#camera.updateMatrixWorld();
    this.#cityObjects.sync(this.#state.objects, deltaSeconds, {
      player,
      cameraPosition: this.#camera.position,
    });
    this.#updateOpponentIndicators(player);
  }

  #updateOpponentIndicators(player: HoleState): void {
    const bots = this.#state.holes.filter((hole) => hole.kind === "bot");
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
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
      const bot = bots[index];
      if (!bot || bot.eliminationRemaining > 0 || bot.isOut) {
        indicator.root.hidden = true;
        return;
      }
      indicator.root.hidden = false;
      this.#opponentDelta.set(
        bot.position.x - player.position.x,
        0,
        bot.position.y - player.position.y,
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
        Math.hypot(bot.position.x - player.position.x, bot.position.y - player.position.y),
      )}m`;
    });
  }

  #updateHud(): void {
    const player = this.#state.holes.find((hole) => hole.id === "player");
    if (!player) {
      return;
    }
    const progress = getHoleProgress(player.score);
    this.#ui.score.textContent = player.score.toString().padStart(5, "0");
    this.#ui.radius.textContent = player.radius.toFixed(2);
    this.#ui.sizeLevel.textContent = (progress.level + 1).toString().padStart(2, "0");
    this.#ui.growthFill.style.transform = `scaleX(${progress.progress})`;
    this.#ui.growthCopy.textContent = progress.nextScore
      ? `${progress.nextScore - player.score} TO NEXT SIZE`
      : "MAX SIZE";
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
  }

  #updateAbilityHud(player: HoleState): void {
    if (
      this.#lastBombFuseRemaining > 0 &&
      player.bombFuseRemaining === 0 &&
      player.bombCooldown > 0
    ) {
      this.#showAbilityFeedback("IMPACT DETONATED", "bomb", 1_600);
    }
    this.#lastBombFuseRemaining = player.bombFuseRemaining;
    const abilities: readonly [AbilityId, number, number, number, string][] = [
      [
        "speed",
        player.speedBoostRemaining,
        player.speedBoostCooldown,
        SPEED_BOOST_COOLDOWN_SECONDS,
        "READY",
      ],
      [
        "radius",
        player.radiusBoostRemaining,
        player.radiusBoostCooldown,
        RADIUS_BOOST_COOLDOWN_SECONDS,
        "READY",
      ],
      ["bomb", player.bombFuseRemaining, player.bombCooldown, BOMB_COOLDOWN_SECONDS, "READY"],
    ];
    this.#ui.abilityButtons.forEach((button, index) => {
      const entry = abilities[index];
      if (!entry) return;
      const [, active, cooldown, maxCooldown, readyCopy] = entry;
      const locked = active > 0 || cooldown > 0;
      button.root.disabled = locked;
      button.root.classList.toggle("is-active", active > 0);
      button.root.classList.toggle("is-cooldown", locked && active <= 0);
      const progress = cooldown / maxCooldown;
      button.root.style.setProperty("--ability-progress", `${Math.max(0, Math.min(1, progress))}`);
      button.cooldown.textContent =
        active > 0 ? `${active.toFixed(1)}s` : cooldown > 0 ? `${Math.ceil(cooldown)}s` : "";
      button.status.textContent =
        active > 0
          ? entry[0] === "bomb"
            ? "FUSE"
            : "ACTIVE"
          : cooldown > 0
            ? "RECHARGE"
            : readyCopy;
    });
  }

  #writeRankingRows(
    rows: readonly [RankingRowUi, RankingRowUi, RankingRowUi],
    rankableHoles: readonly HoleState[],
  ): void {
    rows.forEach((row, index) => {
      const hole = rankableHoles[index];
      if (!hole) {
        return;
      }
      row.position.textContent = (index + 1).toString();
      const displayName =
        hole.kind === "human"
          ? this.#preferences.playerName
          : `BOT ${hole.id.slice(4).padStart(2, "0")}`;
      const holeProgress = getHoleProgress(hole.score);
      row.avatar.textContent = displayName.charAt(0).toUpperCase() || "·";
      row.name.textContent = displayName.toUpperCase();
      row.meta.textContent = hole.isOut
        ? `Lv.${holeProgress.level + 1} · 出局`
        : `Lv.${holeProgress.level + 1} · R${hole.radius.toFixed(1)}`;
      row.score.textContent = hole.score.toString();
      row.root.classList.toggle("is-player", hole.kind === "human");
      row.root.classList.toggle("is-bot-one", hole.id === "bot-1");
      row.root.classList.toggle("is-bot-two", hole.id === "bot-2");
      row.root.classList.toggle("is-eliminated", hole.eliminationRemaining > 0 || hole.isOut);
      row.root.classList.toggle("is-out", hole.isOut);
      row.root.classList.toggle("was-eliminated", hole.eliminations > 0);
      row.root.dataset.eliminations = hole.eliminations.toString();
    });
  }

  #handleEvent(event: SimulationEvent): void {
    if (event.holeId !== "player") {
      return;
    }
    this.#playerSwallowCount += 1;
    this.#feedback.swallow();
    this.#scoreWorldPosition.set(event.position.x, 0.5, event.position.y).project(this.#camera);
    const rect = this.#canvas.getBoundingClientRect();
    const popup = document.createElement("span");
    // 大分值（吞噬玩家所得 max(12, loser×0.6)）按击杀样式高亮，纯前端启发式。
    popup.className = `score-pop${event.value > 50 ? " is-kill" : ""}`;
    popup.textContent = `+${event.value}`;
    popup.style.left = `${((this.#scoreWorldPosition.x + 1) / 2) * rect.width}px`;
    popup.style.top = `${((-this.#scoreWorldPosition.y + 1) / 2) * rect.height}px`;
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
    this.#ui.scoreEffects.appendChild(popup);
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
        name:
          hole.kind === "human"
            ? this.#preferences.playerName.toUpperCase()
            : `BOT ${hole.id.slice(4).padStart(2, "0")}`,
        score: hole.score,
        isPlayer: hole.kind === "human",
        isOut: hole.isOut,
      }));
    const playerIndex = ranking.findIndex((entry) => entry.isPlayer);
    const playerHole = this.#state.holes.find((hole) => hole.id === "player");
    return {
      playerRank: Math.max(1, playerIndex + 1),
      playerScore: ranking[playerIndex]?.score ?? 0,
      ranking,
      swallowCount: this.#playerSwallowCount,
      eliminations: playerHole?.eliminations ?? 0,
      elapsedSeconds: this.#state.elapsed,
      maxRevives: 1,
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
    const player = this.#state.holes.find((hole) => hole.id === "player");
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
        ? "BOOST ONLINE"
        : ability === "radius"
          ? "VORTEX EXPANDED"
          : "BOMB ARMED · 3 SEC";
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
      this.#lastTime = performance.now();
      this.#sceneDirty = true;
      if (this.#matchStarted) {
        this.#renderer.setAnimationLoop(this.#frame);
      } else {
        this.#frame(this.#lastTime);
      }
    } else {
      this.#renderer.setAnimationLoop(null);
      this.#input.reset();
    }
  };

  readonly #resize = (): void => {
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    this.#camera.aspect = width / Math.max(height, 1);
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height, false);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  };
}
