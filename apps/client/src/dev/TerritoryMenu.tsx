import { IconFlag, IconShield, IconShieldOff, IconSwords, IconX } from '@tabler/icons-react';
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
 * Предел слайдера: солдаты в отрядах плюс половина населения — недостающих ИИ закупит и подведёт
 * (`wanted` армии).
 */
function ownSoldiers(view: PlayerView): number {
  const total = view.units
    .filter((unit) => unit.owner === view.playerId)
    .reduce((sum, unit) => sum + unit.soldiers, 0);
  return Math.max(1, Math.floor((total + view.me.popTotal / 2) / FP));
}

/**
 * Меню земли по ПКМ (удержанию пальцем) без выбранных отрядов. Чужая страна: дипломатия, «держать
 * границу» и, на войне, «наступать»; ничья земля: «занять». Слайдер — сколько солдат на этом
 * направлении; дальше ИИ набирает, подводит и ведёт армию «Фронт: …».
 */
export function TerritoryMenu(props: {
  readonly view: PlayerView;
  /** Игрок, чья это земля, или -1 — ничья земля. */
  readonly other: number;
  /** Гекс нажатия (меню им не пользуется: ось удара выбирает ИИ). */
  readonly hex: number;
  /** Точка нажатия в координатах страницы. */
  readonly at: { readonly x: number; readonly y: number };
  readonly send: (cmd: Command) => void;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { view, other, at, send, onClose } = props;
  const max = ownSoldiers(view);
  // Уже поставленное направление: слайдер показывает его заказ, а не заново половину армии.
  const existing = view.armies.find((a) => a.dir?.target === other);
  const [soldiers, setSoldiers] = useState(() =>
    Math.max(0, existing?.wanted ?? Math.max(1, Math.floor(max / 2))),
  );
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
  const neutral = other < 0;
  const player = neutral ? null : view.players[other];
  if (!neutral && (!player || player.status !== 'alive')) return null;
  const atWar = !neutral && (view.diplomacy?.relations[other] ?? 'war') === 'war';
  const amount = Math.min(soldiers, max);
  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - MENU_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - 220));
  const name = neutral ? t('menu.neutral') : (player?.name ?? '');
  // Клик не выбирает место удара: ось наступления и приоритет занятия определяет ИИ.
  const where = {};
  const go = (command: Command): void => {
    send(command);
    onClose();
  };
  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left, top, width: MENU_WIDTH }}
      role="dialog"
      aria-label={name}
    >
      <div className={styles.header}>
        <span
          className={styles.dot}
          style={{
            background: neutral
              ? tokens.neutral.line
              : (tokens.players.palette[other]?.line ?? tokens.ui.ink),
          }}
        />
        <span className={styles.name}>{name}</span>
        <IconButton label={t('menu.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} aria-hidden="true" />
        </IconButton>
      </div>
      {!neutral && <DiplomacyBlock view={view} other={other} send={send} />}
      <div className={styles.attack}>
        <input
          className={styles.slider}
          type="range"
          min={0}
          max={max}
          step={1}
          value={amount}
          aria-label={t('menu.soldiers')}
          onChange={(event) => setSoldiers(Number(event.target.value))}
        />
        <span className={styles.count}>{amount}</span>
        {existing && (
          <IconButton
            label={t('menu.release')}
            className={styles.hold}
            onClick={() => go({ t: 'holdBorder', target: other, soldiers: 0 })}
          >
            <IconShieldOff size={20} aria-hidden="true" />
          </IconButton>
        )}
        {!neutral && (
          <IconButton
            label={t('menu.hold')}
            className={styles.hold}
            disabled={amount < 1}
            onClick={() => go({ t: 'holdBorder', target: other, soldiers: amount })}
          >
            <IconShield size={20} aria-hidden="true" />
          </IconButton>
        )}
        {(atWar || neutral) && (
          <IconButton
            label={t(neutral ? 'menu.occupy' : 'menu.attack')}
            className={styles.go}
            disabled={amount < 1}
            onClick={() => go({ t: 'launchOffensive', target: other, soldiers: amount, ...where })}
          >
            {neutral ? (
              <IconFlag size={20} aria-hidden="true" />
            ) : (
              <IconSwords size={20} aria-hidden="true" />
            )}
          </IconButton>
        )}
      </div>
    </div>
  );
}
