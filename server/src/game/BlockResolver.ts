import { BlockResult } from '../../../shared/types';
import { Ring } from '../schemas/Ring';

export function classifyTiming(offsetMs: number, pressed: boolean, parryMs = 70, blockMs = 180): 'PARRY'|'BLOCK'|'MISTIME'|'NO_BLOCK' {
  if (!pressed) return 'NO_BLOCK';
  const mag = Math.abs(offsetMs);
  if (mag <= parryMs) return 'PARRY';
  if (mag <= blockMs) return 'BLOCK';
  return 'MISTIME';
}

export function resolveBlock(
  attackerRing: Ring,
  defenderRing: Ring | null,
  timing: 'PARRY'|'BLOCK'|'MISTIME'|'NO_BLOCK',
  rel: 'STRONG'|'NEUTRAL'|'WEAK'
): BlockResult {
  const r: BlockResult = {
    timing,
    relationship: rel,
    defenderHeartLost: false,
    attackerHeartLost: false,
    rallyContinues: false,
    volleyedElement: 0,
    gaugeIncreases: false,
  };

  switch (timing) {
    case 'NO_BLOCK':
      // Attack lands fully: heart lost, gauge fills, ring untouched (defender never committed)
      r.defenderHeartLost = true;
      r.gaugeIncreases = true;
      break;

    case 'MISTIME':
      // Defender committed but missed the window: heart lost, gauge fills, ring pays 1 use
      r.defenderHeartLost = true;
      r.gaugeIncreases = true;
      if (defenderRing) {
        defenderRing.currentUses = Math.max(0, defenderRing.currentUses - 1);
        defenderRing.isExtinguished = defenderRing.currentUses === 0;
      }
      break;

    case 'BLOCK':
    case 'PARRY':
      // Defender caught the attack — gauge never fills regardless of element
      if (!defenderRing) break;
      defenderRing.currentUses = Math.max(0, defenderRing.currentUses - 1);
      defenderRing.isExtinguished = defenderRing.currentUses === 0;
      if (rel === 'WEAK') {
        // Caught it but wrong element — costs a heart, no gauge
        r.defenderHeartLost = true;
      } else if (rel === 'STRONG' && timing === 'PARRY') {
        // Perfect counter — rally
        r.rallyContinues = true;
        r.volleyedElement = defenderRing.element;
      }
      break;
  }

  attackerRing.isExtinguished = attackerRing.currentUses === 0;
  return r;
}
