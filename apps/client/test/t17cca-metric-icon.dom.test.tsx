import {
  IconArrowUp,
  IconClock,
  IconCoin,
  IconPackage,
  IconShield,
  IconTrendingUp,
  IconUsers,
} from '@tabler/icons-react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MetricIcon, type MetricIconName } from '../src/ui/metric-icon.tsx';

afterEach(cleanup);

function pathData(svg: SVGElement): string[] {
  return Array.from(svg.querySelectorAll('path'), (path) => path.getAttribute('d') ?? '');
}

describe('07/T17cca: соответствие ключей семантическим иконкам', () => {
  it.each([
    ['people', IconUsers],
    ['population', IconUsers],
    ['gold', IconCoin],
    ['supply', IconPackage],
    ['time', IconClock],
    ['growth', IconTrendingUp],
    ['fort', IconShield],
    ['improvement', IconArrowUp],
    ['organization', IconShield],
  ] as const)('связывает %s с правильным Tabler Icon', (name, ExpectedIcon) => {
    const { container, unmount } = render(<MetricIcon name={name as MetricIconName} />);
    const actual = container.querySelector('svg');
    expect(actual).not.toBeNull();
    const actualPaths = pathData(actual as SVGElement);
    unmount();

    const expectedContainer = document.createElement('div');
    render(<ExpectedIcon />, { container: expectedContainer });
    const expected = expectedContainer.querySelector('svg');
    expect(expected).not.toBeNull();
    expect(actualPaths).toEqual(pathData(expected as SVGElement));
  });
});
