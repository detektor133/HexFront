import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexFromId, loadMap } from '@hexfront/sim';

import { installMatchMocks } from './t17q-match.ts';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import type { Picked } from '../src/dev/sandbox-selection.ts';
import { t, type MessageKey } from '../src/i18n/dict.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { hexCenter } from '../src/render/hex-geometry.ts';
import { tokens } from '../src/theme/tokens.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const loadedMap = loadMap(mapJson);
if (!loadedMap.ok) throw new Error(loadedMap.errors.join('; '));
const map = loadedMap.map;

afterEach(cleanup);

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
    const unit = view.units.find(
      (item) => item.owner === view.playerId && item.order !== 'retreat',
    );
    if (!unit) throw new Error('свой отряд не найден');
    const { getSelection } = installMatchMocks(engine, mapJson);
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const onboardingButton = screen.queryByRole('button', { name: 'Понятно' });
    if (onboardingButton) fireEvent.click(onboardingButton);
    await waitFor(() => expect(getSelection()).toBeDefined());
    const unitsAtHex = view.units.filter(
      (item) => item.hex === unit.hex && item.owner === view.playerId && item.order !== 'retreat',
    );
    const cardName =
      unitsAtHex.length === 1
        ? `${t(`unit.${unit.type}` as MessageKey)} · ${formatSoldiers(unit.soldiers)}`
        : `${t('unit.selected' as MessageKey)}: ${unitsAtHex.length} · ${formatSoldiers(
            unitsAtHex.reduce((total, item) => total + item.soldiers, 0),
          )}`;
    expect(screen.queryByRole('region', { name: cardName })).toBeNull();
    const center = hexCenter(hexFromId(unit.hex, map.width), tokens.map.hexRadius);
    getSelection()?.(
      { x: center.x - 1, y: center.y - 1 },
      { x: center.x + 1, y: center.y + 1 },
      'end',
    );
    const selectedCard = await screen.findByRole('region', { name: cardName });
    expect(selectedCard.getAttribute('aria-label')).toBe(cardName);

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      const cardWithPreviousLabel = screen
        .queryAllByRole('region')
        .find((card) => card.getAttribute('aria-label') === cardName);
      expect(cardWithPreviousLabel).toBeUndefined();
    });
  });
});
