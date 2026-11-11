import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { scoreOption, scoreOptionByFeatures, type BotWeights } from '../src/bots/brain.ts';
import type { ActionFeatureContext } from '../src/bots/features.ts';
import type { CommandOption } from '../src/bots/options/types.ts';
import type { Fp } from '../src/math/int.ts';

const EFFECTS = ['cost', 'income', 'strength', 'defense', 'supply', 'upkeep', 'risk', 'spread'];
const CONTEXTS = ['threat', 'goldShare', 'neutralBorderShare'];

const fpArb = fc.integer({ min: -3000, max: 3000 }).map((n) => n as Fp);
const contextArb: fc.Arbitrary<ActionFeatureContext> = fc.record({
  threat: fpArb,
  goldShare: fpArb,
  neutralBorderShare: fpArb,
});
const effectsArb = fc
  .uniqueArray(fc.constantFrom(...EFFECTS), { maxLength: 6 })
  .chain((names) => fc.tuple(...names.map(() => fpArb)).map((values) => ({ names, values })))
  .map(({ names, values }) => Object.fromEntries(names.map((name, i) => [name, values[i] as Fp])));
// Веса — дробные числа, как в weights.json: порядок сложения влияет на последний бит.
const weightsArb = fc
  .uniqueArray(
    fc.constantFrom(
      ...CONTEXTS,
      ...EFFECTS,
      ...EFFECTS.flatMap((e) => CONTEXTS.map((c) => `${e}*${c}`)),
    ),
    { maxLength: 40 },
  )
  .chain((names) =>
    fc
      .tuple(...names.map(() => fc.double({ min: -2, max: 2, noNaN: true })))
      .map((values) => Object.fromEntries(names.map((name, i) => [name, values[i] as number]))),
  );

const optionOf = (effects: Record<string, Fp>): CommandOption =>
  ({ effects, command: { t: 'noop' } }) as unknown as CommandOption;

describe('оценка варианта ботом', () => {
  it('быстрый путь совпадает со словарём признаков до последнего бита', () => {
    fc.assert(
      fc.property(effectsArb, contextArb, weightsArb, (effects, context, weights: BotWeights) => {
        const option = optionOf(effects);
        expect(scoreOption(option, context, weights)).toBe(
          scoreOptionByFeatures(option, context, weights),
        );
      }),
      { numRuns: 500, seed: 7 },
    );
  });

  it('эффект с именем контекста идёт прежним путём и совпадает с эталоном', () => {
    const option = optionOf({ threat: 120 as Fp, cost: 40 as Fp });
    const context = { threat: 300 as Fp, goldShare: 500 as Fp, neutralBorderShare: 100 as Fp };
    const weights: BotWeights = { threat: 0.3, cost: -0.7, 'cost*threat': 0.11 };
    expect(scoreOption(option, context, weights)).toBe(
      scoreOptionByFeatures(option, context, weights),
    );
  });
});
