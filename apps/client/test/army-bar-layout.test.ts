// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadMap } from '@hexfront/sim';

import { ArmyBar } from '../src/dev/ArmyBar.tsx';
import { createLocalEngine } from '../src/local/engine.ts';

const PROJECT_ROOT =
  path.basename(process.cwd()) === 'client'
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
const CSS = path.resolve(PROJECT_ROOT, 'apps/client/src/dev/ArmyBar.module.css');
const mapJson: unknown = JSON.parse(
  readFileSync(path.resolve(PROJECT_ROOT, 'packages/mapgen/maps/tiny.json'), 'utf8'),
);
const loaded = loadMap(mapJson);
if (!loaded.ok) throw new Error(loaded.errors.join('; '));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('область событий панели армий', () => {
  it('проверяет реальный DOM ArmyBar, ширину карточки и интерактивность ленты', async () => {
    const engine = createLocalEngine(mapJson, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const view = engine.snapshot().view;
    const send = vi.fn();
    const onPick = vi.fn();
    const onSelect = vi.fn();
    const onTool = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe(): void {}
        public disconnect(): void {}
      },
    );
    render(
      createElement(ArmyBar, {
        view,
        selected: view.armies[0]?.id ?? null,
        partial: [],
        onSelect,
        send,
        onPick,
        tool: null,
        onTool,
      }),
    );

    const strip = document.querySelector<HTMLElement>('[class*="strip"]');
    const card = document.querySelector<HTMLElement>('[class*="card"]');
    if (!strip || !card) throw new Error('ArmyBar не смонтирован');
    const css = readFileSync(CSS, 'utf8');
    expect(css).toMatch(/\.strip\s*\{[^}]*align-self:\s*stretch/s);
    expect(css).toMatch(/\.strip\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.card\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(css).toMatch(/\.card\s*\{[^}]*flex:\s*0\s+0\s+238px/s);
    fireEvent.click(screen.getByRole('button', { name: 'Reserve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Auto-reinforce' }));
    fireEvent.click(screen.getByRole('button', { name: 'New army' }));
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    fireEvent.wheel(strip, { deltaX: 120, deltaY: 0 });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ hex: null }));
    expect(send).toHaveBeenCalledWith({ t: 'setAutoReinforce', on: true });
    expect(send).toHaveBeenCalledWith({ t: 'createArmy', name: '' });
    expect(onTool).toHaveBeenCalledWith({ tool: 'front', armyId: expect.any(Number) });
  });

  it('сохраняет CSS-инварианты растянутой полосы и прозрачной пустой области', () => {
    const css = readFileSync(CSS, 'utf8');
    const strip =
      [...css.matchAll(/\.strip\s*\{([^}]*)\}/g)]
        .map((match) => match[1] ?? '')
        .find((block) => block.includes('align-self')) ?? '';
    const content = css.match(/\.stripContent\s*\{([^}]*)\}/)?.[1] ?? '';
    const card = css.match(/\.card\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(strip).toMatch(/align-self:\s*stretch/);
    expect(content).toMatch(/width:\s*max-content/);
    expect(content).toMatch(/pointer-events:\s*auto/);
    expect(card).toMatch(/box-sizing:\s*border-box/);
    expect(card).toMatch(/flex:\s*0\s+0\s+238px/);
  });
});
