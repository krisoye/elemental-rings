import Phaser from 'phaser';

/**
 * DomLabel — crisp HiDPI UI text rendered as a real DOM element layered over the
 * WebGL canvas (EPIC #361).
 *
 * The game runs `render: { pixelArt: true }` (main.ts), which forces gl.NEAREST
 * filtering + `image-rendering: pixelated` on the canvas. On fractional-DPI
 * displays the whole canvas is nearest-upscaled to physical pixels, so any
 * in-canvas text is irrecoverably soft regardless of how cleanly it was drawn.
 *
 * The robust fix is to render SCREEN-FIXED UI text as DOM nodes: the browser
 * composites DOM text at native physical resolution — perfectly crisp at any DPR
 * — while the pixel-art canvas is untouched. Phaser's DOM container is already
 * enabled via `dom: { createContainer: true }` in main.ts.
 *
 * PARITY CONSTRAINT: no `fontFamily` is set anywhere in the canvas text, so all
 * canvas text renders in Phaser's default monospace (Courier). DomLabel defaults
 * to a matching monospace stack so the migration changes CRISPNESS ONLY, never
 * the typeface. Picking a nicer UI font is explicitly out of scope.
 *
 * NOTE ON DEPTH: Phaser DOM elements ALWAYS composite above the entire WebGL
 * canvas — they cannot be occluded by canvas sprites. `setDepth` only orders DOM
 * elements relative to each other, not against canvas content. DomLabel therefore
 * only suits text that never needs to sit BEHIND a canvas sprite (see the
 * carve-out rule in EPIC #361).
 */

/** Default monospace stack — matches Phaser's default canvas font (parity rule). */
export const DOM_LABEL_FONT_FAMILY = "'Courier New', Courier, monospace";

/** A stable class on every DomLabel node so Playwright/E2E can target them. */
export const DOM_LABEL_CLASS = 'er-dom-label';

export interface DomLabelStyle {
  /** Logical px; matches the old `fontSize` (e.g. 14). */
  fontPx: number;
  /** CSS color, e.g. '#ddeeff'. */
  color: string;
  /** Font weight; default 400. */
  weight?: number | string;
  /** Horizontal alignment; default 'center' (matches canvas setOrigin(0.5)). */
  align?: 'left' | 'center' | 'right';
  /** Font family; default MONOSPACE stack — do not change typeface (parity rule). */
  family?: string;
  /** Optional text-shadow for legibility over a busy background. */
  shadow?: boolean;
  /** Line height in px, for two-row labels (e.g. the location label). */
  lineHeight?: number;
  /** Optional CSS background (e.g. 'rgba(0,0,0,0.6)') to mimic a canvas backgroundColor. */
  background?: string;
  /** Optional CSS padding shorthand (e.g. '5px 8px') to mimic canvas text padding. */
  padding?: string;
  /**
   * Optional stable identifier added as a `data-label` attribute (and used to
   * de-dupe / target the node in tests). Does not affect rendering.
   */
  id?: string;
}

/**
 * Create a Phaser DOM element styled as a crisp, screen-fixed text label.
 *
 * Uses `scene.add.dom(x, y, node)` under the hood. The returned DOMElement
 * behaves like any other Phaser GameObject (setVisible, setDepth, destroy) while
 * the underlying text lives at `el.node.textContent`.
 *
 * @param scene  the owning scene
 * @param x      screen x (logical px) — fixed via setScrollFactor(0)
 * @param y      screen y (logical px)
 * @param text   initial text (use '\n' for two-row labels)
 * @param style  DomLabelStyle
 */
export function addDomLabel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: DomLabelStyle,
): Phaser.GameObjects.DOMElement {
  const node = document.createElement('div');
  node.className = DOM_LABEL_CLASS;
  if (style.id) node.setAttribute('data-label', style.id);
  node.textContent = text;

  const align = style.align ?? 'center';
  const css = node.style;
  css.fontFamily = style.family ?? DOM_LABEL_FONT_FAMILY;
  css.fontSize = `${style.fontPx}px`;
  css.color = style.color;
  css.fontWeight = String(style.weight ?? 400);
  css.textAlign = align;
  // PARITY: '\n' must render as a real line break for two-row labels.
  css.whiteSpace = 'pre';
  css.margin = '0';
  // User-select off — these are decorative labels, not selectable copy.
  css.userSelect = 'none';
  if (style.lineHeight !== undefined) css.lineHeight = `${style.lineHeight}px`;
  if (style.shadow) css.textShadow = '0 1px 2px rgba(0,0,0,0.9)';
  if (style.background) css.background = style.background;
  if (style.padding) css.padding = style.padding;

  const el = scene.add.dom(x, y, node);
  // CSS MUST be pointer-events:none so labels never intercept canvas clicks.
  // Phaser's DOMElementCSSRenderer copies `el.pointerEvents` → `node.style.pointerEvents`
  // every frame (defaulting to 'auto'), so setting it on the node inline style is
  // overwritten. Set the Phaser DOMElement property — the correct API — instead.
  el.pointerEvents = 'none';
  // setOrigin(0.5) by default to match canvas setOrigin(0.5); align overrides the
  // horizontal origin so left/right-anchored labels pin to their stated edge.
  const originX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
  el.setOrigin(originX, 0.5);
  // DomLabel is for SCREEN-FIXED text only.
  el.setScrollFactor(0);
  // High depth so DOM ordering is stable relative to other DOM elements.
  el.setDepth(10_000);
  return el;
}

/**
 * Update a DomLabel's text. Thin wrapper over `el.node.textContent`; supports
 * '\n' for two-row labels (the node uses `white-space: pre`).
 *
 * el.updateSize() is called after mutating textContent so Phaser re-measures the
 * DOM node's bounding rect and repositions it correctly for right/center-anchored
 * labels. Without this call, the cached size from creation time is stale after a
 * text change, causing right/center-aligned labels to overflow their intended edge.
 */
export function setDomLabelText(
  el: Phaser.GameObjects.DOMElement | null,
  text: string,
): void {
  // Defensive: a null element (scene torn down) or missing node is a no-op rather
  // than a crash — this simplifies call-site guards.
  if (!el || !el.node) return;
  el.node.textContent = text;
  el.updateSize();
}

/**
 * crispCanvasText — best-effort mitigation for DOM-INELIGIBLE canvas text
 * (EPIC #361 carve-out rule, sub-issue #364).
 *
 * For text that cannot move to DOM — inside scrolling/masked containers,
 * camera/world-space labels, or anything that must interleave in depth with
 * canvas sprites — this raises the glyph-texture resolution and switches the
 * texture's minify/magnify filter to LINEAR.
 *
 * LINEAR+setResolution(ceil) is the accepted ceiling for canvas text on
 * fractional DPI (smoother, not DOM-crisp). This is the ONLY intentional
 * setResolution call site post-revert, and it is ALWAYS paired with the LINEAR
 * filter — never scatter raw setResolution calls elsewhere.
 *
 * Re-render safety: Phaser's `Text.updateText` re-rasterizes the canvas and
 * re-uploads it to the GPU (`canvasToTexture(..., true)` replaces the
 * glTexture), which silently discards any previously-set filter. Every
 * `setText`/`setStyle`/`setColor` funnels through `updateText`, so a one-time
 * filter set at creation is lost on the first mutation, reverting the label to
 * soft/blocky rendering. To stay crisp across re-renders we override the
 * **instance's** `updateText` (NOT the prototype) to re-assert LINEAR after the
 * super-call. See `docs/architecture-overview.md` §7.
 *
 * @returns the same text object, for chaining.
 */
export function crispCanvasText(
  text: Phaser.GameObjects.Text,
): Phaser.GameObjects.Text {
  text.setResolution(Math.ceil(window.devicePixelRatio));
  text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  // Re-apply the LINEAR filter after every re-rasterization. updateText replaces
  // the glTexture, so the filter set above is otherwise discarded on the first
  // setText/setColor. Instance-level override only — never patch the prototype.
  text.updateText = function () {
    Phaser.GameObjects.Text.prototype.updateText.call(this);
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    return this;
  };
  return text;
}
