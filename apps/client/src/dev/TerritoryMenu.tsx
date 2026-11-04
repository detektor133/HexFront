import { IconSwords, IconX } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { FP, type Command, type PlayerView } from '@hexfront/sim';

import { DiplomacyBlock } from './DiplomacyBlock.tsx';
import styles from './TerritoryMenu.module.css';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

const MENU_WIDTH = 264;
const EDGE = 8;

/**
 * Предел слайдера наступления: солдаты в отрядах плюс половина населения — недостающих ИИ
 * закупит и подведёт (`wanted` армии).
 */
function ownSoldiers(view: PlayerView): number {
  const total = view.units
    .filter((unit) => unit.owner === view.playerId)
    .reduce((sum, unit) => sum + unit.soldiers, 0);
  return Math.max(1, Math.floor((total + view.me.popTotal / 2) / FP));
}

/**
 * Меню чужой страны по ПКМ (удержанию пальцем) без выбранных отрядов: дипломатия и наступление со
 * слайдером «сколько войск». Дальше наступлением управляет движок фронта армии «→ имя».
 */
export function TerritoryMenu(props: {
  readonly view: PlayerView;
  readonly other: number;
  /** Точка нажатия в координатах страницы. */
  readonly at: { readonly x: number; readonly y: number };
  readonly send: (cmd: Command) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { view, other, at, send, onClose } = props;
  const max = ownSoldiers(view);
  const [soldiers, setSoldiers] = useState(() => Math.max(1, Math.floor(max / 2)));
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onDown = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);
  const player = view.players[other];
  if (!player || player.status !== 'alive') return null;
  const atWar = (view.diplomacy?.relations[other] ?? 'war') === 'war';
  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - MENU_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - 220));
  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top, width: MENU_WIDTH }}
      role="dialog"
      aria-label={player.name}
    >
      <div className={styles.header}>
        <span
          className={styles.dot}
          style={{ background: tokens.players.palette[other]?.line ?? tokens.ui.ink }}
        />
        <span className={styles.name}>{player.name}</span>
        <IconButton label={t('menu.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} aria-hidden="true" />
        </IconButton>
      </div>
      <DiplomacyBlock view={view} other={other} send={send} />
      {atWar && (
        <div className={styles.attack}>
          <input
            className={styles.slider}
            type="range"
            min={1}
            max={max}
            step={1}
            value={Math.min(soldiers, max)}
            aria-label={t('menu.soldiers')}
            onChange={(event) => setSoldiers(Number(event.target.value))}
          />
          <span className={styles.count}>{Math.min(soldiers, max)}</span>
          <IconButton
            label={t('menu.attack')}
            className={styles.go}
            onClick={() => {
              send({ t: 'launchOffensive', target: other, soldiers: Math.min(soldiers, max) });
              onClose();
            }}
          >
            <IconSwords size={20} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
