import { describe, expect, it } from 'vitest';

import { buildVerifySteps } from './verify-steps.ts';

describe('шаги рабочей проверки', () => {
  it('запускает depcheck для изменённого кода до lint и тестов', () => {
    expect(
      buildVerifySteps(['packages/sim/src/queries/forecast.ts']).map((step) => step.name),
    ).toEqual(['build', 'types', 'depcheck', 'lint', 'prettier', 'tests']);
  });

  it('не теряет depcheck при полном прогоне', () => {
    expect(buildVerifySteps(null).map((step) => step.name)).toContain('depcheck');
  });
});
