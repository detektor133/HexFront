import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appSearch, navigate, readLocation } from '../src/nav.ts';

interface FakeHistory {
  state: unknown;
  pushState: (state: unknown, title: string, url: string) => void;
}

/** Минимальный `window` с историей: адресная строка меняется только вместе с pushState. */
function installWindow(path: string, search: string): { pushed: string[]; events: string[] } {
  const pushed: string[] = [];
  const events: string[] = [];
  const location = { origin: 'http://localhost', pathname: path, search };
  const history: FakeHistory = {
    state: null,
    pushState: (state, _title, url) => {
      history.state = state;
      const target = new URL(url, 'http://localhost');
      location.pathname = target.pathname;
      location.search = target.search;
      pushed.push(url);
    },
  };
  vi.stubGlobal('window', {
    location,
    history,
    dispatchEvent: (event: Event) => {
      events.push(event.type);
      return true;
    },
  });
  return { pushed, events };
}

describe('навигация внутри одной страницы', () => {
  beforeEach(() => installWindow('/', ''));
  afterEach(() => vi.unstubAllGlobals());

  it('матч открывается на месте: адрес остаётся «/», параметры лежат в истории', () => {
    const { pushed, events } = installWindow('/', '');
    navigate('/match?map=gen&seed=42&players=30');
    expect(pushed).toEqual(['/']);
    expect(events).toEqual(['hexfront:navigate']);
    expect(readLocation()).toEqual({ pathname: '/match', search: '?map=gen&seed=42&players=30' });
    expect(appSearch()).toBe('?map=gen&seed=42&players=30');
  });

  it('возврат в меню тоже не меняет адрес', () => {
    installWindow('/', '');
    navigate('/match?seed=1');
    navigate('/');
    expect(readLocation()).toEqual({ pathname: '/', search: '' });
  });

  it('прямая ссылка без состояния читается из адресной строки', () => {
    installWindow('/match', '?seed=7');
    expect(readLocation()).toEqual({ pathname: '/match', search: '?seed=7' });
  });

  it('dev-страницы по-прежнему получают настоящий адрес', () => {
    const { pushed } = installWindow('/', '');
    navigate('/dev/sandbox?seed=3');
    expect(pushed).toEqual(['/dev/sandbox?seed=3']);
    expect(readLocation()).toEqual({ pathname: '/dev/sandbox', search: '?seed=3' });
  });
});
