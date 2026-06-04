import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { API_BASE } from '../net/api';
import { addDomLabel, crispCanvasText } from '../objects/ui/DomLabel';

// Stable ids let Playwright target the real <input>/<button> DOM nodes.
const FORM_HTML = `
  <div style="display:flex;flex-direction:column;gap:10px;width:260px;font-family:sans-serif;">
    <input id="er-username" name="username" type="text" placeholder="Username"
           style="padding:8px;font-size:16px;" />
    <input id="er-password" name="password" type="password" placeholder="Password"
           style="padding:8px;font-size:16px;" />
    <div style="display:flex;gap:10px;">
      <button id="er-login-btn" type="button" style="flex:1;padding:8px;font-size:16px;">Login</button>
      <button id="er-register-btn" type="button" style="flex:1;padding:8px;font-size:16px;">Register</button>
    </div>
  </div>`;

/**
 * Login / registration screen. Renders real DOM <input> elements via Phaser's
 * DOM container (enabled by `dom: { createContainer: true }` in main.ts). On a
 * successful login or register it stores the JWT in localStorage and routes to
 * CampScene; on failure it shows an in-scene error. All auth logic lives on the
 * server — this scene only collects credentials and posts them.
 */
export class LoginScene extends Phaser.Scene {
  private errorText!: Phaser.GameObjects.Text;
  private titleLabel: Phaser.GameObjects.DOMElement | null = null;

  constructor() {
    super({ key: 'LoginScene' });
  }

  create(): void {
    // #382 — "ELEMENTAL RINGS" title is screen-fixed, scene-level, never
    // occluded → addDomLabel (crisp DOM text at native resolution).
    this.titleLabel = addDomLabel(this, CANVAS_W / 2, CANVAS_H / 2 - 120, 'ELEMENTAL RINGS', {
      fontPx: 32,
      color: '#ffffff',
      id: 'login-title',
    });

    const form = this.add.dom(CANVAS_W / 2, CANVAS_H / 2).createFromHTML(FORM_HTML);

    // #382 — errorText updates text dynamically but does not change color.
    // crispCanvasText (not addDomLabel) so we keep the Phaser.Text.setText API
    // used throughout submit().
    this.errorText = crispCanvasText(
      this.add
        .text(CANVAS_W / 2, CANVAS_H / 2 + 110, '', { fontSize: '16px', color: '#ff6666' })
        .setOrigin(0.5)
        .setName('er-error'),
    );

    const loginBtn = form.getChildByID('er-login-btn') as HTMLButtonElement | null;
    const registerBtn = form.getChildByID('er-register-btn') as HTMLButtonElement | null;
    loginBtn?.addEventListener('click', () => void this.submit('login', form));
    registerBtn?.addEventListener('click', () => void this.submit('register', form));

    // Tear down the DOM title label when the scene stops so reloading does not
    // leave a duplicate node (no-op if Phaser has already cleared it).
    this.events.once('shutdown', () => {
      this.titleLabel?.destroy();
      this.titleLabel = null;
    });
  }

  /** Read the credentials, POST to the chosen auth endpoint, and route on success. */
  private async submit(
    mode: 'login' | 'register',
    form: Phaser.GameObjects.DOMElement,
  ): Promise<void> {
    this.errorText.setText('');
    const username = (form.getChildByID('er-username') as HTMLInputElement | null)?.value ?? '';
    const password = (form.getChildByID('er-password') as HTMLInputElement | null)?.value ?? '';
    if (!username || !password) {
      this.errorText.setText('Username and password are required');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        this.errorText.setText(data?.error ?? `Request failed (${res.status})`);
        return;
      }
      const { token } = await res.json();
      if (typeof token !== 'string' || !token) {
        this.errorText.setText('Malformed server response');
        return;
      }
      localStorage.setItem('er_token', token);
      this.scene.start('CampScene');
    } catch {
      this.errorText.setText('Network error — could not reach the server');
    }
  }
}
