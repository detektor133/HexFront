import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  hexFromId,
  hexId,
  loadMap,
  neighbors,
  borderEdges,
  TERRAIN,
  type Command,
  type MapStatic,
  type PlayerView,
} from '@hexfront/sim';

import {
  finishCommand,
  startDraft,
  strokeSegment,
  type DraftContext,
} from '../src/dev/plan-draft.ts';
import { edgeMid } from '../src/dev/plan-edges.ts';
import { createPlanInput, type ToolState } from '../src/dev/plan-tools.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/small.json', import.meta.url), 'utf8'),
);
const radius = tokens.map.hexRadius;

function fixture(): { readonly map: MapStatic; readonly view: PlayerView } {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('\n'));
  const message = engine.tick();
  if (message.t !== 'view') throw new Error('Ожидался снимок матча');
  return { map: loaded.map, view: message.view };
}

describe('07/T17ap: непрерывный росчерк планов', () => {
  it('восстанавливает промежуточные грани одного быстрого росчерка', () => {
    const { map, view } = fixture();
    const edges = borderEdges({ map, hexes: view.hexes }, view.playerId);
    const context: DraftContext = { map, view, radius };
    let draft = startDraft('front', 7);
    for (const from of edges) {
      for (const to of edges) {
        const candidate = strokeSegment(
          context,
          startDraft('front', 7),
          edgeMid(map, radius, from),
          edgeMid(map, radius, to),
        );
        if (candidate.edges.length > 1) {
          draft = candidate;
          break;
        }
      }
      if (draft.edges.length > 1) break;
    }
    expect(draft.edges.length).toBeGreaterThan(1);
    expect(finishCommand(draft)).toEqual({ t: 'assignFront', armyId: 7, edges: draft.edges });
  });

  it('восстанавливает промежуточные гексы одного быстрого росчерка', () => {
    const { map, view } = fixture();
    const context: DraftContext = { map, view, radius };
    const from = view.hexes.owner.findIndex(
      (owner, hex) =>
        owner === view.playerId &&
        map.terrain[hex] !== TERRAIN.water &&
        neighbors(hexFromId(hex, map.width)).some((n) => {
          const other = hexId(n, map.width);
          return map.terrain[other] !== TERRAIN.water && view.hexes.owner[other] === view.playerId;
        }),
    );
    const to = neighbors(hexFromId(from, map.width))
      .map((n) => hexId(n, map.width))
      .find((hex) => map.terrain[hex] !== TERRAIN.water && view.hexes.owner[hex] === view.playerId);
    if (from < 0 || to === undefined) throw new Error('На карте нет двух соседних своих гексов');
    const draft = strokeSegment(
      context,
      startDraft('line', 7),
      hexCenter(hexFromId(from, map.width), radius),
      hexCenter(hexFromId(to, map.width), radius),
    );

    expect(draft.hexes.length).toBeGreaterThan(1);
    expect(draft.hexes).toEqual([from, to]);
    expect(finishCommand(draft)).toEqual({ t: 'setDefenseLine', armyId: 7, points: [from, to] });
  });

  it('отправляет точный приказ при отпускании и не отправляет его при отмене', () => {
    const { map, view } = fixture();
    const context: DraftContext = { map, view, radius };
    const sent: Command[] = [];
    let tool: ToolState | null = {
      tool: 'line',
      armyId: 7,
    };
    const input = createPlanInput({
      context: () => context,
      tool: () => tool,
      selected: () => 7,
      setTool: (next) => {
        tool = next;
      },
      setDraft: () => undefined,
      send: (command) => sent.push(command),
    });
    const startHex = view.hexes.owner.findIndex(
      (owner, hex) => owner === view.playerId && map.terrain[hex] !== TERRAIN.water,
    );
    if (startHex < 0) throw new Error('На карте нет своего сухопутного гекса');
    const from = hexCenter(hexFromId(startHex, map.width), radius);
    const to = from;

    input.stroke(from, 'start');
    input.stroke(to, 'move');
    input.stroke(to, 'end');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'setDefenseLine', armyId: 7 });

    tool = { tool: 'line', armyId: 7 };
    input.stroke(from, 'start');
    input.stroke(to, 'move');
    input.stroke(to, 'cancel');
    expect(sent).toHaveLength(1);
  });
});
