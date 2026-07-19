import {
  MAP_HALF_SIZE,
  INITIAL_HOLE_RADIUS,
  ROAD_CENTERS,
  ROAD_WIDTH,
  SIDEWALK_WIDTH,
  createInitialSimulation,
  getHoleProgress,
  stepSimulation,
  type HoleState,
  type AbilityId,
  type SimulationEvent,
  type SimulationState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";

import { CityObjectRenderer } from "./CityObjectRenderer";
import { Feedback } from "./Feedback";
import { InputController } from "./InputController";

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_SECONDS = 0.1;

interface HoleVisual {
  group: THREE.Group;
  progressMesh: THREE.Mesh;
  crown: THREE.Sprite;
  shaft: THREE.Mesh;
  depth: THREE.Mesh;
  ringMaterials: readonly [THREE.MeshBasicMaterial];
  progressValue: number;
  speedRing: THREE.Mesh;
  radiusRing: THREE.Mesh;
  bombRing: THREE.Mesh;
}

export interface GamePreferences {
  playerName: string;
  playerRingColor: string;
}

export interface GameUi {
  score: HTMLElement;
  radius: HTMLElement;
  sizeLevel: HTMLElement;
  growthCopy: HTMLElement;
  growthFill: HTMLElement;
  time: HTMLElement;
  rankingRows: readonly [RankingRowUi, RankingRowUi, RankingRowUi];
  finalRank: HTMLElement;
  finalRankingRows: readonly [RankingRowUi, RankingRowUi, RankingRowUi];
  dragPad: HTMLElement;
  dragKnob: HTMLElement;
  gameOver: HTMLElement;
  finalScore: HTMLElement;
  restart: HTMLButtonElement;
  returnHomeMatch: HTMLButtonElement;
  returnHomeResults: HTMLButtonElement;
  loading: HTMLElement;
  loadingBar: HTMLElement;
  loadingStatus: HTMLElement;
  launchScreen: HTMLElement;
  startMatch: HTMLButtonElement;
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
  name: HTMLElement;
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
  readonly #holeVisuals = new Map<string, HoleVisual>();
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
  #preferences: GamePreferences;
  readonly #pendingAbilities = new Set<AbilityId>();
  #abilityFeedbackTimer: number | null = null;
  #lastBombFuseRemaining = 0;

  private constructor(
    canvas: HTMLCanvasElement,
    ui: GameUi,
    preferences: GamePreferences,
    initialState: SimulationState,
  ) {
    this.#canvas = canvas;
    this.#ui = ui;
    this.#preferences = preferences;
    this.#state = initialState;
    this.#renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      stencil: true,
    });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.autoClear = false;
    this.#input = new InputController(canvas, ui.dragPad, ui.dragKnob);
    this.#cityObjects = new CityObjectRenderer(this.#scene);
    this.#buildScene();
    this.#buildHoleVisuals();
    this.#resize();
    this.#syncScene(1);
    this.#updateHud();
    window.addEventListener("resize", this.#resize);
    window.addEventListener("keydown", this.#onShortcut);
    ui.restart.addEventListener("click", this.#restart);
    ui.returnHomeMatch.addEventListener("click", this.#returnHome);
    ui.returnHomeResults.addEventListener("click", this.#returnHome);
    ui.startMatch.addEventListener("click", this.#startMatch);
    ui.abilityButtons[0].root.addEventListener("click", () => this.#requestAbility("speed"));
    ui.abilityButtons[1].root.addEventListener("click", () => this.#requestAbility("radius"));
    ui.abilityButtons[2].root.addEventListener("click", () => this.#requestAbility("bomb"));
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
  }

  static async create(
    canvas: HTMLCanvasElement,
    ui: GameUi,
    preferences: GamePreferences,
  ): Promise<Game> {
    const mapSeed = 0x5eed1234;
    const spawnSeed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    const game = new Game(canvas, ui, preferences, createInitialSimulation(mapSeed, spawnSeed));
    await game.#cityObjects.initialize(game.#state.objects, (loaded, total) => {
      const progress = total === 0 ? 1 : loaded / total;
      ui.loadingBar.style.transform = `scaleX(${progress})`;
      ui.loadingStatus.textContent = `${loaded.toString().padStart(2, "0")} / ${total
        .toString()
        .padStart(2, "0")}`;
    });
    ui.loading.hidden = true;
    game.#cityObjects.sync(game.#state.objects);
    return game;
  }

  start(): void {
    this.#lastTime = performance.now();
    this.#frame(this.#lastTime);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    if (this.#abilityFeedbackTimer !== null) {
      window.clearTimeout(this.#abilityFeedbackTimer);
    }
    window.removeEventListener("resize", this.#resize);
    window.removeEventListener("keydown", this.#onShortcut);
    this.#ui.restart.removeEventListener("click", this.#restart);
    this.#ui.returnHomeMatch.removeEventListener("click", this.#returnHome);
    this.#ui.returnHomeResults.removeEventListener("click", this.#returnHome);
    this.#ui.startMatch.removeEventListener("click", this.#startMatch);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#input.dispose();
    this.#feedback.dispose();
    this.#cityObjects.dispose();
    this.#geometries.forEach((geometry) => geometry.dispose());
    this.#materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#renderer.dispose();
  }

  setPreferences(preferences: GamePreferences): void {
    this.#preferences = preferences;
    const visual = this.#holeVisuals.get("player");
    if (visual) {
      const color = new THREE.Color(preferences.playerRingColor);
      visual.ringMaterials.forEach((material) => material.color.copy(color));
    }
    this.#updateHud();
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
    }
  };

  #buildScene(): void {
    this.#scene.background = new THREE.Color(0x91b5bf);
    this.#scene.fog = new THREE.Fog(0x91b5bf, 240, 480);
    this.#scene.add(new THREE.HemisphereLight(0xe8f7f4, 0x435646, 2.15));

    const grass = this.#createGroundMaterial(0x6f9d69);
    this.#addGroundPlane(MAP_HALF_SIZE * 2, MAP_HALF_SIZE * 2, 0, 0, 0, grass);

    const sidewalk = this.#createGroundMaterial(0xc9c5b7);
    const asphalt = this.#createGroundMaterial(0x30383c);
    const lane = this.#createGroundMaterial(0xe8d87c, true);
    const crosswalk = this.#createGroundMaterial(0xece9dc, true);
    const roadAndSidewalkWidth = ROAD_WIDTH + SIDEWALK_WIDTH * 2;
    for (const center of ROAD_CENTERS) {
      this.#addGroundPlane(MAP_HALF_SIZE * 2, roadAndSidewalkWidth, 0, center, 0.03, sidewalk);
      this.#addGroundPlane(MAP_HALF_SIZE * 2, ROAD_WIDTH, 0, center, 0.06, asphalt);
      this.#addVerticalRoadSegments(center, roadAndSidewalkWidth, sidewalk, 0.02);
      this.#addVerticalRoadSegments(center, ROAD_WIDTH, asphalt, 0.05);
    }
    this.#addRoadMarkings(lane, crosswalk);

    this.#camera.position.copy(this.#cameraOffset);
    this.#camera.lookAt(0, 0, 0);
  }

  #buildHoleVisuals(): void {
    for (const hole of this.#state.holes) {
      const visual = this.#createHoleVisual(hole);
      this.#holeVisuals.set(hole.id, visual);
      this.#scene.add(visual.group);
    }
  }

  #createHoleVisual(hole: HoleState): HoleVisual {
    const group = new THREE.Group();
    const maskGeometry = new THREE.CircleGeometry(1, 96);
    const maskMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    maskMaterial.stencilWrite = true;
    maskMaterial.stencilRef = 1;
    maskMaterial.stencilFunc = THREE.AlwaysStencilFunc;
    maskMaterial.stencilZPass = THREE.ReplaceStencilOp;
    maskMaterial.depthTest = false;
    const mask = new THREE.Mesh(maskGeometry, maskMaterial);
    mask.rotation.x = -Math.PI / 2;
    mask.position.y = 0.001;
    mask.renderOrder = -12;
    group.add(mask);

    const shaftGeometry = new THREE.CylinderGeometry(1, 1, 6.8, 96, 1, true);
    const shaftMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.82,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.position.y = -3.4;
    shaft.renderOrder = -8;
    group.add(shaft);

    const depthGeometry = new THREE.CircleGeometry(1, 96);
    const depthMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      depthTest: true,
    });
    const depth = new THREE.Mesh(depthGeometry, depthMaterial);
    depth.rotation.x = -Math.PI / 2;
    depth.position.y = -6.8;
    depth.renderOrder = -9;
    group.add(depth);

    const color =
      hole.kind === "human"
        ? this.#preferences.playerRingColor
        : hole.id === "bot-1"
          ? 0xff6b4a
          : 0xffd447;
    const progressGeometry = new THREE.RingGeometry(1.06, 1.19, 96, 1, -Math.PI / 2, 0.001);
    const progressMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const progressMesh = new THREE.Mesh(progressGeometry, progressMaterial);
    progressMesh.rotation.x = -Math.PI / 2;
    progressMesh.position.y = 0.006;
    progressMesh.renderOrder = 4;
    group.add(progressMesh);

    const createAbilityRing = (color: number, inner: number, outer: number): THREE.Mesh => {
      const geometry = new THREE.RingGeometry(inner, outer, 96);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      ring.visible = false;
      ring.renderOrder = 5;
      group.add(ring);
      this.#geometries.add(geometry);
      this.#materials.add(material);
      return ring;
    };
    const speedRing = createAbilityRing(0x7ce7ff, 1.28, 1.34);
    const radiusRing = createAbilityRing(0xc5a7ff, 1.4, 1.47);
    const bombRing = createAbilityRing(0xff5b57, 1.52, 1.62);

    [maskGeometry, shaftGeometry, depthGeometry, progressGeometry].forEach((geometry) =>
      this.#geometries.add(geometry),
    );
    [maskMaterial, shaftMaterial, depthMaterial, progressMaterial].forEach((material) =>
      this.#materials.add(material),
    );
    const crown = this.#createCrown();
    group.add(crown);
    return {
      group,
      progressMesh,
      crown,
      shaft,
      depth,
      ringMaterials: [progressMaterial],
      progressValue: -1,
      speedRing,
      radiusRing,
      bombRing,
    };
  }

  #createCrown(): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = "176px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("👑", 128, 126);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const crown = new THREE.Sprite(material);
    crown.position.y = 0.9;
    crown.scale.setScalar(0.95);
    crown.renderOrder = 6;
    crown.visible = false;
    this.#textures.add(texture);
    this.#materials.add(material);
    return crown;
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
    const edge = MAP_HALF_SIZE;
    const crossings = [-edge, ...ROAD_CENTERS, edge];
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

  #addRoadMarkings(laneMaterial: THREE.Material, crosswalkMaterial: THREE.Material): void {
    const verticalDashes: THREE.Vector3[] = [];
    const horizontalDashes: THREE.Vector3[] = [];
    for (const center of ROAD_CENTERS) {
      for (let along = -MAP_HALF_SIZE + 3; along <= MAP_HALF_SIZE - 3; along += 7) {
        const insideIntersection = ROAD_CENTERS.some(
          (intersection) => Math.abs(along - intersection) < ROAD_WIDTH / 2 + 3,
        );
        if (!insideIntersection) {
          verticalDashes.push(new THREE.Vector3(center, 0.09, along));
          horizontalDashes.push(new THREE.Vector3(along, 0.095, center));
        }
      }
    }
    this.#addGroundInstances(0.14, 3.2, verticalDashes, laneMaterial);
    this.#addGroundInstances(3.2, 0.14, horizontalDashes, laneMaterial);

    const verticalCrosswalks: THREE.Vector3[] = [];
    const horizontalCrosswalks: THREE.Vector3[] = [];
    for (const intersectionX of ROAD_CENTERS) {
      for (const intersectionZ of ROAD_CENTERS) {
        for (const side of [-1, 1]) {
          for (let stripe = -2.5; stripe <= 2.5; stripe += 1) {
            verticalCrosswalks.push(
              new THREE.Vector3(
                intersectionX,
                0.11,
                intersectionZ + side * (ROAD_WIDTH / 2 + 1.15) + stripe * 0.4,
              ),
            );
            horizontalCrosswalks.push(
              new THREE.Vector3(
                intersectionX + side * (ROAD_WIDTH / 2 + 1.15) + stripe * 0.4,
                0.115,
                intersectionZ,
              ),
            );
          }
        }
      }
    }
    this.#addGroundInstances(5.6, 0.24, verticalCrosswalks, crosswalkMaterial);
    this.#addGroundInstances(0.24, 5.6, horizontalCrosswalks, crosswalkMaterial);
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
    for (const hole of this.#state.holes) {
      const visual = this.#holeVisuals.get(hole.id);
      if (!visual) {
        continue;
      }
      visual.group.visible = hole.eliminationRemaining <= 0 && !hole.isOut;
      if (!visual.group.visible) {
        continue;
      }
      visual.ringMaterials[0].opacity = hole.invulnerabilityRemaining > 0 ? 1 : 0.9;
      visual.group.position.set(hole.position.x, 0, hole.position.y);
      visual.group.scale.set(hole.radius, 1, hole.radius);
      const isPlayer = hole.id === "player";
      visual.speedRing.visible = isPlayer && hole.speedBoostRemaining > 0;
      visual.radiusRing.visible = isPlayer && hole.radiusBoostRemaining > 0;
      visual.bombRing.visible = isPlayer && hole.bombFuseRemaining > 0;
      visual.speedRing.scale.setScalar(1.08 + Math.sin(this.#state.elapsed * 12) * 0.035);
      visual.radiusRing.scale.setScalar(1.2 + Math.sin(this.#state.elapsed * 7) * 0.05);
      visual.bombRing.scale.setScalar(1.15 + Math.sin(this.#state.elapsed * 18) * 0.1);
      visual.crown.visible = leader?.id === hole.id;
      visual.crown.position.y = 0.75 + hole.radius * 0.18;
      visual.crown.scale.set(0.95, 0.95 * hole.radius, 0.95);
      visual.shaft.scale.y = hole.radius;
      visual.shaft.position.y = -3.4 * hole.radius;
      visual.depth.position.y = -6.8 * hole.radius;
      const holeProgress = getHoleProgress(hole.score);
      const progress = holeProgress.progress;
      if (Math.abs(progress - visual.progressValue) >= 0.005) {
        const oldGeometry = visual.progressMesh.geometry;
        const geometry = new THREE.RingGeometry(
          1.06,
          1.19,
          96,
          1,
          -Math.PI / 2,
          Math.max(0.001, progress * Math.PI * 2),
        );
        visual.progressMesh.geometry = geometry;
        this.#geometries.delete(oldGeometry);
        oldGeometry.dispose();
        this.#geometries.add(geometry);
        visual.progressValue = progress;
      }
    }

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
    this.#writeRankingRows(this.#ui.finalRankingRows, rankableHoles);
    const playerRank = rankableHoles.findIndex((hole) => hole.id === player.id) + 1;
    this.#ui.finalRank.textContent = playerRank.toString().padStart(2, "0");
    if (this.#state.status === "finished") {
      this.#ui.finalScore.textContent = player.score.toString().padStart(5, "0");
      this.#ui.gameOver.hidden = false;
    }
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
      ["speed", player.speedBoostRemaining, player.speedBoostCooldown, 20, "READY"],
      ["radius", player.radiusBoostRemaining, player.radiusBoostCooldown, 60, "READY"],
      ["bomb", player.bombFuseRemaining, player.bombCooldown, 120, "READY"],
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
      row.position.textContent = (index + 1).toString().padStart(2, "0");
      row.name.textContent =
        hole.kind === "human"
          ? this.#preferences.playerName.toUpperCase()
          : `BOT ${hole.id.slice(4).padStart(2, "0")}`;
      row.score.textContent = hole.score.toString().padStart(5, "0");
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
    this.#feedback.swallow();
    this.#scoreWorldPosition.set(event.position.x, 0.5, event.position.y).project(this.#camera);
    const rect = this.#canvas.getBoundingClientRect();
    const popup = document.createElement("span");
    popup.className = "score-pop";
    popup.textContent = `+${event.value}`;
    popup.style.left = `${((this.#scoreWorldPosition.x + 1) / 2) * rect.width}px`;
    popup.style.top = `${((-this.#scoreWorldPosition.y + 1) / 2) * rect.height}px`;
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
    this.#ui.scoreEffects.appendChild(popup);
  }

  readonly #restart = (): void => {
    this.#resetSimulation();
    this.#matchStarted = true;
    this.#renderer.setAnimationLoop(this.#frame);
    this.#ui.launchScreen.hidden = true;
    this.#ui.launchScreen.parentElement?.classList.remove("is-menu");
    this.#ui.gameOver.hidden = true;
    this.#sceneDirty = true;
    this.#syncScene(1);
    this.#sceneDirty = false;
    this.#updateHud();
  };

  readonly #returnHome = (): void => {
    this.#resetSimulation();
    this.#matchStarted = false;
    this.#renderer.setAnimationLoop(null);
    this.#input.reset();
    this.#ui.gameOver.hidden = true;
    this.#ui.launchScreen.hidden = false;
    this.#ui.launchScreen.parentElement?.classList.add("is-menu");
    this.#ui.startMatch.focus();
  };

  #resetSimulation(): void {
    const spawnSeed = (crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now()) >>> 0;
    this.#state = createInitialSimulation(0x5eed1234, spawnSeed);
    this.#pendingAbilities.clear();
    this.#lastBombFuseRemaining = 0;
    this.#accumulator = 0;
    this.#hudAccumulator = 0;
    this.#ui.scoreEffects.replaceChildren();
    this.#cityObjects.sync(this.#state.objects);
    this.#syncScene(1);
    this.#updateHud();
  }

  readonly #startMatch = (): void => {
    this.#feedback.activate();
    this.#matchStarted = true;
    this.#renderer.setAnimationLoop(this.#frame);
    this.#ui.launchScreen.hidden = true;
    this.#ui.launchScreen.parentElement?.classList.remove("is-menu");
    this.#lastTime = performance.now();
  };

  readonly #onShortcut = (event: KeyboardEvent): void => {
    if (document.querySelector(".dialog-layer:not([hidden])")) {
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
      return;
    }
    if (this.#state.status === "finished" && event.code === "KeyR") {
      event.preventDefault();
      this.#restart();
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
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  };
}
