import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BitmapText, Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import { createChip, type ChipState } from '../src/dev/unit-chips.ts';
import { createLocalEngine } from '../src/local/engine.ts';
import { ViewDeltaApplier, ConfirmedViewDeltaStream } from '../src/local/view-delta.ts';

const GEN_MAP_PATH = join(process.cwd(), 'apps/client/dist/maps/gen-42-30.json');
const SOURCE_ROOT = join(process.cwd(), 'apps/client/src');

function installCanvasStub(): void {
  class TestCanvasRenderingContext2D {
    public font = '';

    public measureText(value: string): TextMetrics {
      return { width: value.length * 8 } as TextMetrics;
    }
  }
  const context = new TestCanvasRenderingContext2D();
  Object.assign(globalThis, {
    CanvasRenderingContext2D: TestCanvasRenderingContext2D,
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
      expect(applier.view).toEqual(message.view);
      messageCount += 1;
    }

    expect(deltaCount / (messageCount - 1)).toBeGreaterThanOrEqual(0.95);
  });

  it('критерий 2: числа солдат и другие меняющиеся числа карты создаются как BitmapText, а не Text', () => {
    const unitChips = readFileSync(join(SOURCE_ROOT, 'dev/unit-chips.ts'), 'utf8');
    expect(unitChips).toContain('BitmapText');
    expect(unitChips).not.toMatch(/new\s+Text\s*\(/u);

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
      chip.draw(chipState(value + 1, 3));
    }

    const updated = bitmapTexts(chip.root);
    expect(updated).toHaveLength(2);
    expect(updated).toContain(labels[0]);
    expect(updated).toContain(labels[1]);
    expect([labels[0].text, labels[1].text].sort()).toEqual(['10 001', '3']);
    chip.destroy();
  });
});
