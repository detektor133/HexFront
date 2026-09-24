import { describe, expect, it } from 'vitest';

import { TAX_DEFAULT } from '../../src/balance.ts';
import type { Fp } from '../../src/math/int.ts';
import { hashState } from '../../src/state/hash.ts';
import { taxGrowthMult } from '../../src/systems/tax.ts';
import { city, own, scenario, setTax } from '../scenario/dsl.ts';

const MAP = `
  .  .  .
  .  A1 a
  .  .  .
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };
const pct = (p: number): Fp => (p * 10) as Fp;

describe('налог', () => {
  it.each([
    [0, 1400],
    [100, 1200],
    [200, 1000],
    [300, 750],
    [400, 500],
  ])('множитель роста при налоге %i ‰ равен %i', (tax, mult) => {
    expect(taxGrowthMult(tax as Fp)).toBe(mult);
  });

  it('фактический налог идёт к выбранному со скоростью 2 п. п./с: с 20 % на 40 % за 10 с', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', setTax(40));
    s.runSeconds(5);
    expect(s.player('A').taxEffective).toBe(pct(30));
    s.runSeconds(5);
    expect(s.player('A').taxEffective).toBe(pct(40));
    s.runSeconds(5);
    expect(s.player('A').taxEffective).toBe(pct(40));
  });

  it('налог снижается с той же скоростью', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', setTax(0));
    s.runTicks(99);
    expect(s.player('A').taxEffective).toBe(2);
    s.runTicks(1);
    expect(s.player('A').taxEffective).toBe(0);
  });

  it('допустимая ставка принимается без отказа', () => {
    const s = scenario(MAP, { legend });
    s.cmd('A', setTax(35));
    s.runSeconds(1);
    expect(s.player('A').taxTarget).toBe(pct(35));
    expect(s.lastEvent('commandRejected')).toBeUndefined();
  });

  it.each([45, -5, 12, 100])('ставка %i %% отклоняется и не меняет состояние', (p) => {
    const a = scenario(MAP, { legend });
    const b = scenario(MAP, { legend });
    a.cmd('A', setTax(p));
    a.runTicks(1);
    b.runTicks(1);
    expect(a.lastEvent('commandRejected')).toMatchObject({ reason: 'invalidTaxRate' });
    expect(a.player('A').taxTarget).toBe(TAX_DEFAULT);
    expect(hashState(a.state)).toBe(hashState(b.state));
  });
});
