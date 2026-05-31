declare const __SERVER_URL__: string;
const _WS_CA = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE_CA = _WS_CA.replace(/^ws/, 'http');

export interface RestResult {
  spirit_current: number;
  food_units: number;
  game_day: number;
}

export interface SummonResult {
  anchor: string;
  spirit_current: number;
  spiritCost: number;
}

/** POST /api/camp/sleep — spend 25 food, restore spirit to max, advance game day. */
export async function restAtCamp(
  _apiBase: string,
  token: string,
): Promise<RestResult | { error: string }> {
  try {
    const res = await fetch(`${API_BASE_CA}/api/camp/sleep`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: (body as { error?: string }).error ?? `Sleep failed (${res.status})` };
    }
    const meRes = await fetch(`${API_BASE_CA}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return { error: 'Could not read updated state' };
    const meData = (await meRes.json()) as {
      player: { spirit_current: number; food_units: number; game_day: number };
    };
    return {
      spirit_current: meData.player.spirit_current,
      food_units: meData.player.food_units,
      game_day: meData.player.game_day,
    };
  } catch {
    return { error: 'Network error during rest' };
  }
}

/** POST /api/sanctum/summon — re-anchor the Sanctum to the given anchorage. */
export async function summonSanctum(
  _apiBase: string,
  token: string,
  anchorageId: string,
): Promise<SummonResult | { error: string }> {
  try {
    const res = await fetch(`${API_BASE_CA}/api/sanctum/summon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anchorageId }),
    });
    const body = await res.json().catch(() => ({})) as {
      anchor?: string;
      spirit_current?: number;
      spiritCost?: number;
      error?: string;
    };
    if (!res.ok) {
      const errMsg = body.error ?? `Summon failed (${res.status})`;
      const spiritMatch = errMsg.match(/requires?\s+(\d+)\s+spirit/i);
      return {
        error: spiritMatch ? `Need ${spiritMatch[1]} spirit — rest first` : errMsg,
      };
    }
    return {
      anchor: body.anchor ?? anchorageId,
      spirit_current: body.spirit_current ?? 0,
      spiritCost: body.spiritCost ?? 0,
    };
  } catch {
    return { error: 'Network error during summon' };
  }
}
