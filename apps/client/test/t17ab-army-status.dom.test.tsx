import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fp, OFFENSIVE_STOP_ORG, ORG_MAX, type UnitView } from '@hexfront/sim';

import { ArmyBar, armyStats } from '../src/dev/ArmyBar.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import { tokens } from '../src/theme/tokens.ts';

const PROJECT_ROOT =
  path.basename(process.cwd()) === 'client'
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
const mapJson: unknown = JSON.parse(
  readFileSync(path.resolve(PROJECT_ROOT, 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

function unit(overrides: Partial<UnitView> = {}): UnitView {
  return {
    id: 1,
    owner: 0,
    type: 'infantry',
    soldiers: fp(100),
    org: ORG_MAX,
    hex: 0,
    order: 'idle',
    inBattle: false,
    target: -1,
    moveTicks: 0,
    moveTotal: 0,
    supplyLevel: fp(1),
    encircled: false,
    starving: false,
    armyId: 1,
    path: [],
    fireTarget: -1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('индикаторы состояния армии', () => {
  it('агрегирует бой и окружение для пустого и смешанного набора', () => {
    expect(armyStats([])).toMatchObject({ fighting: false, encircled: 0 });
    expect(
      armyStats([
        unit({ id: 1, inBattle: true, encircled: true }),
        unit({ id: 2, inBattle: false, encircled: false }),
        unit({ id: 3, inBattle: true, encircled: true }),
      ]),
    ).toMatchObject({ fighting: true, encircled: 2 });
  });

  it('показывает индикаторы только для активных состояний и красит низкую организацию', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const army = view.armies[0];
    if (!army) throw new Error('В тестовом снимке нет армии');
    const armyUnits = view.units.filter((candidate) => candidate.armyId === army.id);
    const belowStop = fp(29);
    expect(belowStop).toBeLessThan(OFFENSIVE_STOP_ORG);
    const units = armyUnits.map((candidate) =>
      unit({
        ...candidate,
        id: candidate.id,
        armyId: army.id,
        org: belowStop,
        inBattle: true,
        encircled: true,
        starving: true,
      }),
    );
    if (units.length === 0) throw new Error('В тестовом снимке нет отрядов армии');
    const stuckPlan = {
      armyId: army.id,
      kind: 'front' as const,
      edges: [],
      hexes: [],
      offensive: null,
      zone: [],
      stuck: true,
      facing: [],
      lost: [],
      startWanted: false,
    };
    const onPick = vi.fn();
    const onSelect = vi.fn();
    const onTool = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );
    const rendered = render(
      createElement(ArmyBar, {
        view: { ...view, units, plans: [...view.plans, stuckPlan] },
        selected: null,
        partial: [],
        onSelect,
        send: vi.fn(),
        onPick,
        tool: null,
        onTool,
      }),
    );

    expect(screen.getByTitle('В бою')).toBeTruthy();
    expect(screen.getByTitle('В окружении')).toBeTruthy();
    expect(screen.getByTitle(/Истощение/)).toBeTruthy();
    expect(screen.getByTitle('Упёрлись')).toBeTruthy();
    expect(screen.getByTitle('Автокомандование включено')).toBeTruthy();
    const orgMeter = document.querySelector('[title^="Орг."] span > span');
    const dangerProbe = document.createElement('span');
    dangerProbe.style.background = tokens.status.danger;
    expect(orgMeter?.getAttribute('style')).toContain(
      `background: ${dangerProbe.style.background}`,
    );

    rendered.rerender(
      createElement(ArmyBar, {
        view: {
          ...view,
          units: units.map((candidate) => ({ ...candidate, inBattle: false, encircled: false })),
          plans: [...view.plans, stuckPlan],
        },
        selected: null,
        partial: [],
        onSelect,
        send: vi.fn(),
        onPick,
        tool: null,
        onTool,
      }),
    );
    expect(screen.queryByTitle('В бою')).toBeNull();
    expect(screen.queryByTitle('В окружении')).toBeNull();
  });
});
