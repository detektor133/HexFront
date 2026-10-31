// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Hud } from '../src/dev/Hud.tsx';
import { createLocalEngine } from '../src/local/engine.ts';
import { PauseMenu } from '../src/match/PauseMenu.tsx';

const tinyMapPath = [
  join(process.cwd(), 'packages/mapgen/maps/tiny.json'),
  join(process.cwd(), '../../packages/mapgen/maps/tiny.json'),
].find(existsSync);
if (!tinyMapPath) throw new Error('Не найден файл карты tiny.json');
const tinyMap: unknown = JSON.parse(readFileSync(tinyMapPath, 'utf8'));

afterEach(() => {
  cleanup();
});

describe('07/T17bq: окна налога, настроек и паузы', () => {
  it('открывает и закрывает налог, отправляет выбранную ставку и переключает настройку', () => {
    const engine = createLocalEngine(tinyMap, 42, 2);
    if ('errors' in engine) throw new Error(engine.errors.join('; '));
    const send = vi.fn();
    const setFog = vi.fn();
    render(
      <Hud view={engine.snapshot().view} send={send} fog={true} setFog={setFog} showFog={true} />,
    );

    const taxButton = screen.getByRole('button', { name: /Налог|Tax/u });
    expect(screen.queryByRole('dialog', { name: /Налог|Tax/u })).toBeNull();
    fireEvent.click(taxButton);
    const taxPopup = screen.getByRole('dialog', { name: /Налог|Tax/u });
    fireEvent.change(screen.getByRole('slider', { name: /Налог|Tax/u }), {
      target: { value: '300' },
    });
    expect(send).toHaveBeenCalledWith({ t: 'setTax', rate: 300 });
    fireEvent.click(taxButton);
    expect(screen.queryByRole('dialog', { name: /Налог|Tax/u })).toBeNull();
    expect(taxPopup).toBeTruthy();

    const settingsButton = screen.getByRole('button', { name: /Настройки|Settings/u });
    fireEvent.click(settingsButton);
    const settings = screen.getByRole('dialog', { name: /Настройки|Settings/u });
    const autoCommand = screen.getByRole('switch', {
      name: /Автокомандование|Auto command/u,
    });
    fireEvent.click(autoCommand);
    expect(send).toHaveBeenCalledWith({
      t: 'setAutoCommand',
      on: !engine.snapshot().view.me.autoCommand,
    });
    const fog = screen.getByRole('switch', { name: /Туман|Fog of war/u });
    fireEvent.click(fog);
    expect(setFog).toHaveBeenCalledWith(false);
    fireEvent.click(settingsButton);
    expect(screen.queryByRole('dialog', { name: /Настройки|Settings/u })).toBeNull();
    expect(settings).toBeTruthy();
  });

  it('вызывает команды продолжения, перезапуска и выхода из паузы', () => {
    const onResume = vi.fn();
    const onRestart = vi.fn();
    const onMenu = vi.fn();
    render(<PauseMenu onResume={onResume} onRestart={onRestart} onMenu={onMenu} />);

    fireEvent.click(screen.getByRole('button', { name: /Продолжить|Resume/u }));
    fireEvent.click(screen.getByRole('button', { name: /Заново|Restart/u }));
    fireEvent.click(screen.getByRole('button', { name: /В меню|Main menu/u }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(onMenu).toHaveBeenCalledOnce();
  });
});
