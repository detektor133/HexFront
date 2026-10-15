import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatFp, formatSoldiers } from '../src/i18n/format.ts';
import { MatchEndScreen } from '../src/match/MatchEndScreen.tsx';

const baseProps = {
  soldiers: 1_200_000,
  gold: 1_820_000,
  winner: 0,
  playerId: 0,
  place: 1,
  eliminated: false,
  fog: true,
  onWatch: vi.fn(),
  onMenu: vi.fn(),
  onFogChange: vi.fn(),
};

describe('экран конца матча и выбывание', () => {
  afterEach(cleanup);

  it('критерий: 1 200 000 fixed-point солдат и 1 820 000 fixed-point золота показываются форматтерами', () => {
    render(<MatchEndScreen {...baseProps} reason="cities" />);

    expect(screen.getByText(formatSoldiers(1_200_000))).toBeTruthy();
    expect(screen.getByText(formatFp(1_820_000))).toBeTruthy();
  });

  it('критерий: причина победы cities отображается как «Контроль городов»', () => {
    render(<MatchEndScreen {...baseProps} reason="cities" />);

    expect(screen.getByText('Контроль городов')).toBeTruthy();
  });

  it('критерий: причина победы lastStanding отображается как «Остальные выбыли»', () => {
    render(<MatchEndScreen {...baseProps} reason="lastStanding" />);

    expect(screen.getByText('Остальные выбыли')).toBeTruthy();
  });

  it('критерий: причина победы score отображается как «Победа по очкам»', () => {
    render(<MatchEndScreen {...baseProps} reason="score" />);

    expect(screen.getByText('Победа по очкам')).toBeTruthy();
  });

  it('критерий: при eliminated и winner < 0 показывается карточка «Вы выбыли · место N»', () => {
    render(<MatchEndScreen {...baseProps} winner={-1} eliminated place={3} />);

    expect(screen.getByText('Вы выбыли · место 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'В меню' })).toBeTruthy();
  });

  it('критерий: «Смотреть» отправляет то же выключение тумана и прячет карточку', () => {
    const onWatch = vi.fn();
    render(<MatchEndScreen {...baseProps} winner={-1} eliminated onWatch={onWatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));

    expect(onWatch).toHaveBeenCalledWith({ type: 'setFog', enabled: false });
    expect(screen.queryByText(/Вы выбыли/)).toBeNull();
  });

  it('критерий: «В меню» ведёт на /', () => {
    const onMenu = vi.fn();
    render(<MatchEndScreen {...baseProps} winner={-1} eliminated onMenu={onMenu} />);

    fireEvent.click(screen.getByRole('button', { name: 'В меню' }));

    expect(onMenu).toHaveBeenCalledWith('/');
  });

  it('критерий: HUD показывает отсчёт у игрока, который не держит города', () => {
    render(
      <MatchEndScreen
        {...baseProps}
        victoryHold={{ player: 2, seconds: 37 }}
        playerId={0}
        winner={-1}
      />,
    );

    expect(screen.getByText('Игрок 2 держит 70 % городов · 00:37')).toBeTruthy();
  });
});
