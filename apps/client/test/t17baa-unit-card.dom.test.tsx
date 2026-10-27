import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { installMatchMocks } from './t17q-match.ts';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import type { Picked } from '../src/dev/sandbox-selection.ts';
import { t, type MessageKey } from '../src/i18n/dict.ts';
import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const loadedMap = loadMap(mapJson);
if (!loadedMap.ok) throw new Error(loadedMap.errors.join('; '));
const map = loadedMap.map;

describe('07/T17baa: закрытие карточки отряда', () => {
  it('закрывает выбранный отряд локализованной кнопкой без игровой команды', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const unit = view.units.find((item) => item.owner === view.playerId);
    if (!unit) throw new Error('свой отряд не найден');
    const unitId = unit.id;

    const send = vi.fn();
    function SelectedUnit(): React.JSX.Element | null {
      const [picked, setPicked] = useState<Picked>({
        hex: null,
        units: [unitId],
        target: null,
      });
      return <UnitCard view={view} map={map} picked={picked} send={send} onPick={setPicked} />;
    }

    render(<SelectedUnit />);
    const closeLabel = t('unit.close' as MessageKey);
    expect(closeLabel).toBeTruthy();
    const closeButton = screen.getByRole('button', { name: closeLabel });
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton);
    expect(screen.queryByRole('button', { name: closeLabel })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('критерий 2 и 4: Esc снимает выбор отряда и закрывает карточку', async () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const unit = view.units.find((item) => item.owner === view.playerId);
    if (!unit) throw new Error('свой отряд не найден');
    const { getTap } = installMatchMocks(engine, mapJson);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const onboardingButton = screen.queryByRole('button', { name: 'Понятно' });
    if (onboardingButton) fireEvent.click(onboardingButton);
    await waitFor(() => expect(getTap()).toBeDefined());
    const hex = hexFromId(unit.hex, map.width);
    getTap()?.(hex, 'select', { x: 0, y: 0 });
    await waitFor(() => expect(document.querySelector('section[class*="card"]')).not.toBeNull());

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(document.querySelector('section[class*="card"]')).toBeNull());
  });
});
