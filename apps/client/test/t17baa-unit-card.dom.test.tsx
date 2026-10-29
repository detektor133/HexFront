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
  it('показывает выбранные отряды группами по номеру армии и отдельно резерв', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot().view;
    const templateArmy = source.armies[0];
    if (!templateArmy) throw new Error('для фикстуры нужна армия');
    const armies = [
      { ...templateArmy, id: 9001, number: 2, name: '' },
      { ...templateArmy, id: 9002, number: 1, name: '' },
    ];
    const [laterArmy, earlierArmy] = armies;
    if (!laterArmy || !earlierArmy) throw new Error('неполная фикстура армий');
    const templateUnit = source.units.find((unit) => unit.owner === source.playerId);
    if (!templateUnit) throw new Error('для фикстуры нужен свой отряд');
    const first = { ...templateUnit, id: 9101, soldiers: 110_000 as typeof templateUnit.soldiers };
    const second = { ...templateUnit, id: 9102, soldiers: 120_000 as typeof templateUnit.soldiers };
    const third = { ...templateUnit, id: 9103, soldiers: 130_000 as typeof templateUnit.soldiers };
    const fourth = { ...templateUnit, id: 9100, soldiers: 140_000 as typeof templateUnit.soldiers };
    const view = {
      ...source,
      armies: armies.map((army, index) => ({ ...army, number: index === 0 ? 2 : 1 })),
      units: [
        ...source.units,
        { ...first, armyId: laterArmy.id },
        { ...second, armyId: null },
        { ...third, armyId: earlierArmy.id },
        { ...fourth, armyId: earlierArmy.id },
      ],
    };
    const selected = [first.id, second.id, third.id, fourth.id];
    const { container } = render(
      <UnitCard
        view={view}
        map={map}
        picked={{ hex: null, units: selected, target: null }}
        send={() => undefined}
        onPick={() => undefined}
      />,
    );
    const card = screen.getByRole('region', { name: t('unit.groups') });
    const headings = Array.from(card.querySelectorAll('h3'), (heading) => heading.textContent);
    expect(headings).toEqual([
      t('army.numbered').replace('{n}', '1'),
      t('army.numbered').replace('{n}', '2'),
      t('army.reserve'),
    ]);
    expect(Array.from(card.querySelectorAll('li'), (row) => row.textContent)).toEqual([
      `${t(`unit.${fourth.type}` as MessageKey)} · ${formatSoldiers(fourth.soldiers)}`,
      `${t(`unit.${third.type}` as MessageKey)} · ${formatSoldiers(third.soldiers)}`,
      `${t(`unit.${first.type}` as MessageKey)} · ${formatSoldiers(first.soldiers)}`,
      `${t(`unit.${second.type}` as MessageKey)} · ${formatSoldiers(second.soldiers)}`,
    ]);
    expect(container.textContent).not.toContain('Выбрано отрядов');
  });

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
    const closeLabel = t('unit.close');
    expect(closeLabel).toBeTruthy();
    const closeButton = screen.getByRole('button', { name: closeLabel });
    expect(closeButton).toBeTruthy();
    fireEvent.click(closeButton);
    expect(screen.queryByRole('button', { name: closeLabel })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('критерий 2 и 4: Esc снимает выбор отряда и закрывает карточку', async () => {
    const sourceEngine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in sourceEngine) throw new Error(sourceEngine.errors.join('; '));
    const source = sourceEngine.snapshot();
    const unit = source.view.units.find(
      (item) =>
        item.owner === source.view.playerId && item.order !== 'retreat' && item.armyId !== null,
    );
    if (!unit || unit.armyId === null) throw new Error('собственный отряд армии не найден');
    const peerHex =
      (unit.hex + Math.floor((map.width * map.height) / 2)) % (map.width * map.height);
    const selectedView = {
      ...source.view,
      units: source.view.units.map((item) =>
        item.id !== unit.id && item.hex === unit.hex ? { ...item, hex: peerHex } : item,
      ),
    };
    const engine = {
      ...sourceEngine,
      snapshot: () => ({
        ...source,
        view: selectedView,
        snapshot: { ...source.snapshot, view: selectedView },
      }),
    };
    const { getSelection } = installMatchMocks(engine, mapJson);
    window.history.replaceState({}, '', '/?debug=1');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const onboardingButton = await screen.findByRole('button', { name: t('onboarding.disable') });
    fireEvent.click(onboardingButton);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('onboarding.disable') })).toBeNull(),
    );
    await waitFor(() => expect(getSelection()).toBeDefined());
    const center = hexCenter(hexFromId(unit.hex, map.width), tokens.map.hexRadius);
    getSelection()?.(
      { x: center.x - 1, y: center.y - 1 },
      { x: center.x + 1, y: center.y + 1 },
      'end',
    );
    const closeButton = await screen.findByRole('button', { name: t('unit.close') });
    const selectedCard = closeButton.closest('section[aria-label]');
    expect(selectedCard).not.toBeNull();
    if (!selectedCard) throw new Error('карточка выбранного отряда не найдена');
    const expectedCardName = `${t(`unit.${unit.type}` as MessageKey)} · ${formatSoldiers(unit.soldiers)}`;
    expect(selectedCard.getAttribute('aria-label')).toBe(expectedCardName);

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: expectedCardName })).toBeNull();
    });
  });
});
