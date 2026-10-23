import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GameEvent } from '@hexfront/sim';

import { EventFeed } from '../src/dev/EventFeed.tsx';
import type { EventFeedItem } from '../src/dev/event-feed.ts';
import { tokens } from '../src/theme/tokens.ts';

afterEach(cleanup);

const item = (id: string, event: GameEvent, hex: number | null): EventFeedItem => ({
  id,
  event,
  hex,
  important: true,
  expiresAt: 1000,
});

const rgb = (hex: string): string => {
  const value = hex.slice(1);
  return `rgb(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)})`;
};

describe('07/T17at: DOM ленты событий', () => {
  it('Приёмка 3: показывает локализованные непустые подписи и не более четырёх кнопок', () => {
    render(
      <EventFeed
        items={[
          item('1', { t: 'unitDestroyed', playerId: 0, unitId: 1, hex: 1 }, 1),
          item('2', { t: 'unitCapitulated', playerId: 0, unitId: 2, hex: 2 }, 2),
          item(
            '3',
            { t: 'cityCaptured', playerId: 0, previousOwnerId: 1, newOwnerId: 0, cityId: 3 },
            3,
          ),
          item(
            '4',
            { t: 'cityCaptured', playerId: 1, previousOwnerId: 0, newOwnerId: 1, cityId: 4 },
            null,
          ),
        ]}
        localPlayerId={0}
        now={0}
        onFocus={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.textContent?.trim().length)).toBe(true);
    expect(buttons[2]?.textContent).toBe('Город захвачен');
    expect(buttons[3]?.textContent).toBe('Город потерян');
  });

  it('Приёмка 3: цветовой маркер берётся у владельца события, а клик фокусирует только событие с гексом', () => {
    const onFocus = vi.fn();
    render(
      <EventFeed
        items={[
          item(
            'capture',
            { t: 'cityCaptured', playerId: 0, previousOwnerId: 1, newOwnerId: 0, cityId: 3 },
            3,
          ),
          item(
            'loss',
            { t: 'cityCaptured', playerId: 1, previousOwnerId: 0, newOwnerId: 1, cityId: 4 },
            null,
          ),
        ]}
        now={0}
        onFocus={onFocus}
      />,
    );

    const buttons = screen.getAllByRole('button');
    const captureButton = buttons[0];
    const lossButton = buttons[1];
    expect(captureButton).toBeDefined();
    expect(lossButton).toBeDefined();
    if (!captureButton || !lossButton) return;
    const ownerMarker = captureButton.querySelector('span');
    const ownerLine = tokens.players.palette[0]?.line;
    expect(ownerMarker).toBeDefined();
    expect(ownerLine).toBeDefined();
    if (!ownerMarker || !ownerLine) return;
    expect(getComputedStyle(ownerMarker).backgroundColor).toBe(rgb(ownerLine));
    fireEvent.click(captureButton);
    fireEvent.click(lossButton);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ id: 'capture', hex: 3 }));
  });
});
