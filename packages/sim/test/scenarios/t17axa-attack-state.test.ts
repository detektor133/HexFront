import { describe, expect, it } from 'vitest';

import { playerView } from '../../src/queries/player-view.ts';
import { at, attack, city, own, scenario } from '../scenario/dsl.ts';

const legend = {
  A1: city('A', 1, { capital: true }),
  a: own('A'),
  B1: city('B', 1, { capital: true }),
  b: own('B'),
  C1: city('C', 1, { capital: true }),
  c: own('C'),
};

const FIELD = `
  ~  ~  ~  ~  ~  ~  ~  ~  ~
  A1 a  a  b  b  C1 c  c  B1
  ~  ~  ~  ~  ~  ~  ~  ~  ~
`;

type AttackState = {
  readonly target: number;
  readonly advantage: number;
  readonly status: 'success' | 'warning' | 'danger';
} | null;

function attackState(view: ReturnType<typeof playerView>, unitId: number): AttackState {
  const unit = view.units.find((candidate) => candidate.id === unitId);
  return (unit as unknown as { attackState: AttackState } | undefined)?.attackState ?? null;
}

describe('07/T17axa: состояние атаки и локальная оценка боя', () => {
  it('проверяет атаку только по order «attack» и target, а не по выбору или пути', () => {
    const s = scenario(FIELD, { legend });
    const attacker = s.unit('A', 'infantry', 600, at(2, 1));
    const target = at(3, 1);
    const targetHex = target.col + target.row * s.state.map.width;
    s.unit('B', 'infantry', 200, target);

    const before = playerView(s.state, 0).units.find((unit) => unit.id === attacker);
    expect(before?.order).toBe('idle');
    expect(attackState(playerView(s.state, 0), attacker)).toBeNull();

    s.cmd('A', attack([attacker], target));
    s.runTicks(1);

    const after = playerView(s.state, 0).units.find((unit) => unit.id === attacker);
    expect(after?.order).toBe('attack');
    expect(after?.target).toBe(targetHex);
    expect(attackState(playerView(s.state, 0), attacker)?.target).toBe(targetHex);
  });

  it('вычисляет преимущество по временам прогноза и инвертирует его для защитника', () => {
    const s = scenario(FIELD, { legend });
    const attacker = s.unit('A', 'infantry', 600, at(2, 1));
    const secondAttacker = s.unit('A', 'infantry', 600, at(2, 1));
    const target = at(3, 1);
    const targetHex = target.col + target.row * s.state.map.width;
    s.unit('B', 'infantry', 200, target);
    s.cmd('A', attack([attacker, secondAttacker], target));
    s.runTicks(1);

    // При двух атакующих по 600 солдат и защитнике в 200 солдат времена до слома
    // дают преимущество атакующего 92; для защитника стороны инвертируются: 100 − 92 = 8.
    const attackerState = attackState(playerView(s.state, 0), attacker);
    const defenderState = attackState(playerView(s.state, 1), attacker);

    expect(attackerState).toMatchObject({ target: targetHex, advantage: 92, status: 'success' });
    expect(defenderState).toMatchObject({ target: targetHex, advantage: 8, status: 'danger' });
  });

  it('использует цвета success, warning и danger из исхода прогноза', () => {
    const run = (attackerSoldiers: number, defenderSoldiers: number): AttackState => {
      const s = scenario(FIELD, { legend });
      const attacker = s.unit('A', 'infantry', attackerSoldiers, at(2, 1));
      s.unit('B', 'infantry', defenderSoldiers, at(3, 1));
      s.cmd('A', attack([attacker], at(3, 1)));
      s.runTicks(1);
      return attackState(playerView(s.state, 0), attacker);
    };

    expect(run(900, 200)?.status).toBe('success');
    expect(run(800, 500)?.status).toBe('warning');
    expect(run(100, 900)?.status).toBe('danger');
  });

  it('не выдаёт локальную оценку игроку, не участвующему в бою', () => {
    const s = scenario(FIELD, { legend });
    const attacker = s.unit('A', 'infantry', 600, at(2, 1));
    s.unit('B', 'infantry', 200, at(3, 1));
    s.cmd('A', attack([attacker], at(3, 1)));
    s.runTicks(1);

    expect(attackState(playerView(s.state, 2), attacker)).toBeNull();
  });
});
