import { describe, expect, it } from 'vitest';

import { withDepot } from '../../src/state/building.ts';
import { mainNetworkMask, recomputeAllNetworks } from '../../src/state/network.ts';
import { city, own, scenario } from '../scenario/dsl.ts';

// Столица на западном острове, второй остров за морем; порты — склады у воды.
const MAP = `
  A1 a  ~  ~  ~  a  a  a  a
  a  a  ~  ~  ~  a  a  a  a
  a  a  ~  ~  ~  a  a  a  a
`;
const legend = { A1: city('A', 1, { capital: true }), a: own('A') };

function setup() {
  const s = scenario(MAP, { legend });
  const w = s.state.map.width;
  const west = 1;
  const east = 5;
  const inland = 8 + w;
  s.state.hexes.building[west] = withDepot(0, 1);
  s.state.hexes.building[east] = withDepot(0, 1);
  s.state.hexes.building[inland] = withDepot(0, 1);
  recomputeAllNetworks(s.state);
  return { s, west, east, inland };
}

describe('снабжение через море', () => {
  it('склад за морем входит в основную сеть через порты, как по дороге', () => {
    const { s, east } = setup();
    expect(mainNetworkMask(s.state, 0)[east]).toBe(1);
    const net = s.state.networks.find((n) => n.id === s.state.hexes.network[east]);
    expect(net?.isMain).toBe(true);
  });

  it('склад вдали от воды морем не связан: нужна дорога', () => {
    const { s, inland } = setup();
    expect(mainNetworkMask(s.state, 0)[inland]).toBe(0);
  });

  it('без порта у столицы моря нет: заморский склад остаётся отдельной сетью', () => {
    const { s, west, east } = setup();
    s.state.hexes.building[west] = 0;
    recomputeAllNetworks(s.state);
    expect(mainNetworkMask(s.state, 0)[east]).toBe(0);
  });
});
