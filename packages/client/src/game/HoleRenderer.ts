import {
  BOMB_FUSE_SECONDS,
  BOMB_RADIUS_MULTIPLIER,
  getHoleProgress,
  type HoleState,
} from "@hole-io/shared/simulation";
import * as THREE from "three";

/**
 * 黑洞视觉状态机（参考设计 hole-states.html 的 01–08 状态）。
 *
 * 黑洞在 three.js 中是「地面 stencil 切洞 + 地下圆筒」，43° 俯视下视觉呈椭圆。
 * 这里负责地面圆的所有外围样式：静态基础环 + 成长弧(12 点起) + 升级闪光 +
 * Q 加速拖尾 + E 范围涟漪 + R 引信弧/爆炸 + 无敌盾牌 + 领先皇冠。
 *
 * 全部 mesh 创建一次，靠 visible/opacity 切换；成长弧与引信弧仅在数值变化时重建几何，
 * 以满足移动端性能约束（AGENTS.md §0.4）。
 */

interface HoleVisual {
  id: string;
  isPlayer: boolean;
  group: THREE.Group;
  shaft: THREE.Mesh;
  depth: THREE.Mesh;
  progressMesh: THREE.Mesh;
  progressMaterial: THREE.MeshBasicMaterial;
  progressValue: number;
  baseRing: THREE.Mesh;
  levelFlash: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  flashTime: number;
  lastLevel: number;
  speedGroup: THREE.Group;
  streakMaterials: THREE.MeshBasicMaterial[];
  ripples: THREE.Mesh[];
  rippleMaterials: THREE.MeshBasicMaterial[];
  bombMesh: THREE.Mesh;
  bombMaterial: THREE.MeshBasicMaterial;
  bombValue: number;
  lastFuse: number;
  fuseGlow: THREE.Mesh;
  fuseGlowMaterial: THREE.MeshBasicMaterial;
  bombRange: THREE.Mesh;
  bombRangeMaterial: THREE.MeshBasicMaterial;
  explosion: THREE.Mesh;
  explosionMaterial: THREE.MeshBasicMaterial;
  explosionRing: THREE.Mesh;
  explosionRingMaterial: THREE.MeshBasicMaterial;
  explosionTime: number;
  coreGlow: THREE.Mesh;
  coreGlowMaterial: THREE.MeshBasicMaterial;
  shield: THREE.Sprite;
  crown: THREE.Sprite;
  lastPosX: number;
  lastPosZ: number;
}

const BASE_RING_INNER = 1.04;
const BASE_RING_OUTER = 1.1;
const PROGRESS_INNER = 1.13;
const PROGRESS_OUTER = 1.22;
const BOMB_RING_INNER = 1.04;
const BOMB_RING_OUTER = 1.16;
const RING_SEGMENTS = 96;
const FLASH_DURATION = 0.85;
const EXPLOSION_DURATION = 0.75;
const STREAK_COUNT = 5;
const RIPPLE_COUNT = 2;
const ARC_GEOMETRY_UPDATE_STEP = 1 / RING_SEGMENTS;

function resolveColor(
  hole: HoleState,
  colors: ReadonlyMap<string, THREE.ColorRepresentation>,
): THREE.Color {
  return new THREE.Color(colors.get(hole.id) ?? 0x2bf0ff);
}

function makeRingMaterial(color: THREE.Color, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
}

export interface HoleRendererOptions {
  /** 每个 hole（peerId / "player" / "bot-x"）对应的圆环颜色 #RRGGBB。 */
  readonly colors: ReadonlyMap<string, THREE.ColorRepresentation>;
  /** 本地玩家的 hole id，用于渲染本地专属视觉（加速拖尾/涟漪/引信/无敌盾牌）。 */
  readonly localPlayerId: string;
}

export class HoleRenderer {
  readonly #scene: THREE.Scene;
  readonly #colors: ReadonlyMap<string, THREE.ColorRepresentation>;
  readonly #localPlayerId: string;
  readonly #visuals = new Map<string, HoleVisual>();
  readonly #geometries = new Set<THREE.BufferGeometry>();
  readonly #materials = new Set<THREE.Material>();
  readonly #textures = new Set<THREE.Texture>();
  readonly #shieldTexture: THREE.CanvasTexture;
  readonly #crownTexture: THREE.CanvasTexture;

  constructor(scene: THREE.Scene, options: HoleRendererOptions) {
    this.#scene = scene;
    this.#colors = options.colors;
    this.#localPlayerId = options.localPlayerId;
    this.#shieldTexture = this.#createEmojiTexture("🛡️");
    this.#crownTexture = this.#createEmojiTexture("👑");
  }

  build(holes: readonly HoleState[]): void {
    for (const hole of holes) {
      const visual = this.#createHoleVisual(hole);
      this.#visuals.set(hole.id, visual);
      this.#scene.add(visual.group);
    }
  }

  sync(
    holes: readonly HoleState[],
    elapsed: number,
    deltaSeconds: number,
    leaderId: string | undefined,
  ): void {
    for (const hole of holes) {
      const visual = this.#visuals.get(hole.id);
      if (!visual) continue;
      this.#syncHole(visual, hole, elapsed, deltaSeconds, leaderId);
    }
  }

  dispose(): void {
    this.#visuals.forEach((visual) => this.#scene.remove(visual.group));
    this.#geometries.forEach((geometry) => geometry.dispose());
    this.#materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#visuals.clear();
  }

  #createHoleVisual(hole: HoleState): HoleVisual {
    const group = new THREE.Group();
    const color = resolveColor(hole, this.#colors);
    const isPlayer = hole.id === this.#localPlayerId;

    // stencil 切洞（地面开孔）。
    const maskGeometry = new THREE.CircleGeometry(1, RING_SEGMENTS);
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

    // 地下透明井壁。
    const shaftGeometry = new THREE.CylinderGeometry(1, 1, 6.8, RING_SEGMENTS, 1, true);
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

    // 深处底面。
    const depthGeometry = new THREE.CircleGeometry(1, RING_SEGMENTS);
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

    // 01 静态基础环（用户所选颜色，常驻勾边）。
    const baseRingGeometry = new THREE.RingGeometry(
      BASE_RING_INNER,
      BASE_RING_OUTER,
      RING_SEGMENTS,
    );
    const baseRingMaterial = makeRingMaterial(color, 0.92);
    const baseRing = new THREE.Mesh(baseRingGeometry, baseRingMaterial);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.006;
    baseRing.renderOrder = 3;
    group.add(baseRing);

    // 01/02 成长弧（外侧、12 点钟起点、顺时针填充）。
    const progressGeometry = new THREE.RingGeometry(
      PROGRESS_INNER,
      PROGRESS_OUTER,
      RING_SEGMENTS,
      1,
      Math.PI / 2,
      0.001,
    );
    const progressMaterial = makeRingMaterial(color, 0.95);
    const progressMesh = new THREE.Mesh(progressGeometry, progressMaterial);
    progressMesh.rotation.x = -Math.PI / 2;
    progressMesh.position.y = 0.007;
    progressMesh.renderOrder = 4;
    group.add(progressMesh);

    // 02 升级闪光（加色光晕环，level 递增时触发，略长于原型默认）。
    const flashGeometry = new THREE.RingGeometry(BASE_RING_INNER, PROGRESS_OUTER, 64);
    const flashMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const levelFlash = new THREE.Mesh(flashGeometry, flashMaterial);
    levelFlash.rotation.x = -Math.PI / 2;
    levelFlash.position.y = 0.009;
    levelFlash.renderOrder = 4.5;
    levelFlash.visible = false;
    group.add(levelFlash);

    // 05 Q 加速拖尾（玩家专用，沿移动反方向扇形排布）。
    const speedGroup = new THREE.Group();
    speedGroup.visible = false;
    const streakMaterials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const streakGeometry = new THREE.PlaneGeometry(0.55, 0.09);
      const streakMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const streak = new THREE.Mesh(streakGeometry, streakMaterial);
      streak.rotation.x = -Math.PI / 2;
      streak.renderOrder = 5;
      speedGroup.add(streak);
      streakMaterials.push(streakMaterial);
      this.#geometries.add(streakGeometry);
      this.#materials.add(streakMaterial);
    }
    group.add(speedGroup);

    // 06 E 范围涟漪（玩家专用，两道扩散环）。
    const ripples: THREE.Mesh[] = [];
    const rippleMaterials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < RIPPLE_COUNT; i += 1) {
      const rippleGeometry = new THREE.RingGeometry(PROGRESS_INNER, PROGRESS_OUTER, 64);
      const rippleMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      const ripple = new THREE.Mesh(rippleGeometry, rippleMaterial);
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.y = 0.008;
      ripple.renderOrder = 5;
      ripple.visible = false;
      group.add(ripple);
      ripples.push(ripple);
      rippleMaterials.push(rippleMaterial);
      this.#geometries.add(rippleGeometry);
      this.#materials.add(rippleMaterial);
    }

    // 07 R 引信倒计时弧（贴洞缘，随 fuse 缩短）。
    const bombGeometry = new THREE.RingGeometry(
      BOMB_RING_INNER,
      BOMB_RING_OUTER,
      RING_SEGMENTS,
      1,
      Math.PI / 2,
      0.001,
    );
    const bombMaterial = makeRingMaterial(new THREE.Color(0xff4133), 1);
    const bombMesh = new THREE.Mesh(bombGeometry, bombMaterial);
    bombMesh.rotation.x = -Math.PI / 2;
    bombMesh.position.y = 0.01;
    bombMesh.renderOrder = 4.6;
    bombMesh.visible = false;
    group.add(bombMesh);

    // 07 引信期间的红色危险光晕（洞口内透出红光 + 脉冲）。
    const fuseGlowGeometry = new THREE.CircleGeometry(1.02, 48);
    const fuseGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const fuseGlow = new THREE.Mesh(fuseGlowGeometry, fuseGlowMaterial);
    fuseGlow.rotation.x = -Math.PI / 2;
    fuseGlow.position.y = 0.004;
    fuseGlow.renderOrder = 2.5;
    fuseGlow.visible = false;
    group.add(fuseGlow);

    // 07 引信期间提前标出命中边界。group 按洞半径缩放，因此 2 个局部单位
    // 恰好对应判定的 2 × 半径，避免视觉范围和权威逻辑脱节。
    const bombRangeGeometry = new THREE.RingGeometry(0.975, 1, 56);
    const bombRangeMaterial = new THREE.MeshBasicMaterial({
      color: 0xff594a,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const bombRange = new THREE.Mesh(bombRangeGeometry, bombRangeMaterial);
    bombRange.rotation.x = -Math.PI / 2;
    bombRange.position.y = 0.013;
    bombRange.renderOrder = 5.4;
    bombRange.visible = false;
    group.add(bombRange);

    // 07 爆炸冲击光晕，中心快速扩张至命中边界。
    const explosionGeometry = new THREE.CircleGeometry(1, 56);
    const explosionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a4a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const explosion = new THREE.Mesh(explosionGeometry, explosionMaterial);
    explosion.rotation.x = -Math.PI / 2;
    explosion.position.y = 0.014;
    explosion.renderOrder = 5.5;
    explosion.visible = false;
    group.add(explosion);

    // 07 爆炸时固定在命中边界的高亮冲击环。
    const explosionRingGeometry = new THREE.RingGeometry(0.92, 1, 56);
    const explosionRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe2a6,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const explosionRing = new THREE.Mesh(explosionRingGeometry, explosionRingMaterial);
    explosionRing.rotation.x = -Math.PI / 2;
    explosionRing.position.y = 0.016;
    explosionRing.renderOrder = 5.6;
    explosionRing.visible = false;
    group.add(explosionRing);

    // 02/升级 黑洞内部闪烁（洞心加色光晕，随升级闪光一起脉冲）。
    const coreGlowGeometry = new THREE.CircleGeometry(0.82, 40);
    const coreGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9a6bff),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
    coreGlow.rotation.x = -Math.PI / 2;
    coreGlow.position.y = 0.003;
    coreGlow.renderOrder = 2;
    coreGlow.visible = false;
    group.add(coreGlow);

    // 08 无敌盾牌（玩家专用，沿洞缘轨道公转）。
    const shield = this.#createSprite(this.#shieldTexture);
    shield.visible = false;
    group.add(shield);

    // 09 领先皇冠（保留既有 emoji sprite 逻辑）。
    const crown = this.#createSprite(this.#crownTexture);
    crown.visible = false;
    group.add(crown);

    [
      maskGeometry,
      shaftGeometry,
      depthGeometry,
      baseRingGeometry,
      progressGeometry,
      flashGeometry,
      bombGeometry,
      fuseGlowGeometry,
      bombRangeGeometry,
      explosionGeometry,
      explosionRingGeometry,
      coreGlowGeometry,
    ].forEach((geometry) => this.#geometries.add(geometry));
    [
      maskMaterial,
      shaftMaterial,
      depthMaterial,
      baseRingMaterial,
      progressMaterial,
      flashMaterial,
      bombMaterial,
      fuseGlowMaterial,
      bombRangeMaterial,
      explosionMaterial,
      explosionRingMaterial,
      coreGlowMaterial,
    ].forEach((material) => this.#materials.add(material));

    const progress = getHoleProgress(hole.score);
    return {
      id: hole.id,
      isPlayer,
      group,
      shaft,
      depth,
      progressMesh,
      progressMaterial,
      progressValue: -1,
      baseRing,
      levelFlash,
      flashMaterial,
      flashTime: 0,
      lastLevel: progress.level,
      speedGroup,
      streakMaterials,
      ripples,
      rippleMaterials,
      bombMesh,
      bombMaterial,
      bombValue: -1,
      lastFuse: 0,
      fuseGlow,
      fuseGlowMaterial,
      bombRange,
      bombRangeMaterial,
      explosion,
      explosionMaterial,
      explosionRing,
      explosionRingMaterial,
      explosionTime: 0,
      coreGlow,
      coreGlowMaterial,
      shield,
      crown,
      lastPosX: hole.position.x,
      lastPosZ: hole.position.y,
    };
  }

  #syncHole(
    visual: HoleVisual,
    hole: HoleState,
    elapsed: number,
    deltaSeconds: number,
    leaderId: string | undefined,
  ): void {
    const visible = hole.eliminationRemaining <= 0 && !hole.isOut;
    visual.group.visible = visible;
    if (!visible) {
      visual.lastPosX = hole.position.x;
      visual.lastPosZ = hole.position.y;
      return;
    }

    visual.group.position.set(hole.position.x, 0, hole.position.y);
    visual.group.scale.set(hole.radius, 1, hole.radius);
    const invulnerable = hole.invulnerabilityRemaining > 0;
    visual.progressMaterial.opacity = invulnerable ? 1 : 0.95;
    visual.baseRing.visible = true;

    visual.shaft.scale.y = hole.radius;
    visual.shaft.position.y = -3.4 * hole.radius;
    visual.depth.position.y = -6.8 * hole.radius;

    this.#syncProgress(visual, hole);
    this.#syncLevelFlash(visual, hole, deltaSeconds);
    this.#syncSpeed(visual, hole, elapsed);
    this.#syncRange(visual, hole, elapsed);
    this.#syncBomb(visual, hole, elapsed, deltaSeconds);
    this.#syncShield(visual, hole, elapsed);
    this.#syncCrown(visual, hole, leaderId);

    visual.lastPosX = hole.position.x;
    visual.lastPosZ = hole.position.y;
  }

  #syncProgress(visual: HoleVisual, hole: HoleState): void {
    const progress = getHoleProgress(hole.score).progress;
    if (Math.abs(progress - visual.progressValue) < ARC_GEOMETRY_UPDATE_STEP) return;
    const thetaLength = Math.max(0.001, progress * Math.PI * 2);
    const thetaStart = Math.PI / 2 - thetaLength; // 12 点起、顺时针填充
    const geometry = new THREE.RingGeometry(
      PROGRESS_INNER,
      PROGRESS_OUTER,
      RING_SEGMENTS,
      1,
      thetaStart,
      thetaLength,
    );
    const oldGeometry = visual.progressMesh.geometry;
    visual.progressMesh.geometry = geometry;
    this.#geometries.delete(oldGeometry);
    oldGeometry.dispose();
    this.#geometries.add(geometry);
    visual.progressValue = progress;
  }

  #syncLevelFlash(visual: HoleVisual, hole: HoleState, deltaSeconds: number): void {
    const level = getHoleProgress(hole.score).level;
    if (level > visual.lastLevel) {
      visual.flashTime = FLASH_DURATION;
    }
    visual.lastLevel = level;
    if (visual.flashTime > 0) {
      visual.flashTime = Math.max(0, visual.flashTime - deltaSeconds);
      const t = visual.flashTime / FLASH_DURATION;
      visual.levelFlash.visible = true;
      visual.flashMaterial.opacity = 0.85 * t;
      const scale = 1.15 - 0.25 * t;
      visual.levelFlash.scale.set(scale, scale, scale);
      // 内部闪烁：洞心加色光晕高频脉冲，强化「升级」体感。
      const elapsedFlash = FLASH_DURATION - visual.flashTime;
      const flicker = 0.5 + 0.5 * Math.abs(Math.sin(elapsedFlash * 26));
      visual.coreGlow.visible = true;
      visual.coreGlowMaterial.opacity = 0.9 * t * flicker;
      const coreScale = 0.85 + 0.3 * (1 - t) + 0.05 * flicker;
      visual.coreGlow.scale.set(coreScale, coreScale, coreScale);
    } else {
      visual.levelFlash.visible = false;
      visual.coreGlow.visible = false;
    }
  }

  #syncSpeed(visual: HoleVisual, hole: HoleState, elapsed: number): void {
    if (!visual.isPlayer || hole.speedBoostRemaining <= 0) {
      visual.speedGroup.visible = false;
      return;
    }
    const deltaX = hole.position.x - visual.lastPosX;
    const deltaZ = hole.position.y - visual.lastPosZ;
    const moveLength = Math.hypot(deltaX, deltaZ);
    if (moveLength < 0.0001) {
      visual.speedGroup.visible = false;
      return;
    }
    visual.speedGroup.visible = true;
    const moveAngle = Math.atan2(deltaZ, deltaX);
    const fan = 0.55;
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const material = visual.streakMaterials[i];
      if (!material) continue;
      const offset = (i / (STREAK_COUNT - 1) - 0.5) * 2 * fan;
      const angle = moveAngle + Math.PI + offset; // 拖尾在移动反方向
      const radius = 1.18 + (i % 2) * 0.04;
      const child = visual.speedGroup.children[i] as THREE.Mesh | undefined;
      if (child) {
        child.position.set(Math.cos(angle) * radius * 1.05, 0, Math.sin(angle) * radius * 1.05);
        child.rotation.z = -angle;
      }
      const phase = (elapsed * 3 + i * 0.2) % 1;
      material.opacity = 0.25 + 0.6 * (1 - Math.abs(phase - 0.5) * 2);
    }
  }

  #syncRange(visual: HoleVisual, hole: HoleState, elapsed: number): void {
    if (!visual.isPlayer || hole.radiusBoostRemaining <= 0) {
      visual.ripples.forEach((ripple) => {
        ripple.visible = false;
      });
      return;
    }
    const cycle = 1.3;
    for (let i = 0; i < RIPPLE_COUNT; i += 1) {
      const ripple = visual.ripples[i];
      const material = visual.rippleMaterials[i];
      if (!ripple || !material) continue;
      const phase = ((elapsed + i * 0.5) % cycle) / cycle;
      ripple.visible = true;
      const scale = 1 + phase * 0.55;
      ripple.scale.set(scale, scale, scale);
      material.opacity = 0.85 * (1 - phase);
    }
  }

  #syncBomb(visual: HoleVisual, hole: HoleState, elapsed: number, deltaSeconds: number): void {
    const fuse = hole.bombFuseRemaining;
    if (!visual.isPlayer || fuse <= 0) {
      visual.bombMesh.visible = false;
      visual.fuseGlow.visible = false;
      visual.bombRange.visible = false;
      if (visual.lastFuse > 0 && fuse <= 0) {
        visual.explosionTime = EXPLOSION_DURATION;
      }
      visual.lastFuse = fuse;
      this.#syncExplosion(visual, deltaSeconds);
      return;
    }
    visual.lastFuse = fuse;
    const fraction = Math.max(0, Math.min(1, fuse / BOMB_FUSE_SECONDS));
    if (Math.abs(fraction - visual.bombValue) >= ARC_GEOMETRY_UPDATE_STEP) {
      const thetaLength = Math.max(0.001, fraction * Math.PI * 2);
      const thetaStart = Math.PI / 2 - thetaLength;
      const geometry = new THREE.RingGeometry(
        BOMB_RING_INNER,
        BOMB_RING_OUTER,
        RING_SEGMENTS,
        1,
        thetaStart,
        thetaLength,
      );
      const oldGeometry = visual.bombMesh.geometry;
      visual.bombMesh.geometry = geometry;
      this.#geometries.delete(oldGeometry);
      oldGeometry.dispose();
      this.#geometries.add(geometry);
      visual.bombValue = fraction;
    }
    // 引信弧脉冲（越接近爆炸越急促）。
    const urgency = 1 - fraction;
    const beat = 1 + Math.sin(elapsed * (12 + urgency * 22)) * (0.04 + urgency * 0.06);
    visual.bombMesh.visible = true;
    visual.bombMesh.scale.set(beat, beat, beat);
    // 洞口红色危险光晕：随倒计时推进变亮、急促闪烁。
    const flicker = 0.65 + 0.35 * Math.abs(Math.sin(elapsed * (10 + urgency * 30)));
    visual.fuseGlow.visible = true;
    visual.fuseGlowMaterial.opacity = (0.25 + urgency * 0.5) * flicker;
    const glowScale = 1.05 + Math.sin(elapsed * 14) * 0.03;
    visual.fuseGlow.scale.set(glowScale, glowScale, glowScale);
    visual.bombRange.visible = true;
    visual.bombRange.scale.set(
      BOMB_RADIUS_MULTIPLIER,
      BOMB_RADIUS_MULTIPLIER,
      BOMB_RADIUS_MULTIPLIER,
    );
    visual.bombRangeMaterial.opacity = (0.18 + urgency * 0.32) * flicker;
    this.#syncExplosion(visual, deltaSeconds);
  }

  #syncExplosion(visual: HoleVisual, deltaSeconds: number): void {
    if (visual.explosionTime <= 0) {
      visual.explosion.visible = false;
      visual.explosionRing.visible = false;
      return;
    }
    visual.explosionTime = Math.max(0, visual.explosionTime - deltaSeconds);
    const t = 1 - visual.explosionTime / EXPLOSION_DURATION;
    visual.explosion.visible = true;
    visual.explosionRing.visible = true;
    const travel = Math.min(1, t / 0.35);
    const easedT = 1 - (1 - travel) * (1 - travel) * (1 - travel);
    const rangeScale = 0.42 + (BOMB_RADIUS_MULTIPLIER - 0.42) * easedT;
    visual.explosion.scale.set(rangeScale * 0.88, rangeScale * 0.88, rangeScale * 0.88);
    visual.explosionRing.scale.set(
      BOMB_RADIUS_MULTIPLIER,
      BOMB_RADIUS_MULTIPLIER,
      BOMB_RADIUS_MULTIPLIER,
    );
    const fade = 1 - t;
    visual.explosionMaterial.opacity = 0.86 * fade;
    visual.explosionRingMaterial.opacity = 0.98 * Math.pow(fade, 0.4);
  }

  #syncShield(visual: HoleVisual, hole: HoleState, elapsed: number): void {
    if (!visual.isPlayer || hole.invulnerabilityRemaining <= 0) {
      visual.shield.visible = false;
      return;
    }
    const angle = elapsed * 1.2;
    const orbitRadius = hole.radius * 1.35;
    visual.shield.visible = true;
    visual.shield.position.set(Math.cos(angle) * orbitRadius, 0.6, Math.sin(angle) * orbitRadius);
    const size = 0.9 + hole.radius * 0.12;
    visual.shield.scale.set(size, size, size);
  }

  #syncCrown(visual: HoleVisual, hole: HoleState, leaderId: string | undefined): void {
    const isLeader = leaderId === hole.id;
    visual.crown.visible = isLeader;
    if (!isLeader) return;
    visual.crown.position.y = 0.75 + hole.radius * 0.18;
    const size = 0.95;
    visual.crown.scale.set(size, size * hole.radius, size);
  }

  #createSprite(texture: THREE.CanvasTexture): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 6;
    this.#materials.add(material);
    return sprite;
  }

  #createEmojiTexture(emoji: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = "176px 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(emoji, 128, 126);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.#textures.add(texture);
    return texture;
  }
}
