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
  };

  switch (timing) {
    case 'NO_BLOCK':
      r.defenderHeartLost = true;
      break;

    case 'MISTIME':
      r.defenderHeartLost = true;
      if (defenderRing) {
        defenderRing.currentUses = Math.max(0, defenderRing.currentUses - 1);
        defenderRing.isExtinguished = defenderRing.currentUses === 0;
      }
      break;

    case 'BLOCK':
    case 'PARRY':
      if (!defenderRing) break;
      defenderRing.currentUses -= 1;
      if (rel === 'WEAK') {
        defenderRing.currentUses -= 1;
        if (defenderRing.currentUses < 0) r.defenderHeartLost = true;
      } else if (rel === 'STRONG' && timing === 'PARRY') {
        r.rallyContinues = true;
        r.volleyedElement = defenderRing.element;
      }
      defenderRing.currentUses = Math.max(0, defenderRing.currentUses);
      defenderRing.isExtinguished = defenderRing.currentUses === 0;
      break;
  }

  attackerRing.isExtinguished = attackerRing.currentUses === 0;
  return r;
}
