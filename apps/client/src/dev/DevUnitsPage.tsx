import { Application } from 'pixi.js';
import { useEffect, useRef } from 'react';

import { FP, loadMap, type Fp } from '@hexfront/sim';

import styles from './DevUnitsPage.module.css';
import { createChip, type ChipState } from './unit-chips.ts';
import { createUnitLayer } from './unit-layer.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { createLocalEngine } from '../local/engine.ts';
import { armyColor, relationColor } from '../theme/colors.ts';
import { tokens } from '../theme/tokens.ts';

interface Sample {
  readonly label: MessageKey;
  readonly state: ChipState;
}

const SAMPLE_STATES: readonly Sample[] = [
  {
    label: 'dev.units.normal',
    state: {
      color: relationColor(0, 0),
      army: armyColor(1),
      type: 'infantry',
      soldiers: 850,
      org: 0.82,
      supply: 0.92,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.selected',
    state: {
      color: relationColor(0, 0),
      army: armyColor(2),
      type: 'armor',
      soldiers: 1400,
      org: 0.76,
      supply: 0.8,
      starving: false,
      selected: true,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.lowSupply',
    state: {
      color: relationColor(0, 0),
      army: armyColor(3),
      type: 'artillery',
      soldiers: 3200,
      org: 0.64,
      supply: 0.42,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.encircled',
    state: {
      color: relationColor(0, 0),
      army: armyColor(4),
      type: 'infantry',
      soldiers: 12000,
      org: 0.28,
      supply: 0,
      starving: true,
      selected: false,
      retreating: false,
      encircled: true,
      ghost: false,
    },
  },
  {
    label: 'dev.units.retreating',
    state: {
      color: relationColor(0, 0),
      army: armyColor(5),
      type: 'armor',
      soldiers: 900,
      org: 0.36,
      supply: 0.6,
      starving: false,
      selected: false,
      retreating: true,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.ghost',
    state: {
      color: relationColor(0, 0),
      army: null,
      type: 'artillery',
      soldiers: 500,
      org: 0.55,
      supply: null,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: true,
    },
  },
  {
    label: 'dev.units.mixedArmy',
    state: {
      color: relationColor(1, 0),
      army: null,
      type: 'infantry',
      soldiers: 2400,
      org: 0.7,
      supply: null,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
];

const STACK_STATES: readonly Sample[] = [
  {
    label: 'dev.units.normal',
    state: {
      color: relationColor(0, 0),
      army: armyColor(1),
      type: 'infantry',
      soldiers: 1250,
      org: 0.82,
      supply: 0.92,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.selected',
    state: {
      color: relationColor(0, 0),
      army: armyColor(2),
      type: 'armor',
      soldiers: 620,
      org: 0.7,
      supply: 0.6,
      starving: false,
      selected: true,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
  {
    label: 'dev.units.lowSupply',
    state: {
      color: relationColor(0, 0),
      army: armyColor(3),
      type: 'artillery',
      soldiers: 180,
      org: 0.5,
      supply: 0.42,
      starving: false,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
];

function addStackScene(app: Application, width: number, height: number, mapJson: unknown): void {
  const loaded = loadMap(mapJson);
  if (!loaded.ok) throw new Error(loaded.errors.join('; '));
  const engine = createLocalEngine(mapJson, 42, 2);
  if ('errors' in engine) throw new Error(engine.errors.join('; '));
  const view = engine.snapshot().view;
  const original = view.units.find((unit) => unit.owner === view.playerId);
  if (!original) throw new Error('Свой отряд не найден');
  const units = STACK_STATES.map(({ state }, index) => ({
    ...original,
    id: original.id + index,
    type: state.type,
    soldiers: (state.soldiers * FP) as Fp,
    org: Math.round(state.org * FP) as Fp,
    supplyLevel: Math.round((state.supply ?? 0) * FP) as Fp,
    armyId: index === 1 ? 2 : 1,
    order: 'idle' as const,
    moveTicks: 0,
    moveTotal: 0,
    path: [],
    fireTarget: -1,
    attackState: null,
  }));
  const layer = createUnitLayer(loaded.map.width, tokens.map.hexRadius, () => ({
    x: width / 2,
    y: height / 2,
  }));
  layer.setView(
    {
      ...view,
      cities: [],
      units,
      armies: [
        { id: 1, number: 1, name: '1', auto: false },
        { id: 2, number: 2, name: '2', auto: false },
      ],
    },
    { hex: null, units: [units[1]?.id ?? -1], target: null },
    0,
  );
  app.stage.addChild(layer.container);
}

/** Отладочная страница всех состояний фишки из `docs/art/units.md`. */
export function DevUnitsPage(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const stackScene = new URLSearchParams(window.location.search).get('unitStack') === 'three';
  const samples = stackScene ? STACK_STATES : SAMPLE_STATES;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    let alive = true;
    let initialized = false;
    void app
      .init({ background: tokens.map.background, resizeTo: host, antialias: true })
      .then(async () => {
        initialized = true;
        if (!alive) {
          app.destroy({ removeView: true }, { children: true, context: true });
          return;
        }
        host.appendChild(app.canvas);
        const width = Math.max(1, host.clientWidth);
        if (stackScene) {
          const response = await fetch('/maps/small.json');
          const mapJson: unknown = await response.json();
          if (alive) addStackScene(app, width, host.clientHeight, mapJson);
          return;
        }
        samples.forEach((sample, index) => {
          const chip = createChip();
          const columns = width >= 900 ? 2 : 1;
          const rowHeight = 82;
          const x = stackScene
            ? width / 2
            : columns === 1
              ? width / 2
              : index % 2 === 0
                ? width / 4
                : (width * 3) / 4;
          const y = stackScene
            ? host.clientHeight / 2 + (index - 1) * 28
            : 36 + Math.floor(index / columns) * rowHeight;
          chip.root.position.set(x, y);
          chip.root.scale.set(1);
          chip.draw(sample.state);
          app.stage.addChild(chip.root);
        });
      });
    return () => {
      alive = false;
      if (initialized) app.destroy({ removeView: true }, { children: true, context: true });
    };
  }, [samples, stackScene]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('dev.units.title')}</h1>
      <div
        ref={hostRef}
        className={stackScene ? `${styles.canvas} ${styles.stackCanvas}` : styles.canvas}
        data-testid="units-stage"
      />
      {!stackScene && (
        <div className={styles.labels}>
          {samples.map((sample, index) => (
            <span key={`${sample.label}-${index}`}>{t(sample.label)}</span>
          ))}
        </div>
      )}
    </main>
  );
}
