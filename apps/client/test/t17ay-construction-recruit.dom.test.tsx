import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadMap,
  type ConstructionCheck,
  type Fp,
  type RebuildPlan,
  type RecruitCheck,
} from '@hexfront/sim';

import { HexCard } from '../src/dev/HexCard.tsx';
import { t } from '../src/i18n/dict.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import type { Selection, ViewPayload } from '../src/local/messages.ts';

const projectRoot = process.cwd().endsWith(join('apps', 'client'))
  ? resolve(process.cwd(), '../..')
  : process.cwd();
const mapJson: unknown = JSON.parse(
  readFileSync(join(projectRoot, 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));
const map = mapResult.map;
const FIXED_ONE = 1000 as Fp;
const hexCardCss = readFileSync(
  join(projectRoot, 'apps/client/src/dev/HexCard.module.css'),
  'utf8',
);

function cssRule(className: string): string {
  const rule = hexCardCss.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  if (!rule?.[1]) throw new Error(`CSS-правило .${className} не найдено`);
  return rule[1];
}

describe('кнопка закрытия карточки клетки', () => {
  it('показывает локализованное доступное имя для выбранной клетки', () => {
    const { nonCity, view } = getFixtures();
    expect(nonCity.hex).toBeGreaterThanOrEqual(0);

    render(<HexCard s={nonCity} view={view} map={map} send={() => undefined} />);

    expect(screen.queryByRole('button', { name: t('card.close') })).not.toBeNull();
  });
});

const available: ConstructionCheck = { ok: true, cost: FIXED_ONE, timeS: FIXED_ONE };
const unaffordable: ConstructionCheck = {
  ok: false,
  reason: 'notEnoughGold',
  cost: FIXED_ONE,
  timeS: FIXED_ONE,
};
const forbidden: ConstructionCheck = { ok: false, reason: 'buildingExists' };
const availableRecruit: RecruitCheck = { ok: true, cost: FIXED_ONE, timeS: FIXED_ONE };
const unaffordableRecruit: RecruitCheck = {
  ok: false,
  reason: 'notEnoughGold',
  cost: FIXED_ONE,
  timeS: FIXED_ONE,
};
const forbiddenRecruit: RecruitCheck = { ok: false, reason: 'notEnoughPeople' };

function getFixtures(): {
  readonly city: Selection;
  readonly nonCity: Selection;
  readonly view: ViewPayload['view'];
} {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const city = engine.state.cities.find((item) => item.owner === 0);
  const nonCityHex = engine.state.hexes.owner.findIndex(
    (owner, hex) => owner === 0 && !engine.state.cities.some((item) => item.hex === hex),
  );
  if (!city || nonCityHex < 0) throw new Error('не найдены свои город и обычный гекс');

  engine.select(city.hex);
  const citySelection = engine.snapshot().selection;
  const view = engine.snapshot().view;
  engine.select(nonCityHex);
  const nonCitySelection = engine.snapshot().selection;
  if (!citySelection || !nonCitySelection) throw new Error('карточка выбора не создана');
  return { city: citySelection, nonCity: nonCitySelection, view };
}

function renderCard(selection: Selection, view: ReturnType<typeof getFixtures>['view']) {
  const send = vi.fn();
  render(<HexCard s={selection} view={view} map={map} send={send} />);
  return send;
}

function expectThreeStates(
  makeSelection: (state: 'available' | 'unaffordable' | 'forbidden') => Selection,
  label: RegExp,
): void {
  const { view } = getFixtures();
  const states = ['available', 'unaffordable', 'forbidden'] as const;
  for (const state of states) {
    cleanup();
    const send = renderCard(makeSelection(state), view);
    if (state === 'available') {
      const button = screen.getByRole('button', { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      expect(button.className).toMatch(/\b\S*accent\S*\b/u);
      fireEvent.click(button);
      expect(send).toHaveBeenCalledTimes(1);
    } else if (state === 'forbidden') {
      const button = screen.queryByRole('button', { name: label });
      expect(button).not.toBeNull();
      if (!button) return;
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).not.toMatch(/\b\S*accent\S*\b/u);
      expect(
        screen.queryByText(
          /Не хватает золота|Не хватает людей|Нет пути по своей земле|На гексе уже есть постройка|Максимальный уровень/u,
        ),
      ).not.toBeNull();
      fireEvent.click(button);
      expect(send).not.toHaveBeenCalled();
    } else {
      const button = screen.getByRole('button', { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.className).not.toMatch(/\b\S*accent\S*\b/u);
      expect(
        screen.getByText(
          /Не хватает золота|Не хватает людей|Нет пути по своей земле|На гексе уже есть постройка|Максимальный уровень/u,
        ),
      ).toBeTruthy();
      fireEvent.click(button);
      expect(send).not.toHaveBeenCalled();
    }
  }
  cleanup();
}

describe('07/T17ay: состояния строительства и найма', () => {
  afterEach(cleanup);

  it('07/T17bmcc: отправляет foundCity только для доступного основания города', () => {
    cleanup();
    const { nonCity, view } = getFixtures();
    expect(nonCity.city).toBeNull();
    expect(nonCity.hex).toBeGreaterThanOrEqual(0);

    const send = renderCard({ ...nonCity, foundCity: available }, view);
    expect(screen.getByRole('region')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Основать город/u });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledExactlyOnceWith({ t: 'foundCity', hex: nonCity.hex });

    for (const [check, expectedReason, otherReason] of [
      [unaffordable, 'Не хватает золота', 'Ближе 4 гексов к другому городу'],
      [
        { ok: false, reason: 'cityTooClose' } as ConstructionCheck,
        'Ближе 4 гексов к другому городу',
        'Не хватает золота',
      ],
    ] as const) {
      cleanup();
      const blockedSend = renderCard({ ...nonCity, foundCity: check }, view);
      const blockedButton = screen.getByRole('button', { name: /Основать город/u });
      expect((blockedButton as HTMLButtonElement).disabled).toBe(true);
      const reasonId = blockedButton.getAttribute('aria-describedby');
      expect(reasonId).toBeTruthy();
      expect(document.getElementById(reasonId ?? '')?.textContent).toBe(expectedReason);
      expect(screen.queryByText(otherReason)).toBeNull();
      const reasonElement = document.getElementById(reasonId ?? '');
      expect(reasonElement?.parentElement).toBe(blockedButton.parentElement);
      expect(blockedButton.compareDocumentPosition(reasonElement as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(cssRule('action')).toMatch(/display:\s*flex\s*;/u);
      expect(cssRule('action')).toMatch(/flex-direction:\s*column\s*;/u);
      expect(cssRule(expectedReason.startsWith('Ближе') ? 'hint' : 'reason')).not.toMatch(
        /(?:position:\s*(?:absolute|fixed)|transform:)/u,
      );
      fireEvent.click(blockedButton);
      expect(blockedSend).not.toHaveBeenCalled();
    }
  });

  it('07/T17bmca: отправляет upgradeCity только для доступного улучшения', () => {
    const fixtures = getFixtures();
    const city = fixtures.city.city;
    if (!city) throw new Error('выбранная карточка не содержит город');

    const prepared = {
      ...fixtures.city,
      city: { ...city, upgrade: available },
    };
    expect(prepared.city?.id).toBe(city.id);
    expect(prepared.hex).toBe(city.hex);
    const send = renderCard(prepared, fixtures.view);
    const button = screen.getByRole('button', { name: /Улучшить город/u });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledExactlyOnceWith({ t: 'upgradeCity', cityId: city.id });

    for (const [upgrade, reason] of [
      [unaffordable, 'Не хватает золота'],
      [{ ok: false, reason: 'maxLevel' } as ConstructionCheck, 'Максимальный уровень'],
    ] as const) {
      cleanup();
      const blockedSend = renderCard(
        { ...fixtures.city, city: { ...city, upgrade } },
        fixtures.view,
      );
      const blockedButton = screen.getByRole('button', { name: /Улучшить город/u });
      expect((blockedButton as HTMLButtonElement).disabled).toBe(true);
      const reasonId = blockedButton.getAttribute('aria-describedby');
      expect(reasonId).toBeTruthy();
      const reasonElement = document.getElementById(reasonId ?? '');
      expect(reasonElement?.textContent).toBe(reason);
      expect(reasonElement?.parentElement).toBe(blockedButton.parentElement);
      expect(blockedButton.compareDocumentPosition(reasonElement as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(cssRule('action')).toMatch(/display:\s*flex\s*;/u);
      expect(cssRule('action')).toMatch(/flex-direction:\s*column\s*;/u);
      expect(cssRule('reason')).not.toMatch(/(?:position:\s*(?:absolute|fixed)|transform:)/u);
      fireEvent.click(blockedButton);
      expect(blockedSend).not.toHaveBeenCalled();
    }
  });

  it('критерий 07/T17ay: улучшение города имеет три постоянных состояния', () => {
    const fixtures = getFixtures();
    const city = fixtures.city.city;
    if (!city) throw new Error('городская карточка не содержит город');
    expectThreeStates(
      (state) => ({
        ...fixtures.city,
        city: {
          ...city,
          upgrade:
            state === 'available'
              ? available
              : state === 'unaffordable'
                ? unaffordable
                : { ok: false, reason: 'maxLevel' },
        },
      }),
      /Улучшить город/u,
    );
  });

  it('критерий 07/T17ay: прокладка дороги имеет три постоянных состояния', () => {
    const fixtures = getFixtures();
    const city = fixtures.city.city;
    if (!city) throw new Error('городская карточка не содержит город');
    const plan: RebuildPlan = {
      ok: true,
      cityHex: city.hex,
      path: [city.hex],
      toBuild: [city.hex],
      cost: FIXED_ONE,
      affordable: true,
    };
    expectThreeStates(
      (state) => ({
        ...fixtures.city,
        city: {
          ...city,
          rebuild:
            state === 'available'
              ? plan
              : state === 'unaffordable'
                ? { ...plan, affordable: false }
                : { ok: false, reason: 'noPath' },
        },
      }),
      /Проложить дорогу/u,
    );
  });

  it.each([
    ['основание города', 'foundCity', /Основать город/u],
    ['благоустройство', 'improve', /Благоустроить/u],
    ['укрепление', 'fort', /Укрепление/u],
    ['склад', 'depot', /Склад/u],
  ] as const)('критерий 07/T17ay: %s имеет три постоянных состояния', (_title, key, label) => {
    expectThreeStates(
      (state) =>
        ({
          ...getFixtures().nonCity,
          [key]:
            state === 'available' ? available : state === 'unaffordable' ? unaffordable : forbidden,
        }) as Selection,
      label,
    );
  });

  it.each([
    ['пехота', 'infantry'],
    ['бронетехника', 'armor'],
    ['артиллерия', 'artillery'],
  ] as const)('критерий 07/T17ay: набор %s имеет три постоянных состояния', (_title, type) => {
    const { city, view } = getFixtures();
    for (const check of [availableRecruit, unaffordableRecruit, forbiddenRecruit]) {
      cleanup();
      const send = renderCard(
        {
          ...city,
          recruit: [{ type, amounts: [{ soldiers: FIXED_ONE, check }] }],
        },
        view,
      );
      if (check === forbiddenRecruit) {
        const button = screen.queryByRole('button', { name: new RegExp(_title, 'iu') });
        expect(button).not.toBeNull();
        if (!button) continue;
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.className).not.toMatch(/\b\S*accent\S*\b/u);
        expect(screen.queryByText(/Не хватает людей/iu)).not.toBeNull();
        fireEvent.click(button);
        expect(send).not.toHaveBeenCalled();
      } else {
        const button = screen.getByRole('button', { name: new RegExp(_title, 'iu') });
        expect((button as HTMLButtonElement).disabled).toBe(check !== availableRecruit);
        if (check === availableRecruit) {
          expect(button.className).toMatch(/accent/u);
        } else {
          expect(button.className).not.toMatch(/accent/u);
        }
        fireEvent.click(button);
        expect(send).toHaveBeenCalledTimes(check === availableRecruit ? 1 : 0);
      }
    }
  });

  it('критерий 07/T17ay: одна общая иконка монет содержит два контура и используется в HUD и карточке', () => {
    const { city, view } = getFixtures();
    renderCard(city, view);
    const prices = Array.from(document.querySelectorAll('button svg')).filter(
      (icon) => icon.querySelectorAll('circle').length > 0,
    );
    expect(prices.length).toBeGreaterThan(0);
    expect(prices.every((icon) => icon.querySelectorAll('circle').length === 2)).toBe(true);

    const hexCardSource = readFileSync(
      join(process.cwd(), 'apps/client/src/dev/HexCard.tsx'),
      'utf8',
    );
    const hudSource = readFileSync(join(process.cwd(), 'apps/client/src/dev/Hud.tsx'), 'utf8');
    expect(hexCardSource).toMatch(/GoldIcon/u);
    expect(hudSource).toMatch(/gold:\s*IconCoin/u);
  });
});
