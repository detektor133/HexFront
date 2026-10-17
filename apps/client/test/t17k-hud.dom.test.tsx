import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { Hud } from '../src/dev/Hud.tsx';
import { createLocalEngine } from '../src/local/engine.ts';

const mapJson: unknown = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const parsedMap = loadMap(mapJson);
if (!parsedMap.ok) throw new Error(parsedMap.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHud(): void {
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  render(
    <Hud
      view={engine.snapshot().view}
      send={vi.fn()}
      fog={true}
      setFog={vi.fn()}
      showFog={false}
      onPause={vi.fn()}
    />,
  );
}

describe('07/T17k: компактный HUD', () => {
  it('сохраняет шесть метрик, доступные кнопки и правильные SVG', () => {
    renderHud();
    for (const label of ['Люди', 'Золото', 'Налог', 'Снабжение', 'Время', 'Место']) {
      expect(document.querySelector(`svg[aria-label="${label}"]`)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Налог' }).getAttribute('title')).toBe('Налог');
    expect(screen.getByRole('button', { name: 'Настройки' }).getAttribute('title')).toBe(
      'Настройки',
    );
    expect(screen.getByRole('button', { name: 'Пауза' }).getAttribute('title')).toBe('Пауза');
    for (const icon of Array.from(document.querySelectorAll('header svg[aria-label]'))) {
      expect(icon.getAttribute('viewBox')).toBe('0 0 14 14');
    }
    const gold = document.querySelector('svg[aria-label="Золото"]');
    expect(gold?.getAttribute('class')).toContain('goldIcon');
    expect(gold?.querySelectorAll('path').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Пауза' }).querySelectorAll('path')).toHaveLength(2);
  });

  it('открывает каждое меню под своей кнопкой', () => {
    renderHud();
    fireEvent.click(screen.getByRole('button', { name: 'Налог' }));
    expect(
      screen
        .getByRole('dialog', { name: 'Налог' })
        .parentElement?.contains(screen.getByRole('button', { name: 'Налог' })),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(
      screen
        .getByRole('dialog', { name: 'Настройки' })
        .parentElement?.contains(screen.getByRole('button', { name: 'Настройки' })),
    ).toBe(true);
  });
});
