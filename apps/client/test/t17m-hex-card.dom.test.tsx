import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { HexCard } from '../src/dev/HexCard.tsx';
import { UnitCard } from '../src/dev/UnitCard.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import { computeMatchLayout, validateMatchLayout } from '../src/match/layout.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);

const mapResult = loadMap(mapJson);
if (!mapResult.ok) throw new Error(mapResult.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T17m: карточка клетки', () => {
  it('показывает данные своей клетки и города', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const capital = engine.state.cities.find((city) => city.owner === 0);
    if (!capital) throw new Error('столица игрока не найдена');
    engine.select(capital.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );

    expect(screen.getByText(/Столица/u)).toBeTruthy();
    expect(screen.getByText('вы')).toBeTruthy();
    expect(screen.getByText('Население')).toBeTruthy();
    expect(screen.getByText('Рост')).toBeTruthy();
    expect(screen.getByText('Снабжение')).toBeTruthy();
    expect(screen.getByText('Золото')).toBeTruthy();
  });

  it('берёт высоту из scrollHeight, если ResizeObserver сообщает нулевой contentRect', () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const capital = engine.state.cities.find((city) => city.owner === 0);
    if (!capital) throw new Error('столица игрока не найдена');
    engine.select(capital.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');
    const heights: number[] = [];
    class ZeroRectResizeObserver {
      public constructor(private readonly callback: ResizeObserverCallback) {}

      public observe(target: Element): void {
        Object.defineProperty(target, 'scrollHeight', { configurable: true, value: 248 });
        this.callback(
          [{ target, contentRect: { height: 0 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      public disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ZeroRectResizeObserver);

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
        onHeight={(height) => heights.push(height)}
      />,
    );

    expect(heights).toEqual([248]);
  });

  it('не показывает сведения и действия чужого fogged-гекса', () => {
    const engine = createLocalEngine(mapJson, 42, 2, [], true);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const foreign = engine.state.cities.find((city) => city.owner === 1);
    if (!foreign) throw new Error('чужой город не найден');
    engine.select(foreign.hex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор клетки не создан');

    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );

    expect(screen.getByText('соперник')).toBeTruthy();
    expect(screen.queryByText(/Столица/u)).toBeNull();
    expect(screen.queryByText('Снабжение')).toBeNull();
    expect(screen.queryByText('Золото')).toBeNull();
    expect(screen.queryByText(/Строительство/u)).toBeNull();
    expect(screen.queryByText(/Набор/u)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('не раскрывает fogged-нейтральную клетку и не ломает UnitCard', () => {
    const engine = createLocalEngine(mapJson, 42, 2, [], true);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const initial = engine.snapshot();
    const neutralHex = initial.view.hexes.owner.findIndex(
      (owner, index) => owner === -1 && initial.view.hexes.visible[index] === 0,
    );
    const unit = initial.view.units.find((item) => item.owner === 0);
    if (neutralHex < 0 || !unit) throw new Error('нейтральный гекс или свой отряд не найден');

    engine.select(neutralHex);
    const message = engine.snapshot();
    if (!message.selection) throw new Error('выбор нейтральной клетки не создан');
    render(
      <HexCard
        s={message.selection}
        view={message.view}
        map={mapResult.map}
        send={() => undefined}
      />,
    );
    expect(screen.getByText('нейтральный')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    render(
      <UnitCard
        view={message.view}
        map={mapResult.map}
        picked={{ hex: null, units: [unit.id], target: null }}
        send={() => undefined}
        onPick={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'В армию' })).toBeTruthy();
  });

  it.each([
    [360, 640],
    [1440, 900],
    [1920, 1080],
  ])('держит карточку над панелью армий в границах экрана: %dx%d', (width, height) => {
    const layout = computeMatchLayout({
      viewport: { width, height },
      hudHeight: 48,
      bottomPanelHeight: 150,
      eventRows: 0,
      tutorialVisible: false,
      leaderboardOpen: false,
      leaderboardRows: 2,
      cardHeight: 248,
      cardOpen: true,
      popupOpen: false,
      paused: false,
    });
    const card = layout.elements.find((element) => element.id === 'card');
    const dock = layout.elements.find((element) => element.id === 'bottom-panel');
    if (!card || !dock) throw new Error('карточка или панель армий не попали в раскладку');
    expect(validateMatchLayout(layout)).toEqual([]);
    expect(card.y + card.height).toBeLessThanOrEqual(dock.y);
  });
});
