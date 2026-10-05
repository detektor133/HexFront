import { describe, expect, it } from 'vitest';

import { aggregateMinutes, fastestGrowth, formatReport, parseTelemetry } from './report.ts';

const line = (matchSeconds: number, textures: number) => ({
  tick: matchSeconds * 10,
  matchSeconds,
  frameMs: { p95: 18 },
  heap: { used: 64 * 1024 * 1024 },
  pixi: { textures, text: 3, objects: 12 },
  worker: { tickMsAvg: 4 },
  game: { units: 20 },
});

describe('отчёт телеметрии', () => {
  it('отвергает строку без обязательных полей', () => {
    expect(() => parseTelemetry('{"tick": 1}\n')).toThrow('Некорректная строка телеметрии');
  });

  it('берёт последний замер минуты матча', () => {
    expect(aggregateMinutes([line(5, 2), line(59, 3), line(60, 4)])).toMatchObject([
      { minute: 0, textures: 3 },
      { minute: 1, textures: 4 },
    ]);
  });

  it('на синтетическом росте текстур называет их самым быстрым показателем', () => {
    expect(fastestGrowth(aggregateMinutes([line(0, 1), line(60, 12)]))).toBe('текстуры');
  });

  it('печатает компактную таблицу синтетического файла', () => {
    expect(formatReport(parseTelemetry(`${JSON.stringify(line(0, 1))}\n`))).toEqual([
      'мин | тик мс | кадр p95 | heap МБ | текстуры | Text | объекты | отряды',
      '0 | 4.00 | 18.00 | 64.0 | 1 | 3 | 12 | 20',
      'быстрее всего растёт: текстуры',
    ]);
  });
});
