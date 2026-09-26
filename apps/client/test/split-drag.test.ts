import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  hexFromId,
  loadMap,
  type Command,
  type Fp,
  type MapStatic,
  type PlayerView,
  type UnitView,
} from '@hexfront/sim';

import { createSplitGrab, type SplitOverlay } from '../src/dev/split-drag.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const small: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const R = tokens.map.hexRadius;

function start(): { map: MapStatic; view: PlayerView } {
  const loaded = loadMap(small);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const e = createLocalEngine(small, 42, 2);
  if ('errors' in e) throw new Error(e.errors.join('\n'));
  const msg = e.tick();
  if (msg.t !== 'view') throw new Error('ожидался снимок');
  return { map: loaded.map, view: msg.view };
}

describe('деление вытягиванием из фишки (CR-005)', () => {
  const base = start();
  const { map } = base;
  const first = base.view.units.find((u) => u.owner === base.view.playerId);
  if (!first) throw new Error('нет своего отряда');
  // Отряд побольше, чтобы было что крутить на кольце (у стартового 100 — только 50/50).
  const unit: UnitView = { ...first, soldiers: 400_000 as Fp };
  const view = { ...base.view, units: [unit, ...base.view.units.filter((u) => u.id !== unit.id)] };
  const at = hexCenter(hexFromId(unit.hex, map.width), R);
  const setup = (): { sent: Command[]; grab: ReturnType<typeof createSplitGrab> } => {
    const sent: Command[] = [];
    const grab = createSplitGrab({
      context: () => ({ map, view, radius: R }),
      chipAt: () => at,
      send: (cmd) => sent.push(cmd),
      setOverlay: (_o: SplitOverlay | null) => undefined,
    });
    return { sent, grab };
  };

  it('прямо наружу в другой гекс — половина отряда идёт туда', () => {
    const { sent, grab } = setup();
    const h = grab(at);
    expect(h).not.toBeNull();
    const far = { x: at.x, y: at.y - R * 2 };
    h?.({ x: at.x, y: at.y - R * 0.8 }, 'move');
    h?.(far, 'end');
    expect(sent[0]).toMatchObject({ t: 'split', unitId: unit.id, soldiers: unit.soldiers / 2 });
    expect(sent[0]?.t === 'split' && sent[0].to).toBeGreaterThanOrEqual(0);
  });

  it('поворот по кольцу по часовой — берём больше; отпустил на кольце — делим на месте', () => {
    const { sent, grab } = setup();
    const h = grab(at);
    const r = R * 0.95;
    h?.({ x: at.x, y: at.y - r }, 'move');
    h?.({ x: at.x + r, y: at.y }, 'move');
    h?.({ x: at.x + r * 0.7, y: at.y + r * 0.7 }, 'end');
    const cmd = sent[0];
    expect(cmd?.t).toBe('split');
    expect(cmd?.t === 'split' && cmd.soldiers).toBeGreaterThan(unit.soldiers / 2);
    expect(cmd?.t === 'split' && 'to' in cmd).toBe(false);
  });

  it('далеко от фишки захвата нет — карта двигается как обычно', () => {
    const { grab } = setup();
    expect(grab({ x: at.x + R * 3, y: at.y + R * 3 })).toBeNull();
  });
});
