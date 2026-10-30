import { readFileSync } from 'node:fs';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import type { Picked } from '../src/dev/sandbox-selection.ts';
import { t, type MessageKey } from '../src/i18n/dict.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const tinyMap: unknown = JSON.parse(
  readFileSync(new URL('../../../packages/mapgen/maps/tiny.json', import.meta.url), 'utf8'),
);
const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const loadedMap = loaded.map;
const engine = createLocalEngine(tinyMap, 42, 2);
if ('errors' in engine) throw new Error(engine.errors.join('; '));
const source = engine.snapshot();

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/match');
});

async function renderSelected(
  units: typeof source.view.units,
  ids: readonly number[],
  initialIds: readonly number[] = ids,
) {
  const view = { ...source.view, units };
  const snapshot = { ...source, view, snapshot: { ...source.snapshot, view } };
  const send = vi.fn();
  vi.doMock('../src/match/MatchSurfaceRuntime.tsx', () => ({
    useMapJson: () => ({ json: tinyMap, map: loadedMap }),
    useSandbox: () => {
      const [picked, setPicked] = useState<Picked>({
        hex: null,
        units: [...initialIds],
        target: null,
      });
      return {
        msg: snapshot,
        replay: [],
        error: null,
        picked,
        lastReject: null,
        tool: null,
        army: null,
        fog: true,
        paused: false,
        speed: 1,
        observerId: null,
        events: [],
        workerTelemetry: null,
        snapshotTelemetry: () => ({ received: 0, collected: 0, live: 0 }),
        cacheTelemetry: () => ({
          unit: { shown: 0, drawnAt: 0, chips: 0, encircledSince: 0 },
          economy: { capturesByHex: 0, cityFlashes: 0 },
          frontTween: { byArmy: 0 },
        }),
        focusEvent: vi.fn(),
        send,
        setFog: vi.fn(),
        setPaused: vi.fn(),
        step: vi.fn(),
        setSpeed: vi.fn(),
        setObserver: vi.fn(),
        pick: (nextPicked: Picked) => setPicked(nextPicked),
        setTool: vi.fn(),
        setArmy: vi.fn(),
        setRoadPreview: vi.fn(),
        setDockHeight: vi.fn(),
        pixiTelemetry: () => ({
          objects: 0,
          text: 0,
          graphics: 0,
          graphicsInstructions: [],
          graphicsDetails: [],
          textures: 0,
          canvasTextTextures: null,
        }),
      };
    },
  }));
  const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
  render(<MatchSurface />);
  return send;
}

function ownUnit() {
  const unit = source.view.units.find((item) => item.owner === source.view.playerId);
  if (!unit) throw new Error('свой отряд не найден');
  return unit;
}

describe('07/T17br: слияние из карточки выбранных отрядов', () => {
  it('отправляет merge с id выбранных отрядов из реального MatchSurface', async () => {
    const template = ownUnit();
    const first = { ...template, id: 9801 };
    const second = { ...template, id: 9802 };
    const send = await renderSelected([first, second], [first.id, second.id]);

    const card = screen.getByRole('region', { name: t('unit.groups') });
    expect(card.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('button', { name: t('unit.merge') })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('unit.merge') }));
    expect(send).toHaveBeenCalledWith({ t: 'merge', unitIds: [first.id, second.id] });
  });

  it.each([
    ['одного отряда', null, 'unit.mergeNeedMore'],
    [
      'разных типов',
      (unit: ReturnType<typeof ownUnit>) => ({ ...unit, type: 'armor' as const, id: 9802 }),
      'unit.mergeDifferentTypes',
    ],
    [
      'из разных гексов',
      (unit: ReturnType<typeof ownUnit>) => ({ ...unit, hex: unit.hex + 1, id: 9802 }),
      'unit.mergeDifferentHexes',
    ],
  ] as const)(
    'не отправляет merge при выборе %s и показывает причину',
    async (_case, alter, reason) => {
      const template = ownUnit();
      const first = { ...template, id: 9801 };
      const second = alter?.({ ...template, id: 9802 }) ?? null;
      const units = second ? [first, second] : [first];
      const send = await renderSelected(units, second ? [first.id, second.id] : [first.id]);

      const card = second
        ? screen.getByRole('region', { name: t('unit.groups') })
        : screen.getByRole('region', {
            name: `${t(`unit.${first.type}` as MessageKey)} · ${formatSoldiers(first.soldiers)}`,
          });
      expect(card.querySelectorAll('li')).toHaveLength(second ? 2 : 0);
      expect(screen.queryByRole('button', { name: t('unit.merge') })).toBeNull();
      expect(screen.getByRole('status').textContent).toBe(t(reason as MessageKey));
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('показывает причину после выбора строки отступающего отряда', async () => {
    const template = ownUnit();
    const first = { ...template, id: 9801 };
    const second = { ...template, id: 9802 };
    const retreating = { ...template, id: 9803, order: 'retreat' as const };
    await renderSelected([first, second, retreating], [first.id, second.id]);

    const row = screen
      .getAllByRole('button', {
        name: `${t(`unit.${retreating.type}` as MessageKey)} · ${formatSoldiers(retreating.soldiers)}`,
      })
      .find((button) => button.getAttribute('aria-pressed') === 'false');
    expect(row).toBeTruthy();
    if (!row) throw new Error('Строка отступающего отряда не найдена');
    fireEvent.click(row);

    expect(screen.getByRole('status').textContent).toBe(t('reason.retreating'));
  });
});
