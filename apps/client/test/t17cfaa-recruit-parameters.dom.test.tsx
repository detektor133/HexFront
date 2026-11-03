import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap, RECRUIT_MIN, type Fp, type PlayerView, type UnitType } from '@hexfront/sim';

import { HexCard } from '../src/dev/HexCard.tsx';
import { formatFp, formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine, type LocalEngine } from '../src/local/engine.ts';
import type { RecruitOption, Selection } from '../src/local/messages.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));

afterEach(cleanup);

function citySelection(): {
  engine: LocalEngine;
  cityId: number;
  selection: Selection;
  view: PlayerView;
} {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const city = engine.state.cities.find((candidate) => candidate.owner === 0);
  if (!city) throw new Error('свой город не найден');
  engine.select(city.hex);
  const snapshot = engine.snapshot();
  if (!snapshot.selection || snapshot.selection.city?.id !== city.id) {
    throw new Error('карточка не получила выбранный город');
  }
  return { engine, cityId: city.id, selection: snapshot.selection, view: snapshot.view };
}

describe('07/T17cfaa: параметры набора в карточке города', () => {
  it('показывает fixed-point минимум, если ни для одного типа нет допустимых размеров', () => {
    const fixture = citySelection();
    const options = fixture.selection.recruit.map((option) => ({ ...option, amounts: [] }));
    render(
      <HexCard
        s={{ ...fixture.selection, recruit: options }}
        view={fixture.view}
        map={mapResult.map}
        send={vi.fn()}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Число солдат' }) as HTMLInputElement;
    expect(slider.value).toBe(String(RECRUIT_MIN));
    expect(slider.min).toBe(String(RECRUIT_MIN));
    expect(slider.max).toBe(String(RECRUIT_MIN));
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(RECRUIT_MIN));
    expect(slider.parentElement?.textContent).not.toContain('0 солдат');
  });

  it('переключает тип от отображаемого числа после смены города без размонтирования', () => {
    const fixture = citySelection();
    const options = fixture.selection.recruit;
    const infantry = options.find((option) => option.type === 'infantry');
    const armor = options.find((option) => option.type === 'armor');
    const largestInfantry = infantry?.amounts.at(-1);
    const infantryAt100k = infantry?.amounts.find((amount) => amount.soldiers === 100_000);
    if (!infantry || !armor || !largestInfantry || !infantryAt100k) {
      throw new Error('недостаточно параметров для проверки смены города');
    }
    const largerArmorAmounts = [
      ...armor.amounts.filter((amount) => amount.soldiers < largestInfantry.soldiers),
      { ...largestInfantry },
    ].sort((first, second) => first.soldiers - second.soldiers);
    const initialOptions = options.map((option) =>
      option.type === 'armor' ? { ...option, amounts: largerArmorAmounts } : option,
    );
    const nextCityOptions = options.map((option) => {
      if (option.type === 'infantry') {
        return {
          ...option,
          amounts: option.amounts.filter((amount) => amount.soldiers <= 100_000),
        };
      }
      if (option.type === 'armor') return { ...option, amounts: largerArmorAmounts };
      return option;
    });
    const send = vi.fn();
    const props = {
      view: fixture.view,
      map: mapResult.map,
      send,
    };
    const { rerender } = render(
      <HexCard {...props} s={{ ...fixture.selection, recruit: initialOptions }} />,
    );
    const slider = screen.getByRole('slider', { name: 'Число солдат' }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: String(largestInfantry.soldiers) } });
    expect(slider.value).toBe(String(largestInfantry.soldiers));

    rerender(
      <HexCard
        {...props}
        s={{
          ...fixture.selection,
          hex: fixture.selection.hex + 1,
          city: fixture.selection.city
            ? {
                ...fixture.selection.city,
                id: fixture.selection.city.id + 1,
                hex: fixture.selection.city.hex + 1,
              }
            : null,
          recruit: nextCityOptions,
        }}
      />,
    );
    expect(slider.value).toBe(String(infantryAt100k.soldiers));
    fireEvent.click(screen.getByRole('button', { name: 'Бронетехника' }));
    expect(slider.value).toBe(String(infantryAt100k.soldiers));
  });

  it('выбирает типы, меняет сумму, цену и время, ограничивает сумму и отправляет команду только кнопкой', () => {
    const fixture = citySelection();
    expect(fixture.selection.hex).toBe(
      fixture.engine.state.cities.find((city) => city.id === fixture.cityId)?.hex,
    );
    const options: readonly RecruitOption[] = fixture.selection.recruit.map((option) =>
      option.type === 'armor' ? { ...option, amounts: option.amounts.slice(0, 2) } : option,
    );
    for (const type of ['infantry', 'armor', 'artillery'] as const) {
      if ((options.find((option) => option.type === type)?.amounts.length ?? 0) < 2) {
        throw new Error(`для ${type} недостаточно значений ползунка`);
      }
    }
    const send = vi.fn();
    render(
      <HexCard
        s={{ ...fixture.selection, recruit: options }}
        view={fixture.view}
        map={mapResult.map}
        send={send}
      />,
    );
    expect(screen.getByRole('region', { name: /Столица|Город/u })).toBeTruthy();
    const typeButtons = {
      infantry: screen.getByRole('button', { name: 'Пехота' }),
      armor: screen.getByRole('button', { name: 'Бронетехника' }),
      artillery: screen.getByRole('button', { name: 'Артиллерия' }),
    } satisfies Record<UnitType, HTMLElement>;
    expect(typeButtons.infantry.getAttribute('aria-pressed')).toBe('true');

    const slider = screen.getByRole('slider', { name: 'Число солдат' }) as HTMLInputElement;
    expect(slider.value).toBe('50000');
    const recruitRow = screen.getByRole('group', { name: 'Тип войск' }).parentElement;
    expect(slider.min).toBe('50000');
    expect(slider.step).toBe('50000');
    const infantryMax = options
      .find((option) => option.type === 'infantry')
      ?.amounts.at(-1)?.soldiers;
    if (infantryMax === undefined) throw new Error('нет верхней границы пехоты');
    expect(slider.max).toBe(String(infantryMax));
    fireEvent.change(slider, { target: { value: slider.min } });
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(50000));
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(Number(slider.max)));
    const infantryCheck = options
      .find((option) => option.type === 'infantry')
      ?.amounts.find((candidate) => candidate.soldiers === Number(slider.max))?.check;
    if (
      !infantryCheck?.ok ||
      infantryCheck.cost === undefined ||
      infantryCheck.timeS === undefined
    ) {
      throw new Error('нет расчёта цены и времени пехоты');
    }
    expect(recruitRow?.textContent).toContain(formatFp(infantryCheck.cost));
    expect(recruitRow?.textContent).toContain(formatFp(infantryCheck.timeS));

    fireEvent.change(slider, { target: { value: String(infantryMax) } });
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(infantryMax));
    fireEvent.click(typeButtons.armor);
    expect(typeButtons.armor.getAttribute('aria-pressed')).toBe('true');
    const armorMax = options.find((option) => option.type === 'armor')?.amounts.at(-1)?.soldiers;
    if (armorMax === undefined) throw new Error('нет верхней границы бронетехники');
    expect(armorMax).toBeLessThan(infantryMax);
    expect((screen.getByRole('slider', { name: 'Число солдат' }) as HTMLInputElement).max).toBe(
      String(armorMax),
    );
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(armorMax));
    for (const type of ['armor', 'artillery', 'infantry'] as const) {
      fireEvent.click(typeButtons[type]);
      expect(typeButtons[type].getAttribute('aria-pressed')).toBe('true');
      const option = options.find((candidate) => candidate.type === type);
      const typeSlider = screen.getByRole('slider', {
        name: 'Число солдат',
      }) as HTMLInputElement;
      expect(typeSlider.min).toBe('50000');
      expect(typeSlider.step).toBe('50000');
      expect(typeSlider.max).toBe(String(option?.amounts.at(-1)?.soldiers));
      const currentAmount = option?.amounts.find((candidate) => candidate.soldiers === 100000);
      if (
        !currentAmount?.check.ok ||
        currentAmount.check.cost === undefined ||
        currentAmount.check.timeS === undefined
      ) {
        throw new Error(`нет расчёта цены и времени для ${type}`);
      }
      expect(recruitRow?.textContent).toContain(formatFp(currentAmount.check.cost));
      expect(recruitRow?.textContent).toContain(formatFp(currentAmount.check.timeS));
    }
    fireEvent.change(slider, { target: { value: String(infantryMax) } });
    fireEvent.click(typeButtons.armor);
    expect((screen.getByRole('slider', { name: 'Число солдат' }) as HTMLInputElement).max).toBe(
      String(armorMax),
    );
    fireEvent.click(typeButtons.artillery);
    expect(typeButtons.artillery.getAttribute('aria-pressed')).toBe('true');
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(100000));
    fireEvent.click(typeButtons.infantry);
    expect(typeButtons.infantry.getAttribute('aria-pressed')).toBe('true');
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(100000));
    const recruitButton = screen.getByRole('button', { name: 'Набор' });
    for (const type of ['infantry', 'armor', 'artillery'] as const) {
      fireEvent.click(typeButtons[type]);
      const typeSlider = screen.getByRole('slider', {
        name: 'Число солдат',
      }) as HTMLInputElement;
      fireEvent.change(typeSlider, { target: { value: '100000' } });
      expect(typeButtons[type].getAttribute('aria-pressed')).toBe('true');
      expect(typeSlider.value).toBe('100000');
      expect(send).not.toHaveBeenCalled();

      fireEvent.click(recruitButton);
      expect(send).toHaveBeenCalledExactlyOnceWith({
        t: 'recruit',
        cityId: fixture.cityId,
        type,
        soldiers: 100000,
      });
      send.mockClear();
    }
    fireEvent.click(typeButtons.infantry);
    fireEvent.change(screen.getByRole('slider', { name: 'Число солдат' }), {
      target: { value: String(infantryMax) },
    });
    expect(slider.parentElement?.textContent).toContain(formatSoldiers(infantryMax));
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(recruitButton);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      t: 'recruit',
      cityId: fixture.cityId,
      type: 'infantry',
      soldiers: infantryMax,
    });
  });

  it('блокирует недоступный набор с причиной и показывает занятую очередь без новых параметров', () => {
    const fixture = citySelection();
    const player = fixture.engine.state.players[0];
    if (!player) throw new Error('игрок не найден');
    player.gold = 0 as Fp;
    fixture.engine.select(fixture.selection.hex);
    const noGold = fixture.engine.snapshot();
    if (!noGold.selection) throw new Error('выбранный город потерян');
    const send = vi.fn();
    render(<HexCard s={noGold.selection} view={noGold.view} map={mapResult.map} send={send} />);
    const blocked = screen.getByRole('button', { name: 'Набор' }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    const blockedAmount = noGold.selection.recruit[0]?.amounts[0];
    if (!blockedAmount?.check.cost || blockedAmount.check.timeS === undefined) {
      throw new Error('для заблокированного набора нет цены и времени');
    }
    const recruitRow = screen.getByRole('group', { name: 'Тип войск' }).parentElement;
    expect(recruitRow?.textContent).toContain(formatFp(blockedAmount.check.cost));
    expect(recruitRow?.textContent).toContain(formatFp(blockedAmount.check.timeS));
    expect(
      document.getElementById(blocked.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Не хватает золота');
    fireEvent.click(blocked);
    expect(send).not.toHaveBeenCalled();

    cleanup();
    player.bankrupt = true;
    fixture.engine.select(fixture.selection.hex);
    const bankrupt = fixture.engine.snapshot();
    if (!bankrupt.selection) throw new Error('выбранный город потерян при банкротстве');
    render(<HexCard s={bankrupt.selection} view={bankrupt.view} map={mapResult.map} send={send} />);
    const bankruptButton = screen.getByRole('button', { name: 'Набор' }) as HTMLButtonElement;
    expect(bankruptButton.disabled).toBe(true);
    expect(
      document.getElementById(bankruptButton.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Казна пуста');
    const bankruptAmount = bankrupt.selection.recruit[0]?.amounts[0];
    if (!bankruptAmount?.check.cost || bankruptAmount.check.timeS === undefined) {
      throw new Error('для набора при банкротстве нет цены и времени');
    }
    const bankruptRow = screen.getByRole('group', { name: 'Тип войск' }).parentElement;
    expect(bankruptRow?.textContent).toContain(formatFp(bankruptAmount.check.cost));
    expect(bankruptRow?.textContent).toContain(formatFp(bankruptAmount.check.timeS));
    fireEvent.click(bankruptButton);
    expect(send).not.toHaveBeenCalled();

    cleanup();
    const busy = {
      ...fixture.view,
      recruits: [
        {
          id: 1,
          cityId: fixture.cityId,
          type: 'artillery',
          soldiers: 100000 as Fp,
          progressTicks: 20,
          totalTicks: 100,
        },
      ],
    } as typeof fixture.view;
    render(<HexCard s={fixture.selection} view={busy} map={mapResult.map} send={send} />);
    expect(screen.getByText(/Набор: Артиллерия 100/u)).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'Число солдат' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Набор' })).toBeNull();
  });
});
