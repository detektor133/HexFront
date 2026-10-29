import { describe, expect, it } from 'vitest';

import { GithubRequestError, parseGithubRepo, waitForCi, type HttpResponse } from './ci-wait.ts';

const jsonResponse = (value: unknown): HttpResponse => ({
  ok: true,
  status: 200,
  json: async (): Promise<unknown> => value,
  text: async (): Promise<string> => JSON.stringify(value),
});

const textResponse = (value: string): HttpResponse => ({
  ok: true,
  status: 200,
  json: async (): Promise<unknown> => value,
  text: async (): Promise<string> => value,
});

const run = (status: string, conclusion: string | null = null) => ({
  id: 42,
  run_number: 2,
  run_attempt: 1,
  head_sha: 'abc123',
  status,
  conclusion,
  html_url: 'https://github.com/acme/game/actions/runs/42',
});

describe('ожидание GitHub Actions', () => {
  it.each([
    ['https://github.com/acme/game.git', 'acme/game'],
    ['git@github.com:acme/game.git', 'acme/game'],
    ['ssh://git@github.com/acme/game.git', 'acme/game'],
  ])('извлекает репозиторий из %s', (remote, expected) => {
    expect(parseGithubRepo(remote)).toBe(expected);
  });

  it('опрашивает run через 30 секунд и завершает success одной строкой', async () => {
    const responses = [
      jsonResponse({ workflow_runs: [run('in_progress')] }),
      jsonResponse({ workflow_runs: [run('completed', 'success')] }),
    ];
    const delays: number[] = [];
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      sleep: async (ms: number): Promise<void> => {
        delays.push(ms);
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(0);
    expect(delays).toEqual([30_000]);
    expect(output).toEqual([
      'pending https://github.com/acme/game/actions/runs/42 0',
      'success https://github.com/acme/game/actions/runs/42',
    ]);
  });

  it('ждёт последний run SHA, а не принимает старый завершённый', async () => {
    const responses = [
      jsonResponse({
        workflow_runs: [
          run('in_progress'),
          {
            id: 43,
            run_number: 1,
            run_attempt: 1,
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/game/actions/runs/43',
          },
        ],
      }),
      jsonResponse({ workflow_runs: [run('completed', 'success')] }),
    ];
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      sleep: async (ms: number): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output).toEqual([
      'pending https://github.com/acme/game/actions/runs/42 0',
      'success https://github.com/acme/game/actions/runs/42',
    ]);
  });

  it('ждёт последнюю попытку run_number после rerun', async () => {
    const old = run('completed', 'success') as Record<string, unknown>;
    const retried = {
      ...old,
      id: 44,
      run_attempt: 2,
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/acme/game/actions/runs/44',
    };
    const responses = [
      jsonResponse({ workflow_runs: [old, retried] }),
      jsonResponse({ workflow_runs: [{ ...retried, status: 'completed', conclusion: 'success' }] }),
    ];
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      sleep: async (ms: number): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output[0]).toContain('/44');
  });

  it('при failure печатает имя job, последние 30 строк лога и итог', async () => {
    const log = Array.from({ length: 35 }, (_, index) => `строка ${index + 1}`).join('\n');
    const responses = [
      jsonResponse({ workflow_runs: [run('completed', 'failure')] }),
      jsonResponse({ jobs: [{ id: 7, name: 'tests', conclusion: 'failure' }] }),
      textResponse(log),
    ];
    const output: string[] = [];

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(1);
    expect(output.slice(0, -2)).toEqual(
      Array.from({ length: 30 }, (_, index) => `строка ${index + 6}`),
    );
    expect(output.at(-2)).toBe('run_attempt=1');
    expect(output.at(-1)).toBe('failure job=tests https://github.com/acme/game/actions/runs/42');
  });

  it('после перезапуска игнорирует старую красную попытку того же SHA', async () => {
    const old = run('completed', 'failure');
    const next = { ...old, run_attempt: 2, status: 'completed', conclusion: 'success' };
    const responses = [
      jsonResponse({ workflow_runs: [old] }),
      jsonResponse({ workflow_runs: [old, next] }),
    ];
    const output: string[] = [];
    let now = 0;
    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      afterAttempt: 1,
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      sleep: async (ms): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line): void => {
        output.push(line);
      },
    });

    expect(code).toBe(0);
    expect(output[0]).toMatch(/^pending /u);
    expect(output.at(-1)).toMatch(/^success /u);
  });

  it('передаёт Bearer-токен во все запросы', async () => {
    const responses = [
      jsonResponse({ workflow_runs: [run('completed', 'failure')] }),
      jsonResponse({ jobs: [{ id: 7, name: 'tests', conclusion: 'failure' }] }),
      textResponse('ошибка'),
    ];
    const headers: Record<string, string>[] = [];

    await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      token: 'secret',
      fetchFn: async (_url, init): Promise<HttpResponse> => {
        headers.push(init.headers);
        return responses.shift() ?? jsonResponse({});
      },
      writeLine: () => undefined,
    });

    expect(headers).toHaveLength(3);
    expect(headers.every((value) => value.Authorization === 'Bearer secret')).toBe(true);
  });

  it('завершает failure по таймауту без найденного run', async () => {
    const delays: number[] = [];
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => jsonResponse({ workflow_runs: [] }),
      sleep: async (ms: number): Promise<void> => {
        delays.push(ms);
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
      timeoutMs: 60_000,
    });

    expect(code).toBe(1);
    expect(delays).toEqual([30_000, 30_000]);
    expect(output).toEqual([
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123&event=push 0',
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123&event=push 30',
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123&event=push 60',
      'failure run=not-found sha=abc123',
    ]);
  });

  it('сетевой сбой опроса не считает красным CI и ждёт дальше', async () => {
    const responses: (HttpResponse | Error)[] = [
      new TypeError('fetch failed'),
      { ...jsonResponse({}), ok: false, status: 502 },
      jsonResponse({ workflow_runs: [run('completed', 'success')] }),
    ];
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => {
        const next = responses.shift() ?? jsonResponse({});
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output[0]).toMatch(/ 0 error=сеть: TypeError: fetch failed$/);
    expect(output[1]).toMatch(/ 30 error=GitHub API 502: /);
    expect(output.at(-1)).toBe('success https://github.com/acme/game/actions/runs/42');
  });

  it('если GitHub недоступен до конца ожидания, пишет error и код 2, а не failure', async () => {
    const output: string[] = [];
    let now = 0;

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => {
        throw new TypeError('fetch failed');
      },
      sleep: async (ms: number): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
      timeoutMs: 30_000,
    });

    expect(code).toBe(2);
    expect(output.at(-1)).toBe('error сеть: TypeError: fetch failed');
    expect(output.some((line) => line.startsWith('failure'))).toBe(false);
  });

  it('401 не ждёт таймаута: ошибка доступа сразу уходит наружу', async () => {
    const attempt = waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => ({ ...jsonResponse({}), ok: false, status: 401 }),
      writeLine: () => undefined,
    });

    await expect(attempt).rejects.toBeInstanceOf(GithubRequestError);
  });

  it('красный run остаётся красным, даже если лог job получить не удалось', async () => {
    const responses: (HttpResponse | Error)[] = [
      jsonResponse({ workflow_runs: [run('completed', 'failure')] }),
      jsonResponse({ jobs: [{ id: 7, name: 'tests', conclusion: 'failure' }] }),
      new TypeError('fetch failed'),
    ];
    const output: string[] = [];

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => {
        const next = responses.shift() ?? jsonResponse({});
        if (next instanceof Error) throw next;
        return next;
      },
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(1);
    expect(output).toEqual([
      'лог упавшего job не получен: сеть: TypeError: fetch failed',
      'run_attempt=1',
      'failure job=tests https://github.com/acme/game/actions/runs/42',
    ]);
  });
});

describe('выбор workflow', () => {
  it.each([
    [undefined, false, ['/actions/workflows/ci.yml/runs?head_sha=abc123&event=push&per_page=10']],
    [
      'slow.yml',
      false,
      ['/actions/workflows/slow.yml/runs?head_sha=abc123&event=push&per_page=10'],
    ],
    [
      undefined,
      true,
      [
        '/actions/workflows/ci.yml/runs?head_sha=abc123&event=push&per_page=10',
        '/actions/runs?head_sha=abc123&event=push&per_page=50',
      ],
    ],
  ])('workflow %s (остальные: %s) опрашивает свои прогоны', async (workflow, all, paths) => {
    const urls: string[] = [];
    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      ...(workflow === undefined ? {} : { workflow }),
      otherWorkflows: all,
      fetchFn: async (url: string): Promise<HttpResponse> => {
        urls.push(url);
        if (url.includes('/actions/runs?'))
          return jsonResponse({
            workflow_runs: [
              {
                ...run('completed', 'success'),
                id: 7,
                path: '.github/workflows/pages.yml',
              },
            ],
          });
        return jsonResponse({ workflow_runs: [run('completed', 'success')] });
      },
      writeLine: () => undefined,
    });

    expect(code).toBe(0);
    expect(urls).toEqual(paths.map((path) => `https://api.github.com/repos/acme/game${path}`));
  });
});

describe('остальные workflow того же SHA', () => {
  const other = (id: number, path: string, status: string, conclusion: string | null = null) => ({
    id,
    head_sha: 'abc123',
    status,
    conclusion,
    html_url: `https://github.com/acme/game/actions/runs/${id}`,
    path,
  });
  const CI = other(42, '.github/workflows/ci.yml', 'completed', 'success');

  it('не объявляет успех, пока обязательный pages.yml не создан', async () => {
    const output: string[] = [];
    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      otherWorkflows: true,
      once: true,
      fetchFn: async (url: string): Promise<HttpResponse> =>
        jsonResponse({ workflow_runs: url.includes('/actions/workflows/') ? [CI] : [CI] }),
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(3);
    expect(output[0]).toMatch(/^pending /u);
  });

  const waitWith = async (all: unknown[][]) => {
    const output: string[] = [];
    let now = 0;
    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      otherWorkflows: true,
      timeoutMs: 120_000,
      fetchFn: async (url: string): Promise<HttpResponse> => {
        if (url.includes('/actions/workflows/')) return jsonResponse({ workflow_runs: [CI] });
        if (url.includes('/jobs?')) return jsonResponse({ jobs: [] });
        return jsonResponse({ workflow_runs: all.shift() ?? [] });
      },
      sleep: async (ms: number): Promise<void> => {
        now += ms;
      },
      now: () => now,
      writeLine: (line: string) => output.push(line),
    });
    return { code, output };
  };

  it('упавший за 0 с pages.yml (файл не принят, job нет) — красный CI с именем файла', async () => {
    // 2026-10-14: все прогоны pages.yml 07/T4 падали, ci.yml был зелёным, ревью приняло.
    const { code, output } = await waitWith([
      [other(7, '.github/workflows/pages.yml', 'completed', 'failure'), CI],
    ]);
    expect(code).toBe(1);
    expect(output.at(-1)).toBe('failure job=pages.yml https://github.com/acme/game/actions/runs/7');
  });

  it('идущий другой workflow ждётся, зелёный — успех', async () => {
    const { code, output } = await waitWith([
      [other(7, '.github/workflows/pages.yml', 'in_progress'), CI],
      [other(7, '.github/workflows/pages.yml', 'completed', 'success'), CI],
    ]);
    expect(code).toBe(0);
    expect(output).toEqual([
      'pending https://github.com/acme/game/actions/runs/7 0',
      'success https://github.com/acme/game/actions/runs/42',
    ]);
  });

  it('не принимает отменённый обязательный workflow без успешной новой попытки', async () => {
    const { code, output } = await waitWith([
      [other(7, '.github/workflows/pages.yml', 'completed', 'cancelled'), CI],
      [other(8, '.github/workflows/pages.yml', 'completed', 'success'), CI],
    ]);

    expect(code).toBe(0);
    expect(output[0]).toMatch(/^pending /u);
  });

  it('slow.yml, отменённые и старые прогоны того же файла не решают', async () => {
    const { code } = await waitWith([
      [
        other(9, '.github/workflows/slow.yml', 'in_progress'),
        other(8, '.github/workflows/lint.yml', 'completed', 'cancelled'),
        other(7, '.github/workflows/pages.yml', 'completed', 'success'),
        other(6, '.github/workflows/pages.yml', 'completed', 'failure'),
        CI,
      ],
    ]);
    expect(code).toBe(0);
  });
});

describe('один опрос', () => {
  const once = (response: HttpResponse | Error) => {
    const output: string[] = [];
    const result = waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      once: true,
      fetchFn: async (): Promise<HttpResponse> => {
        if (response instanceof Error) throw response;
        return response;
      },
      sleep: async (): Promise<void> => {
        throw new Error('один опрос не ждёт');
      },
      writeLine: (line: string) => output.push(line),
    });
    return { result, output };
  };

  it('идущий прогон — код 3 и строка pending, без ожидания', async () => {
    const { result, output } = once(jsonResponse({ workflow_runs: [run('in_progress')] }));
    expect(await result).toBe(3);
    expect(output).toEqual(['pending https://github.com/acme/game/actions/runs/42 0']);
  });

  it('ещё не созданный прогон — тоже код 3, а не красный CI', async () => {
    const { result } = once(jsonResponse({ workflow_runs: [] }));
    expect(await result).toBe(3);
  });

  it('завершённый зелёный — код 0', async () => {
    const { result } = once(jsonResponse({ workflow_runs: [run('completed', 'success')] }));
    expect(await result).toBe(0);
  });

  it('сбой сети — код 2 и строка error', async () => {
    const { result, output } = once(new TypeError('fetch failed'));
    expect(await result).toBe(2);
    expect(output.at(-1)).toBe('error сеть: TypeError: fetch failed');
  });
});
