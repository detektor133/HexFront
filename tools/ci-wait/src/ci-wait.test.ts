import { describe, expect, it } from 'vitest';

import { parseGithubRepo, waitForCi, type HttpResponse } from './ci-wait.ts';

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
    expect(output).toEqual(['success https://github.com/acme/game/actions/runs/42']);
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
    expect(output).toEqual(['failure run=not-found sha=abc123']);
  });
});
