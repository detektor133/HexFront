import { Application } from 'pixi.js';
import { useEffect, useRef } from 'react';

import styles from './DevUnitsPage.module.css';
import { createChip, type ChipState } from './unit-chips.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
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
      count: 1,
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
      count: 2,
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
      count: 3,
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
      count: 4,
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
      count: 2,
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
      count: 1,
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
      count: 3,
      selected: false,
      retreating: false,
      encircled: false,
      ghost: false,
    },
  },
];

/** Отладочная страница всех состояний фишки из `docs/art/units.md`. */
export function DevUnitsPage(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = new Application();
    let alive = true;
    void app
      .init({ background: tokens.map.background, resizeTo: host, antialias: true })
      .then(() => {
        if (!alive) {
          app.destroy({ removeView: true }, { children: true, context: true });
          return;
        }
        host.appendChild(app.canvas);
        const width = Math.max(1, host.clientWidth);
        const columns = width >= 900 ? 2 : 1;
        const rowHeight = 82;
        SAMPLE_STATES.forEach((sample, index) => {
          const chip = createChip();
          chip.root.position.set(
            columns === 1 ? width / 2 : index % 2 === 0 ? width / 4 : (width * 3) / 4,
            36 + Math.floor(index / columns) * rowHeight,
          );
          chip.root.scale.set(1);
          chip.draw(sample.state);
          app.stage.addChild(chip.root);
        });
      });
    return () => {
      alive = false;
      app.destroy({ removeView: true }, { children: true, context: true });
    };
  }, []);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('dev.units.title')}</h1>
      <div ref={hostRef} className={styles.canvas} data-testid="units-stage" />
      <div className={styles.labels}>
        {SAMPLE_STATES.map((sample) => (
          <span key={sample.label}>{t(sample.label)}</span>
        ))}
      </div>
    </main>
  );
}
