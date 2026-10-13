import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { calculateCandidateFitness, candidateSlotForSeed, loadEvolutionMap } from './evaluate.ts';
import { createMatchup, parseOptions, runEvolution, shouldStopForNoExamProgress } from './index.ts';

describe('эволюция весов бота', () => {
  it('разбирает параметры μ,λ-ES и resume', () => {
    expect(parseOptions(['--population=4', '--seeds=2', '--generations=3', '--workers=2'])).toEqual(
      expect.objectContaining({ population: 4, seeds: 2, generations: 3, workers: 2 }),
    );
    expect(() => parseOptions(['--population=1'])).toThrow('population');
    expect(parseOptions(['--resume'])).toEqual(
      expect.objectContaining({ resumePath: expect.stringContaining('resume.json') }),
    );
  });

  it('останавливает прогон без улучшения экзамена после пятого поколения', () => {
    expect(shouldStopForNoExamProgress([100, 100, 100, 100, 99, 100])).toBe(true);
    expect(shouldStopForNoExamProgress([100, 100, 101, 100, 99, 100])).toBe(false);
    expect(shouldStopForNoExamProgress([100, 100, 100, 100, 99])).toBe(false);
  });

  it('сохраняет состояние остановки и продолжает его с resume', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hexfront-evolve-stop-'));
    let examCall = 0;
    const exam = () => ({
      fitness: [100, 90, 90, 90, 90, 90, 80][examCall++] ?? 80,
      wins: 0,
      matches: [],
    });
    const options = {
      population: 2,
      seeds: 1,
      generations: 5,
      workers: 1,
      sigma: 3,
      ticks: 1,
      weightsPath: join(directory, 'weights.json'),
      easyWeightsPath: join(directory, 'weights-easy.json'),
      statePath: join(directory, 'resume.json'),
      reportDirectory: join(directory, 'reports'),
    };
    try {
      await expect(runEvolution(options, { evaluateExam: exam })).rejects.toThrow(
        'нет прогресса по экзамену',
      );
      expect(JSON.parse(await readFile(options.statePath, 'utf8'))).toMatchObject({
        generation: 5,
        examFitnesses: [100, 90, 90, 90, 90, 90],
      });
      const resumed = await runEvolution(
        { ...options, generations: 1, resumePath: options.statePath },
        { evaluateExam: exam },
      );
      expect(resumed.generation).toBe(6);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('меняет место особи между сидами', () => {
    expect(candidateSlotForSeed(2, 41)).not.toBe(candidateSlotForSeed(2, 42));
  });

  it('использует один набор соперников для всех особей поколения', () => {
    const fallback = { alpha: 1 };
    const matchup = createMatchup([{ alpha: 2 }, { alpha: 3 }], fallback);

    expect(matchup.candidateSlot).toBe(0);
    expect(matchup.opponents).toEqual([
      { weights: { alpha: 2 }, slot: 1 },
      { weights: { alpha: 3 }, slot: 2 },
      { weights: fallback, slot: 3 },
      { weights: fallback, slot: 4 },
      { weights: fallback, slot: 5 },
    ]);
  });

  it('выбирает карту small по умолчанию и gen по параметру', () => {
    expect(loadEvolutionMap(42).width).toBe(40);
    expect(loadEvolutionMap(42, 'gen').width).toBe(80);
    expect(parseOptions([]).map).toBe('small');
    expect(parseOptions(['--map=gen']).map).toBe('gen');
  });

  it('штрафует особь только по её собственным метрикам', () => {
    expect(
      calculateCandidateFitness({
        place: 2,
        goldOver5000S: 0,
        unitUnder10S: 0,
        won: false,
      }),
    ).toBe(4000);
    expect(
      calculateCandidateFitness({
        place: 2,
        goldOver5000S: 120,
        unitUnder10S: 30,
        won: false,
      }),
    ).toBe(4000);
  });

  it('сохраняет одинаковые веса при одном и четырёх worker_threads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hexfront-evolve-'));
    try {
      const single = await runEvolution({
        population: 4,
        seeds: 2,
        generations: 2,
        workers: 1,
        sigma: 77,
        ticks: 300,
        weightsPath: join(directory, 'weights-1.json'),
        easyWeightsPath: join(directory, 'weights-1-easy.json'),
        statePath: join(directory, 'resume-1.json'),
        reportDirectory: join(directory, 'report-1'),
      });
      const parallel = await runEvolution({
        population: 4,
        seeds: 2,
        generations: 2,
        workers: 4,
        sigma: 77,
        ticks: 300,
        weightsPath: join(directory, 'weights-4.json'),
        easyWeightsPath: join(directory, 'weights-4-easy.json'),
        statePath: join(directory, 'resume-4.json'),
        reportDirectory: join(directory, 'report-4'),
      });

      expect(parallel.weights).toEqual(single.weights);
      expect(JSON.parse(await readFile(join(directory, 'weights-1-easy.json'), 'utf8'))).toEqual(
        JSON.parse(await readFile(join(directory, 'weights-4-easy.json'), 'utf8')),
      );
      const report = await readFile(join(directory, 'report-4', 'generation-2.md'), 'utf8');
      const initialExam = await readFile(join(directory, 'report-4', 'generation-0.md'), 'utf8');
      expect(initialExam.match(/Экзамен, сид /g)).toHaveLength(6);
      expect(report.match(/Экзамен, сид /g)).toHaveLength(6);
      expect(report).toContain('Экзамен: fitness');
      expect(report).toContain('Места лучшей особи:');
      expect(report).toContain('Победы популяции:');
      expect(JSON.parse(await readFile(join(directory, 'resume-4.json'), 'utf8'))).toMatchObject({
        generation: 2,
        weights: single.weights,
      });
      await expect(
        readFile(join(directory, 'report-4', 'generation-2.md'), 'utf8'),
      ).resolves.toContain('Время поколения:');
      const resumed = await runEvolution({
        population: 4,
        seeds: 1,
        generations: 1,
        workers: 2,
        sigma: 3,
        ticks: 300,
        resumePath: join(directory, 'resume-4.json'),
        weightsPath: join(directory, 'weights-resume.json'),
        statePath: join(directory, 'resume-2.json'),
        reportDirectory: join(directory, 'report-resume'),
      });
      expect(resumed.generation).toBe(3);
      expect(JSON.parse(await readFile(join(directory, 'resume-2.json'), 'utf8'))).toMatchObject({
        seeds: [1, 2],
        sigma: 77,
      });
      await expect(
        readFile(join(directory, 'report-resume', 'generation-3.md'), 'utf8'),
      ).resolves.toContain('Поколение: 3');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
