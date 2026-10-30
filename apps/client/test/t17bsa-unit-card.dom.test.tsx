import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FP, loadMap, MAX_UNITS_PER_HEX, type Fp } from '@hexfront/sim';

import { UnitCard } from '../src/dev/UnitCard.tsx';
import { t, type MessageKey } from '../src/i18n/dict.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';
const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loadedMap = loadMap(mapJson);
if (!loadedMap.ok) throw new Error(loadedMap.errors.join('; '));
const map = loadedMap.map;

afterEach(cleanup);

function selectedCard(soldiers: number, options?: { retreat?: boolean; full?: boolean }) {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const source = engine.snapshot().view;
  const template = source.units.find((unit) => unit.owner === source.playerId);
  if (!template) throw new Error('для фикстуры нужен собственный отряд');
  const unit = {
    ...template,
    id: 9701,
    soldiers: soldiers as Fp,
    order: options?.retreat ? ('retreat' as const) : ('idle' as const),
  };
  const peers = options?.full
    ? Array.from({ length: MAX_UNITS_PER_HEX - 1 }, (_, index) => ({
        ...unit,
        id: 9702 + index,
        soldiers: FP as Fp,
      }))
    : [];
  const units = [
    ...source.units.filter((item) => item.owner !== source.playerId || item.hex !== unit.hex),
    unit,
    ...peers,
  ];
  const view = { ...source, units };
  const send = vi.fn();
  const label = `${t(`unit.${unit.type}` as MessageKey)} · ${formatSoldiers(unit.soldiers)}`;
  render(
    <UnitCard
      view={view}
      map={map}
      picked={{ hex: null, units: [unit.id], target: null }}
      send={send}
      onPick={() => undefined}
    />,
  );
  expect(screen.getByRole('region', { name: label })).toBeTruthy();
  return { send };
}

describe('07/T17bsa: деление пополам кнопкой карточки', () => {
  it.each([
    [120, 60],
    [121, 60],
  ])('передаёт половину целых солдат для %i человек', (people, half) => {
    const { send } = selectedCard(people * FP);
    fireEvent.click(screen.getByRole('button', { name: t('unit.split') }));
    expect(send).toHaveBeenCalledWith({
      t: 'split',
      unitId: 9701,
      soldiers: half * FP,
    });
  });

  it.each([
    [FP, 'unit.splitNeedMore'],
    [10 * FP, 'reason.retreating'],
    [10 * FP, 'reason.hexFull'],
  ] as const)('не отправляет split при причине %s', (soldiers, reason) => {
    const options =
      reason === 'reason.retreating'
        ? { retreat: true }
        : reason === 'reason.hexFull'
          ? { full: true }
          : undefined;
    const { send } = selectedCard(soldiers, options);
    const button = screen.getByRole('button', { name: t('unit.split') }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(t(reason), { selector: '[role="status"]' })).toBeTruthy();
    fireEvent.click(button);
    expect(send).not.toHaveBeenCalled();
  });
});
