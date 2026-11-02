import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, type PlayerView, type UnitView } from '@hexfront/sim';

import { installMatchMocks } from './t17q-match.ts';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import { armyName } from '../src/dev/army-name.ts';
import type { Picked } from '../src/dev/sandbox-selection.ts';
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

function unitPlateLabel(view: PlayerView, unit: UnitView): string {
  const viewedUnit = view.units.find((item) => item.id === unit.id) ?? unit;
  const army = view.armies.find((item) => item.id === viewedUnit.armyId);
  const armyLabel = army ? armyName(army) : t('army.reserve');
  return `${t(`unit.${unit.type}` as MessageKey)} · ${formatSoldiers(unit.soldiers)} · ${armyLabel}`;
}

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
    const first = {
      ...templateUnit,
      id: 9101,
      type: 'infantry' as const,
      soldiers: 110_000 as typeof templateUnit.soldiers,
    };
    const second = {
      ...templateUnit,
      id: 9102,
      type: 'armor' as const,
      soldiers: 120_000 as typeof templateUnit.soldiers,
    };
    const third = {
      ...templateUnit,
      id: 9103,
      type: 'artillery' as const,
      soldiers: 130_000 as typeof templateUnit.soldiers,
    };
    const fourth = {
      ...templateUnit,
      id: 9100,
      type: 'armor' as const,
      soldiers: 140_000 as typeof templateUnit.soldiers,
    };
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
    const groups = Array.from(card.querySelectorAll('h3'), (heading) => {
      const group = heading.closest('section');
      if (!group) throw new Error('заголовок группы должен находиться внутри группы');
      return {
        heading: heading.textContent,
        rows: Array.from(group.querySelectorAll('li'), (row) => row.textContent),
      };
    });
    expect(groups).toEqual([
      {
        heading: '1',
        rows: [formatSoldiers(fourth.soldiers), formatSoldiers(third.soldiers)],
      },
      {
        heading: '2',
        rows: [formatSoldiers(first.soldiers)],
      },
      {
        heading: t('army.reserve'),
        rows: [formatSoldiers(second.soldiers)],
      },
    ]);
    for (const unit of [first, second, third, fourth]) {
      const label = unitPlateLabel(view, unit);
      const plate = screen.getByRole('button', { name: label });
      expect(plate.getAttribute('aria-pressed')).toBe('true');
      expect(plate.textContent).toBe(formatSoldiers(unit.soldiers));
      expect(plate.querySelector(`[data-unit-type="${unit.type}"]`)).toBeTruthy();
    }
    for (const army of armies) {
      const label = armyName(army);
      const groupButton = screen.getByRole('button', { name: label });
      expect(groupButton.textContent).toBe(String(army.number));
      expect(groupButton.getAttribute('aria-pressed')).toBe('true');
    }
    expect(container.textContent).not.toContain('Выбрано отрядов');
  });

  it('сохраняет Picked при переключении плашки отряда', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot().view;
    const template = source.units.find(
      (item) => item.owner === source.playerId && item.armyId !== null,
    );
    if (!template || template.armyId === null) {
      throw new Error('для фикстуры нужен отряд своей армии');
    }
    const unit = { ...template, id: 9701 };
    const peer = {
      ...template,
      id: 9702,
      soldiers: (template.soldiers + 1_000) as typeof template.soldiers,
    };
    const view = {
      ...source,
      units: [...source.units.filter((item) => item.owner !== source.playerId), unit, peer],
    };
    const army = source.armies.find((item) => item.id === unit.armyId);
    if (!army) throw new Error('для фикстуры нужна армия отряда');
    const label = unitPlateLabel(source, unit);
    const onPick = vi.fn<(picked: Picked) => void>();

    render(
      <UnitCard
        view={view}
        map={map}
        picked={{ hex: null, units: [unit.id, peer.id], target: null }}
        send={() => undefined}
        onPick={onPick}
      />,
    );
    const plate = screen.getByRole('button', { name: label });
    expect(plate.getAttribute('aria-label')).toBe(label);
    expect(plate.getAttribute('title')).toBe(label);
    expect(plate.getAttribute('aria-pressed')).toBe('true');
    expect(plate.textContent).toBe(formatSoldiers(unit.soldiers));

    fireEvent.click(plate);

    expect(onPick).toHaveBeenCalledWith({ hex: null, units: [peer.id], target: null });
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
    const { getSelection, getChipBounds } = installMatchMocks(engine, mapJson);
    window.history.replaceState({}, '', '/?debug=1');
    const { MatchPage } = await import('../src/match/MatchPage.tsx');

    render(<MatchPage />);
    const onboardingButton = await screen.findByRole('button', { name: t('onboarding.disable') });
    fireEvent.click(onboardingButton);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: t('onboarding.disable') })).toBeNull(),
    );
    await waitFor(() => expect(getSelection()).toBeDefined());
    const bounds = getChipBounds()?.(unit.id);
    if (!bounds) throw new Error('видимая область фишки не подготовлена');
    getSelection()?.(
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
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

describe('07/T17bdb: выбор из сгруппированной карточки', () => {
  it('переключает строку и всю группу, а одиночный выбор показывает подробности', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot().view;
    const army = source.armies[0];
    const template = source.units.find((unit) => unit.owner === source.playerId);
    if (!army || !template) throw new Error('фикстуре нужны армия и свой отряд');
    const otherArmy = { ...army, id: 9902, number: army.number + 1 };
    const first = {
      ...template,
      id: 9201,
      armyId: army.id,
      soldiers: 101_000 as typeof template.soldiers,
    };
    const second = {
      ...template,
      id: 9202,
      armyId: army.id,
      soldiers: 102_000 as typeof template.soldiers,
    };
    const reserve = {
      ...template,
      id: 9203,
      armyId: null,
      soldiers: 103_000 as typeof template.soldiers,
    };
    const otherArmyUnit = {
      ...template,
      id: 9204,
      armyId: otherArmy.id,
      soldiers: 104_000 as typeof template.soldiers,
    };
    const view = {
      ...source,
      armies: [...source.armies, otherArmy],
      units: [...source.units, first, second, reserve, otherArmyUnit],
    };
    const send = vi.fn();

    function InteractiveCard(): React.JSX.Element | null {
      const [picked, setPicked] = useState<Picked>({
        hex: null,
        units: [first.id, reserve.id, otherArmyUnit.id],
        target: null,
      });
      return <UnitCard view={view} map={map} picked={picked} send={send} onPick={setPicked} />;
    }

    render(<InteractiveCard />);
    const secondRow = unitPlateLabel(view, second);
    const secondButton = screen.getByRole('button', { name: secondRow });
    expect(secondButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(secondButton);
    expect(screen.getByRole('button', { name: secondRow }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      screen
        .getByRole('button', {
          name: unitPlateLabel(view, reserve),
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', {
          name: unitPlateLabel(view, otherArmyUnit),
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: secondRow }));
    expect(screen.getByRole('button', { name: secondRow }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(
      screen
        .getByRole('button', {
          name: unitPlateLabel(view, reserve),
        })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: secondRow }));
    expect(screen.getByRole('button', { name: secondRow }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    const otherGroupLabel = armyName(otherArmy);
    expect(screen.getByRole('button', { name: otherGroupLabel })).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: unitPlateLabel(view, otherArmyUnit),
      }),
    ).toBeTruthy();

    const groupButton = screen.getByRole('button', {
      name: armyName(army),
    });
    expect(groupButton.textContent).toBe(String(army.number));
    expect(groupButton.textContent).not.toContain(armyName(army));
    fireEvent.click(groupButton);
    expect(groupButton.getAttribute('aria-pressed')).toBe('true');
    const armyGroup = groupButton.closest('section');
    if (!armyGroup) throw new Error('группа армии не найдена');
    const armyUnitButtons = Array.from(armyGroup.querySelectorAll('ul button[aria-pressed]'));
    expect(armyUnitButtons).toHaveLength(
      view.units.filter((unit) => unit.owner === view.playerId && unit.armyId === army.id).length,
    );
    for (const unitButton of armyUnitButtons) {
      expect(unitButton.getAttribute('aria-pressed')).toBe('true');
    }
    expect(screen.getByRole('button', { name: secondRow }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: armyName(army) }));
    fireEvent.click(screen.getByRole('button', { name: otherGroupLabel }));
    expect(screen.queryByRole('region', { name: t('unit.groups') })).toBeNull();
    const detailed = `${t(`unit.${reserve.type}` as MessageKey)} · ${formatSoldiers(reserve.soldiers)}`;
    expect(screen.getByRole('region', { name: detailed })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: t('unit.close') }));
    expect(screen.queryByRole('region', { name: detailed })).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('после снятия строки оставляет подробную карточку оставшегося отряда', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const source = engine.snapshot().view;
    const army = source.armies[0];
    const template = source.units.find((unit) => unit.owner === source.playerId);
    if (!army || !template) throw new Error('фикстуре нужны армия и свой отряд');
    const first = {
      ...template,
      id: 9301,
      armyId: army.id,
      soldiers: 111_000 as typeof template.soldiers,
    };
    const second = {
      ...template,
      id: 9302,
      armyId: army.id,
      soldiers: 112_000 as typeof template.soldiers,
    };
    const view = { ...source, units: [...source.units, first, second] };
    function InteractiveCard(): React.JSX.Element | null {
      const [picked, setPicked] = useState<Picked>({
        hex: null,
        units: [first.id, second.id],
        target: null,
      });
      return (
        <UnitCard view={view} map={map} picked={picked} send={() => undefined} onPick={setPicked} />
      );
    }
    render(<InteractiveCard />);
    const firstRow = unitPlateLabel(view, first);
    fireEvent.click(screen.getByRole('button', { name: firstRow }));
    const remaining = `${t(`unit.${second.type}` as MessageKey)} · ${formatSoldiers(second.soldiers)}`;
    expect(screen.getByRole('region', { name: remaining })).toBeTruthy();
    expect(screen.getByText(t('unit.org'))).toBeTruthy();
  });
});
