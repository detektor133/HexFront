import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { t } from '../src/i18n/dict.ts';
import { MatchEndScreen, type MatchEndScreenProps } from '../src/match/MatchEndScreen.tsx';

const base: MatchEndScreenProps = {
  soldiers: 10,
  gold: 5000,
  winner: 2,
  playerId: 1,
  winnerName: 'Вика',
  place: 4,
  eliminated: false,
  fog: true,
  rows: [{ id: 2, name: 'Вика', place: 1, score: 99 }],
  stats: { hexes: 7, cities: 2, score: 5 },
  onWatch: () => undefined,
  onMenu: () => undefined,
};

describe('итог матча для зрителя', () => {
  it('называет победителя без «вы проиграли», личной статистики и кнопки «Наблюдать»', () => {
    const html = renderToStaticMarkup(
      createElement(MatchEndScreen, { ...base, spectating: true, eliminated: true }),
    );
    expect(html).toContain(t('match.end'));
    expect(html).toContain('Вика');
    expect(html).not.toContain(t('match.lost'));
    expect(html).not.toContain(t('match.statHexes'));
    expect(html).not.toContain(t('match.observe'));
    expect(html).toContain(t('pause.menu'));
  });

  it('игроку по-прежнему показывает поражение и его статистику', () => {
    const html = renderToStaticMarkup(createElement(MatchEndScreen, base));
    expect(html).toContain(t('match.lost'));
    expect(html).toContain(t('match.statHexes'));
  });
});
