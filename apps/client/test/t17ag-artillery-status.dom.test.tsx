import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMap, type UnitView } from '@hexfront/sim';

import { UnitCard } from '../src/dev/UnitCard.tsx';
import { t } from '../src/i18n/dict.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));

afterEach(cleanup);

function unit(source: UnitView, overrides: Partial<UnitView>): UnitView {
  return { ...source, artillerySupport: false, ...overrides };
}

describe('T17ag: подсказка артиллерии в карточке отряда', () => {
  it('показывает локализованный статус для обстрела, поддержки и отсутствия цели', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const snapshot = engine.snapshot();
    const source = snapshot.view.units[0];
    if (!source) throw new Error('В снимке нет отряда');

    const renderCard = (candidate: UnitView): void => {
      render(
        <UnitCard
          view={{ ...snapshot.view, units: [candidate] }}
          map={mapResult.map}
          picked={{ hex: null, units: [candidate.id], target: null }}
          send={() => undefined}
          onPick={() => undefined}
        />,
      );
    };

    renderCard(unit(source, { type: 'artillery', fireTarget: 2 }));
    expect(screen.getByRole('status', { name: t('unit.artilleryFiring') })).toBeTruthy();
    cleanup();

    renderCard(unit(source, { type: 'infantry', artillerySupport: true }));
    expect(screen.getByRole('status', { name: t('unit.artillerySupport') })).toBeTruthy();
    cleanup();

    renderCard(unit(source, { type: 'artillery', fireTarget: -1 }));
    expect(screen.getByRole('status', { name: t('unit.artilleryNoTarget') })).toBeTruthy();
  });
});
