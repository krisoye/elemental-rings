import Phaser from 'phaser';
import { Player } from '../objects/world/Player';
import { InteractionZone } from '../objects/world/InteractionZone';

/**
 * Overworld stub (GDD §10 / §10.8 biome-loop seam). A minimal walkable
 * placeholder map reached from the Sanctum's exit door (8A.3). It reuses the
 * exact spatial engine pattern as the Sanctum: tilemap → collision layer →
 * Player at spawn → collider → camera follow + bounds. A `sanctum_return` zone
 * walks the player back into the Sanctum (CampScene).
 *
 * No waystones, NPCs, or biome content yet — those are 8B/8C. Client-only; no
 * server changes. The scene does not auto-start (it is reached via the door).
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private zones: InteractionZone[] = [];
  private activeZone: InteractionZone | null = null;

  constructor() {
    super({ key: 'OverworldScene' });
  }

  preload(): void {
    // `tiles` is cached if the Sanctum loaded first, but reload defensively in
    // case the overworld is the first spatial scene (e.g. a direct deep-link).
    if (!this.textures.exists('tiles')) {
      this.load.image('tiles', 'assets/tiles/placeholder.png');
    }
    this.load.tilemapTiledJSON('overworld', 'assets/maps/overworld.json');
  }

  create(): void {
    window.__scene = this;
    window.__activeScene = 'OverworldScene';

    const map = this.make.tilemap({ key: 'overworld' });
    const tileset = map.addTilesetImage('placeholder', 'tiles')!;
    const groundLayer = map.createLayer('ground', tileset, 0, 0)!;
    groundLayer.setCollisionByProperty({ collides: true });

    const spawn = map.getObjectLayer('objects')?.objects.find((o) => o.name === 'spawn');
    this.player = new Player(this, spawn?.x ?? 64, spawn?.y ?? 64);
    this.physics.add.collider(this.player, groundLayer);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // Title hint so the placeholder room is legible.
    this.add
      .text(map.widthInPixels / 2, 24, 'OVERWORLD (stub)', { fontSize: '16px', color: '#cfe3ff' })
      .setOrigin(0.5);

    // Interaction zones: sanctum_return → back to the Sanctum.
    this.buildZones(map);

    // Input.
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd;
    this.input.keyboard!.on('keydown-E', () => this.activeZone?.interact());
    window.__sanctumInteract = (): void => this.activeZone?.interact();

    window.__player = this.player;
    this.events.once('shutdown', () => {
      window.__player = null;
      window.__scene = null;
      window.__sanctumInteract = undefined;
      window.__sanctumZones = undefined;
      this.zones.forEach((z) => z.destroy());
      this.zones = [];
    });
  }

  update(): void {
    this.player.update(this.cursors, this.wasd);
    this.updateActiveZone();
  }

  /** Build an InteractionZone for each named rectangle (sanctum_return here). */
  private buildZones(map: Phaser.Tilemaps.Tilemap): void {
    const objs = map.getObjectLayer('objects')?.objects ?? [];
    for (const o of objs) {
      if (o.name !== 'sanctum_return') continue;
      const zone = new InteractionZone(this, o, () => this.scene.start('CampScene'));
      this.physics.add.overlap(this.player, zone.overlapZone);
      this.zones.push(zone);
    }
  }

  /** Per-frame: show the prompt for the nearest overlapping zone. */
  private updateActiveZone(): void {
    const px = this.player.x;
    const py = this.player.y;
    const overlapping = this.zones.filter((z) => z.contains(px, py));
    let nearest: InteractionZone | null = null;
    let best = Infinity;
    for (const z of overlapping) {
      const d = z.distanceSqTo(px, py);
      if (d < best) {
        best = d;
        nearest = z;
      }
    }
    if (nearest !== this.activeZone) {
      this.activeZone?.setActive(false);
      nearest?.setActive(true);
      this.activeZone = nearest;
    }
    window.__sanctumZones = overlapping.map((z) => z.name);
  }
}
