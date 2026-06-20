/**
 * AtmospherePipeline.ts — "Death's Door" forest atmosphere
 *
 * Phaser 4.1.0-native. The Phaser 3.60+ FX pipeline (camera.postFX,
 * addColorMatrix/Bloom/Vignette/Blur, PostFXPipeline, particle `alphaYoyo`)
 * does NOT exist in Phaser 4 and is intentionally NOT used here.
 *
 * Everything is built from primitives that DO exist in 4.1.0:
 *  - full-screen tinted rectangles with blend modes (MULTIPLY/SCREEN/ADD)
 *    for color grade + darken/brighten
 *  - runtime-generated radial-gradient texture for the vignette
 *  - runtime-generated soft cloud texture on a TileSprite for drifting fog
 *  - particle emitters with a per-particle alpha curve (sin) for motes
 *
 * Asset-free: every texture is generated at runtime via Graphics or Canvas.
 * Idempotent: safe to call on every screen transition. Disable with ?atmos=0.
 *
 * Per-screen mood is keyed off `(scene as any).screenId` per the Forest GDD
 * (docs/gdd-10-forest.md §10.15) — SAFE / DEEP / COLD / LUSH presets.
 */

import Phaser from 'phaser';

// ---------------------------------------------------------------------------
// Types & presets
// ---------------------------------------------------------------------------

type MoteStyle = 'ember' | 'pollen' | 'snow' | 'dust';

interface AtmospherePreset {
  /** MULTIPLY tint plate (darken + color cast). 0xRRGGBB + alpha 0..1 */
  tint: number;
  tintAlpha: number;
  /** Optional SCREEN/ADD lift plate (warm glow / bloom approximation) */
  liftColor?: number;
  liftAlpha?: number;
  liftBlend?: number; // Phaser.BlendModes.SCREEN or ADD

  /** Fog */
  fogColor: number;
  fogAlpha: number;
  fogSpeed: number; // px/sec scroll of tileSprite

  /** Vignette */
  vignetteAlpha: number;

  /** Motes */
  moteStyle: MoteStyle;
  moteFrequency: number; // ms between particles; lower = denser
}

const PRESETS: Record<'SAFE' | 'DEEP' | 'COLD' | 'LUSH' | 'DEFAULT', AtmospherePreset> = {
  SAFE: {
    tint: 0x3a2a1a, tintAlpha: 0.18,
    liftColor: 0xffd8a8, liftAlpha: 0.08, liftBlend: Phaser.BlendModes.SCREEN,
    fogColor: 0xfff2d6, fogAlpha: 0.06, fogSpeed: 6,
    vignetteAlpha: 0.35,
    moteStyle: 'pollen', moteFrequency: 220,
  },
  DEEP: {
    tint: 0x0a1418, tintAlpha: 0.42,
    liftColor: 0x1a3a30, liftAlpha: 0.08, liftBlend: Phaser.BlendModes.SCREEN,
    fogColor: 0x1f2a26, fogAlpha: 0.22, fogSpeed: 14,
    vignetteAlpha: 0.65,
    moteStyle: 'dust', moteFrequency: 140,
  },
  COLD: {
    tint: 0x0e1a2a, tintAlpha: 0.32,
    liftColor: 0xb8d8ff, liftAlpha: 0.06, liftBlend: Phaser.BlendModes.SCREEN,
    fogColor: 0xc8d8e8, fogAlpha: 0.18, fogSpeed: 26,
    vignetteAlpha: 0.5,
    moteStyle: 'snow', moteFrequency: 90,
  },
  LUSH: {
    tint: 0x14281a, tintAlpha: 0.28,
    liftColor: 0x9cffb0, liftAlpha: 0.10, liftBlend: Phaser.BlendModes.SCREEN,
    fogColor: 0xa8e8b0, fogAlpha: 0.10, fogSpeed: 10,
    vignetteAlpha: 0.4,
    moteStyle: 'ember', moteFrequency: 180,
  },
  DEFAULT: {
    tint: 0x182028, tintAlpha: 0.22,
    fogColor: 0xb0b8b8, fogAlpha: 0.10, fogSpeed: 10,
    vignetteAlpha: 0.45,
    moteStyle: 'dust', moteFrequency: 200,
  },
};

const SCREEN_PRESETS: Record<string, keyof typeof PRESETS> = {
  // SAFE
  forest_anchorage: 'SAFE', glade: 'SAFE', mossy_fen: 'SAFE',
  east_path: 'SAFE', south_path: 'SAFE', heath: 'SAFE',
  // DEEP
  hollow: 'DEEP', forest_hollow: 'DEEP',
  swamp_gate: 'DEEP', forest_swamp_gate: 'DEEP',
  briar_pass: 'DEEP', briar_thicket: 'DEEP',
  deepwood: 'DEEP', boss_clearing: 'DEEP', ridge: 'DEEP', crossroads: 'DEEP',
  // COLD
  north_road: 'COLD', snow_gate: 'COLD', forest_snow_gate: 'COLD',
  gale_lookout: 'COLD', wind_shelf: 'COLD',
  // LUSH
  bloom_hollow: 'LUSH', forest_bloom_hollow: 'LUSH',
  ancient_grove: 'LUSH', forest_ancient_grove: 'LUSH',
  verdant_descent: 'LUSH', root_tangle: 'LUSH',
  canopy_walk: 'LUSH', thornado_shrine: 'LUSH',
};

function presetFor(screenId: string | undefined): AtmospherePreset {
  if (!screenId) return PRESETS.DEFAULT;
  const key = SCREEN_PRESETS[screenId];
  return key ? PRESETS[key] : PRESETS.DEFAULT;
}

// ---------------------------------------------------------------------------
// Per-scene state (tracked for teardown — idempotency)
// ---------------------------------------------------------------------------

interface AtmosphereState {
  objects: Phaser.GameObjects.GameObject[];
  fog?: Phaser.GameObjects.TileSprite;
  fogSpeed: number;
  updateHandler?: (time: number, delta: number) => void;
}

const STATE_KEY = '__deathsDoorAtmosphere';

function getState(scene: Phaser.Scene): AtmosphereState | undefined {
  return (scene as any)[STATE_KEY];
}

function setState(scene: Phaser.Scene, s: AtmosphereState | undefined) {
  (scene as any)[STATE_KEY] = s;
}

function teardown(scene: Phaser.Scene) {
  const s = getState(scene);
  if (!s) return;
  if (s.updateHandler) {
    scene.events.off(Phaser.Scenes.Events.UPDATE, s.updateHandler);
  }
  for (const o of s.objects) {
    try { o.destroy(); } catch { /* noop */ }
  }
  setState(scene, undefined);
}

// ---------------------------------------------------------------------------
// Runtime texture generation (asset-free)
// ---------------------------------------------------------------------------

const VIGNETTE_KEY = 'dd_atmos_vignette';
const FOG_KEY = 'dd_atmos_fog';

function ensureVignetteTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(VIGNETTE_KEY)) return VIGNETTE_KEY;
  const w = 512, h = 512;
  const tex = scene.textures.createCanvas(VIGNETTE_KEY, w, h);
  if (!tex) return VIGNETTE_KEY;
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.15, w / 2, h / 2, w * 0.55);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  tex.refresh();
  return VIGNETTE_KEY;
}

function ensureFogTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FOG_KEY)) return FOG_KEY;
  const w = 512, h = 512;
  const tex = scene.textures.createCanvas(FOG_KEY, w, h);
  if (!tex) return FOG_KEY;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, w, h);
  // Soft puff cloud field via many radial gradients
  const rng = mulberry32(0xd00d);
  for (let i = 0; i < 60; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 60 + rng() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rng() * 0.08;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  tex.refresh();
  return FOG_KEY;
}

function moteTextureKey(scene: Phaser.Scene, style: MoteStyle): string {
  const key = `dd_atmos_mote_${style}`;
  if (scene.textures.exists(key)) return key;
  const size = 8;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return key;
  const ctx = tex.getContext();
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  const color = (() => {
    switch (style) {
      case 'ember': return '255,180,90';
      case 'pollen': return '255,235,160';
      case 'snow': return '240,248,255';
      case 'dust': default: return '200,200,200';
    }
  })();
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
  return key;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applyDeathsDoorForest(scene: Phaser.Scene): void {
  // Always tear down first — idempotent on re-enter.
  teardown(scene);

  // ?atmos=0 disables cleanly.
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('atmos') === '0') return;
    } catch { /* noop */ }
  }

  const screenId = (scene as any).screenId as string | undefined;
  const preset = presetFor(screenId);

  const cam = scene.cameras.main;
  const W = cam.width;
  const H = cam.height;

  const state: AtmosphereState = { objects: [], fogSpeed: preset.fogSpeed };

  // --- 1. Color grade: MULTIPLY tint plate (darken + cast) -----------------
  const tintPlate = scene.add
    .rectangle(W / 2, H / 2, W, H, preset.tint, preset.tintAlpha)
    .setScrollFactor(0)
    .setDepth(50)
    .setBlendMode(Phaser.BlendModes.MULTIPLY);
  state.objects.push(tintPlate);

  // --- 1b. Optional SCREEN/ADD lift (warm glow / bloom approximation) ------
  if (preset.liftColor !== undefined && preset.liftAlpha) {
    const lift = scene.add
      .rectangle(W / 2, H / 2, W, H, preset.liftColor, preset.liftAlpha)
      .setScrollFactor(0)
      .setDepth(51)
      .setBlendMode(preset.liftBlend ?? Phaser.BlendModes.SCREEN);
    state.objects.push(lift);
  }

  // --- 2. Fog: tiling soft-cloud texture, drifting in update() -------------
  const fogKey = ensureFogTexture(scene);
  const fog = scene.add
    .tileSprite(W / 2, H / 2, W, H, fogKey)
    .setScrollFactor(0)
    .setDepth(52)
    .setAlpha(preset.fogAlpha)
    .setTint(preset.fogColor)
    .setBlendMode(Phaser.BlendModes.SCREEN);
  state.fog = fog;
  state.objects.push(fog);

  // --- 3. Motes (particles with sin-curve alpha — no alphaYoyo) ------------
  const moteKey = moteTextureKey(scene, preset.moteStyle);
  const moteBlend = preset.moteStyle === 'snow'
    ? Phaser.BlendModes.NORMAL
    : Phaser.BlendModes.ADD;

  // Vertical drift differs by style: snow falls, embers/pollen rise, dust drifts.
  const speedY = (() => {
    switch (preset.moteStyle) {
      case 'snow': return { min: 20, max: 60 };
      case 'ember': return { min: -50, max: -15 };
      case 'pollen': return { min: -25, max: -5 };
      case 'dust': default: return { min: -10, max: 10 };
    }
  })();

  const particles = scene.add.particles(0, 0, moteKey, {
    x: { min: 0, max: W },
    y: { min: 0, max: H },
    lifespan: 4500,
    frequency: preset.moteFrequency,
    quantity: 1,
    speedX: { min: -20, max: 20 },
    speedY,
    scale: { min: 0.4, max: 1.4 },
    alpha: {
      // Per-particle alpha curve — 0 → peak → 0 across lifetime.
      // t is normalized 0..1; sin(pi * t) yields the fade-in/out shape
      // that the removed `alphaYoyo` flag used to provide.
      onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _key: string, t: number) =>
        Math.sin(Math.PI * Math.max(0, Math.min(1, t))),
    },
    blendMode: moteBlend,
  });
  particles.setScrollFactor(0).setDepth(900);
  state.objects.push(particles);

  // --- 4. Vignette: runtime radial-gradient texture ------------------------
  const vigKey = ensureVignetteTexture(scene);
  const vignette = scene.add
    .image(W / 2, H / 2, vigKey)
    .setScrollFactor(0)
    .setDepth(950)
    .setAlpha(preset.vignetteAlpha)
    .setBlendMode(Phaser.BlendModes.MULTIPLY);
  // Stretch radial texture to viewport
  vignette.setDisplaySize(W * 1.05, H * 1.05);
  state.objects.push(vignette);

  // --- Drift the fog -------------------------------------------------------
  const handler = (_time: number, delta: number) => {
    if (state.fog) {
      state.fog.tilePositionX += (state.fogSpeed * delta) / 1000;
      state.fog.tilePositionY += (state.fogSpeed * 0.3 * delta) / 1000;
    }
  };
  state.updateHandler = handler;
  scene.events.on(Phaser.Scenes.Events.UPDATE, handler);

  // Tear down automatically when the scene shuts down or is destroyed.
  const cleanup = () => teardown(scene);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

  setState(scene, state);
}
