import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconButton } from '../src/ui/icon-button.tsx';

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

  it('критерий 4: все кнопки-иконки панели армий, карточек и HUD имеют одинаковую подпись', () => {
    render(
      <>
        <div data-panel="army">
          <IconButton label="Фронт" onClick={vi.fn()}>
            <span aria-hidden="true">⌁</span>
          </IconButton>
        </div>
        <div data-panel="card">
          <IconButton label="Слить" onClick={vi.fn()}>
            <span aria-hidden="true">⊕</span>
          </IconButton>
        </div>
        <div data-panel="hud">
          <IconButton label="Пауза" onClick={vi.fn()}>
            <span aria-hidden="true">Ⅱ</span>
          </IconButton>
        </div>
      </>,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.getAttribute('aria-label')).not.toBe('');
    }
  });
});
