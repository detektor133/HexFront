import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

function setWindow(search: string, pathname = '/match'): void {
  Object.assign(globalThis, {
    window: {
      location: { search, pathname },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('экран матча игрока', () => {
  it('критерий 1: /match без debug рендерит только экран игрока без панели наблюдателя, переключателя тумана и отказа команды', async () => {
    vi.doMock('../src/dev/DevSandboxPage.tsx', () => ({
      SandboxSurface: ({ debug }: { debug: boolean }) =>
        createElement(
          'div',
          { 'data-testid': 'legacy-sandbox' },
          debug ? 'Пауза Вся карта Скачать телеметрию Последний отказ' : null,
        ),
    }));
    setWindow('');

    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(
      createElement(MatchSurface, { debug: false, showOnboarding: true }),
    );

    expect(markup).not.toContain('legacy-sandbox');
    expect(markup).not.toMatch(/Пауза|Шаг|1×|5×|20×|Вся карта|Игрок 1|Скачать телеметрию/gu);
    expect(markup).not.toContain('Последний отказ');
  });

  it('критерий 1: /match?debug=1 рендерит панель наблюдателя', async () => {
    vi.doMock('../src/dev/DevSandboxPage.tsx', () => ({
      SandboxSurface: ({ debug }: { debug: boolean }) =>
        createElement(
          'div',
          { 'data-testid': 'legacy-sandbox' },
          debug ? 'Пауза Вся карта Скачать телеметрию' : null,
        ),
    }));
    setWindow('?debug=1');

    const { MatchSurface } = await import('../src/match/MatchSurface.tsx');
    const markup = renderToStaticMarkup(
      createElement(MatchSurface, { debug: true, showOnboarding: true }),
    );

    expect(markup).not.toContain('legacy-sandbox');
    expect(markup).toMatch(/Пауза|Шаг|1×|5×|20×|Скачать телеметрию/u);
  });

  it('критерий 3: в production вызов маршрутизатора для /dev/sandbox возвращает «Страница не найдена»', async () => {
    const render = vi.fn();
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render }),
    }));
    vi.stubEnv('PROD', true);
    setWindow('', '/dev/sandbox');
    Object.assign(globalThis, {
      document: { getElementById: vi.fn(() => ({})) },
    });

    await import('../src/main.tsx');
    const strictMode = render.mock.calls[0]?.[0] as ReactElement<{ children: ReactElement }>;
    const appElement = strictMode.props.children as ReactElement;
    const routeElement = (appElement.type as () => ReactElement)();

    expect(renderToStaticMarkup(routeElement)).toContain('Страница не найдена');
  });
});
