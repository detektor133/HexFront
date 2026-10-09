import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseOptions, runEvolution } from './index.ts';

describe('эволюция весов бота', () => {
  it('разбирает параметры μ,λ-ES и resume', () => {
    expect(parseOptions(['--population=4', '--seeds=2', '--generations=3', '--workers=2'])).toEqual(
      expect.objectContaining({ population: 4, seeds: 2, generations: 3, workers: 2 }),
    );
    expect(() => parseOptions(['--population=1'])).toThrow('population');
    expect(() => parseOptions(['--resume'])).toThrow('resume');
  });

  it('сохраняет одинаковые веса при одном и четырёх worker_threads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hexfront-evolve-'));
    try {
      const single = await runEvolution({
        population: 4,
        seeds: 2,
        generations: 1,
        workers: 1,
        ticks: 300,
        weightsPath: join(directory, 'weights-1.json'),
        statePath: join(directory, 'resume-1.json'),
        reportDirectory: join(directory, 'report-1'),
      });
      const parallel = await runEvolution({
        population: 4,
        seeds: 2,
        generations: 1,
        workers: 4,
        ticks: 300,
        weightsPath: join(directory, 'weights-4.json'),
        statePath: join(directory, 'resume-4.json'),
        reportDirectory: join(directory, 'report-4'),
      });

      expect(parallel.weights).toEqual(single.weights);
      expect(JSON.parse(await readFile(join(directory, 'resume-4.json'), 'utf8'))).toMatchObject({
        generation: 1,
        weights: single.weights,
      });
      await expect(
        readFile(join(directory, 'report-4', 'generation-1.md'), 'utf8'),
      ).resolves.toContain('Поколение: 1');
      const resumed = await runEvolution({
        population: 4,
        seeds: 2,
        generations: 1,
        workers: 2,
        ticks: 300,
        resumePath: join(directory, 'resume-4.json'),
        weightsPath: join(directory, 'weights-resume.json'),
        statePath: join(directory, 'resume-2.json'),
        reportDirectory: join(directory, 'report-resume'),
      });
      expect(resumed.generation).toBe(2);
      await expect(
        readFile(join(directory, 'report-resume', 'generation-2.md'), 'utf8'),
      ).resolves.toContain('Поколение: 2');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
