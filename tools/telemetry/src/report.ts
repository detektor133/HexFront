export interface TelemetryLine {
  readonly tick: number;
  readonly matchSeconds: number;
  readonly frameMs: { readonly p95: number };
  readonly heap: { readonly used: number | null };
  readonly pixi: {
    readonly textures: number;
    readonly text: number;
    readonly objects: number;
    readonly graphicsInstructions?: readonly number[];
  };
  readonly worker: { readonly tickMsAvg: number };
  readonly game: { readonly units: number };
}

export interface TelemetryMinute {
  readonly minute: number;
  readonly tickMs: number;
  readonly frameP95: number;
  readonly heapMb: number | null;
  readonly textures: number;
  readonly text: number;
  readonly objects: number;
  readonly units: number;
  readonly graphicsInstructions: readonly number[];
}

export function parseTelemetry(text: string): TelemetryLine[] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      if (!isTelemetryLine(value)) throw new Error('Некорректная строка телеметрии');
      return value;
    });
}

function isTelemetryLine(value: unknown): value is TelemetryLine {
  if (!value || typeof value !== 'object') return false;
  const line = value as Partial<TelemetryLine>;
  return (
    typeof line.tick === 'number' &&
    typeof line.matchSeconds === 'number' &&
    typeof line.frameMs?.p95 === 'number' &&
    typeof line.worker?.tickMsAvg === 'number' &&
    typeof line.pixi?.textures === 'number' &&
    (line.pixi?.graphicsInstructions === undefined ||
      (Array.isArray(line.pixi.graphicsInstructions) &&
        line.pixi.graphicsInstructions.every((count) => typeof count === 'number'))) &&
    typeof line.game?.units === 'number'
  );
}

/** Берёт последний замер каждой минуты матча, чтобы отчёт оставался компактным. */
export function aggregateMinutes(lines: readonly TelemetryLine[]): TelemetryMinute[] {
  const minutes = new Map<number, TelemetryLine>();
  for (const line of lines) minutes.set(Math.floor(line.matchSeconds / 60), line);
  return [...minutes.entries()].map(([minute, line]) => ({
    minute,
    tickMs: line.worker.tickMsAvg,
    frameP95: line.frameMs.p95,
    heapMb: line.heap.used === null ? null : line.heap.used / 1024 / 1024,
    textures: line.pixi.textures,
    text: line.pixi.text,
    objects: line.pixi.objects,
    units: line.game.units,
    graphicsInstructions: line.pixi.graphicsInstructions ?? [],
  }));
}

export function fastestGrowth(rows: readonly TelemetryMinute[]): string {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return 'нет данных';
  const values = [
    ['текстуры', last.textures - first.textures],
    ['Text', last.text - first.text],
    ['объекты сцены', last.objects - first.objects],
    ['отряды', last.units - first.units],
    ['heap МБ', (last.heapMb ?? 0) - (first.heapMb ?? 0)],
  ] as const;
  return values.reduce((best, current) => (current[1] > best[1] ? current : best))[0];
}

export function formatReport(lines: readonly TelemetryLine[]): string[] {
  const rows = aggregateMinutes(lines);
  const output = [
    'мин | тик мс | кадр p95 | heap МБ | текстуры | Text | объекты | отряды | Graphics',
  ];
  output.push(
    ...rows.map(
      (row) =>
        `${row.minute} | ${row.tickMs.toFixed(2)} | ${row.frameP95.toFixed(2)} | ${row.heapMb?.toFixed(1) ?? '—'} | ${row.textures} | ${row.text} | ${row.objects} | ${row.units} | ${row.graphicsInstructions.join(',')}`,
    ),
  );
  output.push(`быстрее всего растёт: ${fastestGrowth(rows)}`);
  return output.slice(0, 20);
}
