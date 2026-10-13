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

const run = (status: string, conclusion: string | null = null): unknown => ({
  id: 42,
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

  it('выбирает завершённый run, если API вернул несколько run для SHA', async () => {
    const responses = [
      jsonResponse({
        workflow_runs: [
          run('in_progress'),
          {
            id: 43,
            head_sha: 'abc123',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/game/actions/runs/43',
          },
        ],
      }),
    ];
    const output: string[] = [];

    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      fetchFn: async (): Promise<HttpResponse> => responses.shift() ?? jsonResponse({}),
      writeLine: (line: string) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output).toEqual(['success https://github.com/acme/game/actions/runs/43']);
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
    expect(output.slice(0, -1)).toEqual(
      Array.from({ length: 30 }, (_, index) => `строка ${index + 6}`),
    );
    expect(output.at(-1)).toBe('failure job=tests https://github.com/acme/game/actions/runs/42');
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
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123 0',
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123 30',
      'pending https://api.github.com/repos/acme/game/actions/workflows/ci.yml/runs?head_sha=abc123 60',
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
      'failure job=tests https://github.com/acme/game/actions/runs/42',
    ]);
  });
});

describe('выбор workflow', () => {
  it.each([
    [undefined, '/actions/workflows/ci.yml/runs?head_sha=abc123'],
    ['slow.yml', '/actions/workflows/slow.yml/runs?head_sha=abc123'],
  ])('workflow %s опрашивает только свои прогоны', async (workflow, path) => {
    const urls: string[] = [];
    const code = await waitForCi({
      repo: 'acme/game',
      sha: 'abc123',
      ...(workflow === undefined ? {} : { workflow }),
      fetchFn: async (url: string): Promise<HttpResponse> => {
        urls.push(url);
        return jsonResponse({ workflow_runs: [run('completed', 'success')] });
      },
      writeLine: () => undefined,
    });

    expect(code).toBe(0);
    expect(urls).toEqual([`https://api.github.com/repos/acme/game${path}&per_page=10`]);
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
