import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { Hud } from '../src/dev/Hud.tsx';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import { IconButton } from '../src/ui/icon-button.tsx';

const tinyMap: unknown = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loaded = loadMap(tinyMap);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const engine = createLocalEngine(tinyMap, 42, 2);
if ('errors' in engine) throw new Error(engine.errors.join('; '));
const view = engine.snapshot().view;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('DOM-приёмка подписей на телефоне (07/T9)', () => {
  it('критерий 1: удержание 400 мс на иконке показывает подпись и не включает инструмент', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <IconButton label="Фронт" onClick={onClick}>
        <span aria-hidden="true">⌁</span>
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Фронт' });

    fireEvent.pointerDown(button, { clientX: 20, clientY: 20 });
    vi.advanceTimersByTime(400);

    expect(screen.getByRole('tooltip', { name: 'Фронт' })).toBeTruthy();
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.pointerUp(button, { clientX: 20, clientY: 20 });

    expect(screen.queryByRole('tooltip', { name: 'Фронт' })).toBeNull();
  });

  it('критерий 2: короткий тап включает инструмент без подписи', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <IconButton label="Наступление" onClick={onClick}>
        <span aria-hidden="true">➜</span>
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Наступление' });

    fireEvent.pointerDown(button, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(button, { clientX: 20, clientY: 20 });
    fireEvent.click(button);
    vi.advanceTimersByTime(400);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('критерий 3: сдвиг на 10 px отменяет подпись', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <IconButton label="Оборона" onClick={onClick}>
        <span aria-hidden="true">◆</span>
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Оборона' });

    fireEvent.pointerDown(button, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(button, { clientX: 30, clientY: 20 });
    vi.advanceTimersByTime(400);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('критерий 4: реальные панели армий, карточка и HUD имеют одинаковые подписи иконок', () => {
    const firstUnit = view.units[0];
    if (!firstUnit) throw new Error('В снимке tiny-карты нет отрядов для карточки');
    const sourceUnits = [firstUnit, view.units[1] ?? firstUnit];
    const units = sourceUnits.map((unit, index) => ({
      ...unit,
      id: index + 1,
      hex: view.units[0]?.hex ?? unit.hex,
      type: view.units[0]?.type ?? unit.type,
      armyId: null,
    }));
    const cardView = { ...view, units };

    render(
      <>
        <ArmyBar
          view={view}
          selected={null}
          partial={[]}
          onSelect={vi.fn()}
          send={vi.fn()}
          onPick={vi.fn()}
          tool={null}
          onTool={vi.fn()}
        />
        <UnitCard
          view={cardView}
          map={loaded.map}
          picked={{ hex: null, units: units.map((unit) => unit.id), target: null }}
          send={vi.fn()}
          onPick={vi.fn()}
        />
        <Hud view={view} send={vi.fn()} fog={true} setFog={vi.fn()} onPause={vi.fn()} />
      </>,
    );

    const buttons = Array.from(document.querySelectorAll('button')).filter((button) =>
      button.querySelector('svg'),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.getAttribute('aria-label')).not.toBe('');
    }
  });
});
