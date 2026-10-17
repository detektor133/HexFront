import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BitmapText, Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import { drawForecastPlate } from '../src/dev/forecast-plate.ts';
import { createPlanLayer } from '../src/dev/plan-layer.ts';
import { createChip, type ChipState } from '../src/dev/unit-chips.ts';
import { formatSoldiers } from '../src/i18n/format.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { ViewDeltaApplier, ConfirmedViewDeltaStream } from '../src/local/view-delta.ts';

const spawnMock = vi.hoisted(() => vi.fn());
const launchMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('@playwright/test', () => ({ chromium: { launch: launchMock } }));

const GEN_MAP_PATH = join(process.cwd(), 'apps/client/dist/maps/gen-42-30.json');
const SOURCE_ROOT = join(process.cwd(), 'apps/client/src');

function equalView(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (ArrayBuffer.isView(left) || ArrayBuffer.isView(right)) {
    if (!ArrayBuffer.isView(left) || !ArrayBuffer.isView(right)) return false;
    if (left.byteLength !== right.byteLength) return false;
    const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
    const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
    return leftBytes.every((value, index) => value === rightBytes[index]);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => equalView(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => key in rightRecord && equalView(leftRecord[key], rightRecord[key]))
  );
}

function installCanvasStub(): void {
  class TestCanvasRenderingContext2D {
    public font = '';

    public scale(_x: number, _y: number): void {}

    public fillText(_text: string, _x: number, _y: number): void {}

    public measureText(value: string): TextMetrics {
      return { width: value.length * 8 } as TextMetrics;
    }
  }
  const context = new TestCanvasRenderingContext2D();
  Object.assign(globalThis, {
    CanvasRenderingContext2D: TestCanvasRenderingContext2D,
    window: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) },
    document: {
      createElement: () => ({ getContext: () => context }),
    },
  });
}

function bitmapTexts(node: Container): BitmapText[] {
  const result: BitmapText[] = [];
  for (const child of node.children) {
    if (child instanceof BitmapText) result.push(child);
    if (child instanceof Container) result.push(...bitmapTexts(child));
  }
  return result;
}

const chipState = (soldiers: number, count: number = 1): ChipState => ({
  color: '#000000',
  army: null,
  type: 'infantry',
  soldiers,
  org: 1,
  supply: 1,
  starving: false,
  count,
  selected: false,
  retreating: false,
  encircled: false,
  ghost: false,
});

describe('дельты вида и текст карты (07/T15)', () => {
  it('критерий 1: на 1 200 тиках не меньше 95 % сообщений после первого являются дельтами и применение после каждого сообщения равно полному виду', () => {
    const map = JSON.parse(readFileSync(GEN_MAP_PATH, 'utf8')) as unknown;
    const created = createLocalEngine(map, 42, 30, undefined, true);
    if ('errors' in created) throw new Error(created.errors.join('\n'));

    const stream = new ConfirmedViewDeltaStream();
    const applier = new ViewDeltaApplier();
    let deltaCount = 0;
    let messageCount = 0;

    for (let tick = 0; tick < 1200; tick += 1) {
      const message = created.tick();
      if (message.t !== 'view') throw new Error('ожидался снимок локального движка');
      const transport = stream.next(message.view, message.events);
      if (transport === null) throw new Error('поток ожидает подтверждение');
      if (transport.kind === 'snapshot') {
        applier.applySnapshot(transport.snapshot);
      } else {
        deltaCount += 1;
        applier.applyDelta(transport.delta);
      }
      stream.acknowledge();
      expect(equalView(applier.view, message.view)).toBe(true);
      messageCount += 1;
    }

    expect(deltaCount / (messageCount - 1)).toBeGreaterThanOrEqual(0.95);
  });

  it('критерий 2: числа солдат и другие меняющиеся числа карты создаются как BitmapText, а не Text', () => {
    installCanvasStub();
    const dynamicNumberLayers = ['dev/unit-chips.ts', 'dev/forecast-plate.ts', 'dev/plan-layer.ts'];
    for (const file of dynamicNumberLayers) {
      const source = readFileSync(join(SOURCE_ROOT, file), 'utf8');
      expect(source, file).toContain('BitmapText');
      expect(source, file).not.toMatch(/new\s+Text\s*\(/u);
    }

    const forecast = new Container();
    drawForecastPlate(
      forecast,
      { icon: 'victory', color: '#000000', text: '−28 %' },
      { x: 0, y: 0 },
      1,
    );
    expect(bitmapTexts(forecast)).toHaveLength(1);
    forecast.destroy({ children: true });

    const plan = createPlanLayer(
      {
        version: 1,
        id: 'test',
        width: 1,
        height: 1,
        terrain: new Uint8Array(1),
        features: new Uint8Array(1),
        rivers: new Uint8Array(1),
        roads: new Uint8Array(1),
        cities: [],
        spawns: [],
      },
      1,
      () => ({ x: 0, y: 0 }),
    );
    plan.setView(
      {
        tick: 0,
        winner: -1,
        playerId: 0,
        hexes: { owner: new Int16Array(1) },
        armies: [],
        plans: [],
      } as never,
      null,
      null,
      { center: { x: 0, y: 0 }, ring: 1, share: 0.5, amount: 100, target: null },
      1,
      2,
    );
    expect(bitmapTexts(plan.container)).toHaveLength(1);
    plan.destroy();

    const deltaSource = readFileSync(join(SOURCE_ROOT, 'local/view-delta.ts'), 'utf8');
    expect(deltaSource).not.toMatch(/JSON\.stringify\(\s*view\b/u);
  });

  it('критерий 3: обновление чисел солдат и отрядов на фишке 10 000 раз сохраняет те же объекты текста и меняет text', () => {
    installCanvasStub();
    const chip = createChip();
    chip.draw(chipState(100, 2));
    const initial = bitmapTexts(chip.root);
    expect(initial).toHaveLength(2);
    const labels = initial as [BitmapText, BitmapText];

    for (let value = 0; value < 10_000; value += 1) {
      chip.draw(chipState((value + 1) * 1000 + 1000, 3));
    }

    const updated = bitmapTexts(chip.root);
    expect(updated).toHaveLength(2);
    expect(updated).toContain(labels[0]);
    expect(updated).toContain(labels[1]);
    expect([labels[0].text, labels[1].text].sort()).toEqual([formatSoldiers(10_001_000), '3']);
    chip.destroy();
  });

  it('критерий 3: запускает preview до page.goto и останавливает его при ошибке', async () => {
    const events: string[] = [];
    const originalFetch = globalThis.fetch;
    const preview = { exitCode: null, kill: vi.fn(() => events.push('kill')) };
    const page = {
      goto: vi.fn(async () => {
        events.push('goto');
        throw new Error('ошибка страницы');
      }),
    };
    const browser = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => events.push('close')),
    };
    spawnMock.mockImplementation(() => {
      events.push('spawn');
      return preview;
    });
    launchMock.mockResolvedValue(browser);
    globalThis.fetch = vi.fn(async () => {
      events.push('ready');
      return { ok: true } as Response;
    });

    try {
      const { runMemoryProbe } = await import('../scripts/memory-probe.ts');
      await expect(runMemoryProbe()).rejects.toThrow('ошибка страницы');
      expect(events).toEqual(['spawn', 'ready', 'goto', 'close', 'kill']);
      expect(spawnMock).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(['preview', '--port', '4173', '--strictPort']),
        expect.objectContaining({ cwd: expect.any(String), stdio: 'ignore' }),
      );
      expect(spawnMock.mock.calls[0]?.[2]).not.toHaveProperty('shell');
    } finally {
      globalThis.fetch = originalFetch;
      spawnMock.mockReset();
      launchMock.mockReset();
    }
  });
});
