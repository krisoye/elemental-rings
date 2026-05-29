import Phaser from 'phaser';

/**
 * A walkable point-of-interest in a spatial scene (bed, meditation circle,
 * ring-storage wall, campfire, exit door, overworld return). Built from a Tiled
 * rectangle object: it owns an Arcade overlap zone covering that rectangle and a
 * floating "Press E" prompt shown while the player stands on it and it is the
 * active zone.
 *
 * The owning scene decides which overlapping zone is "active" (nearest wins) and
 * drives `setActive()` each frame; pressing E (or the test hook) fires the bound
 * `onInteract` callback. Purely presentational — the callback runs scene logic
 * that round-trips to the authoritative server.
 */
export class InteractionZone {
  readonly name: string;
  readonly onInteract: () => void;
  /** World-space rectangle of the zone (for overlap + nearest-zone selection). */
  readonly rect: Phaser.Geom.Rectangle;
  /** Center of the zone, used for the prompt position and distance ranking. */
  readonly centerX: number;
  readonly centerY: number;

  private readonly zone: Phaser.GameObjects.Zone;
  private readonly prompt: Phaser.GameObjects.Text;
  private active = false;

  /**
   * @param scene owning spatial scene
   * @param obj a Tiled rectangle object (x/y are top-left, in pixels)
   * @param onInteract fired on E / interact while this zone is active
   */
  constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    onInteract: () => void,
  ) {
    this.name = obj.name ?? 'zone';
    this.onInteract = onInteract;

    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.rect = new Phaser.Geom.Rectangle(x, y, w, h);
    this.centerX = x + w / 2;
    this.centerY = y + h / 2;

    // Arcade overlap zone with a static body covering the rectangle. The body
    // makes the zone a real physics participant (per the spatial design); the
    // scene also reads `rect` directly for deterministic nearest-zone selection.
    this.zone = scene.add.zone(this.centerX, this.centerY, w, h);
    scene.physics.add.existing(this.zone, true);

    // Floating "Press E" prompt above the zone, hidden until active.
    this.prompt = scene.add
      .text(this.centerX, y - 14, 'Press E', {
        fontSize: '13px',
        color: '#ffffaa',
        backgroundColor: '#000000aa',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(1000)
      .setVisible(false);
  }

  /** The static overlap body's game object (for `physics.add.overlap`). */
  get overlapZone(): Phaser.GameObjects.Zone {
    return this.zone;
  }

  /**
   * The world-space display objects owned by this zone (the invisible overlap
   * zone + the "Press E" prompt text). Returned so the owning scene can tell
   * the UI camera to ignore them, keeping them invisible in the UI layer and
   * visible only through the world (main) camera.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.zone, this.prompt];
  }

  /** True while the player's body intersects this zone's rectangle. */
  contains(px: number, py: number): boolean {
    return Phaser.Geom.Rectangle.Contains(this.rect, px, py);
  }

  /** Squared distance from the zone center to a point (cheap ranking metric). */
  distanceSqTo(px: number, py: number): number {
    const dx = px - this.centerX;
    const dy = py - this.centerY;
    return dx * dx + dy * dy;
  }

  /** Show / hide the prompt. Only the scene's chosen active zone is shown. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    this.prompt.setVisible(active);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Fire the interaction callback (E press or test hook). */
  interact(): void {
    this.onInteract();
  }

  /** Destroy owned game objects (on scene shutdown). */
  destroy(): void {
    this.zone.destroy();
    this.prompt.destroy();
  }
}
