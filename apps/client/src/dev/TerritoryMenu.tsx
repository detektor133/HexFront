import {
  IconCheck,
  IconFlag,
  IconShield,
  IconShieldOff,
  IconSwords,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { FP, type ArmyView, type Command, type PlayerView } from '@hexfront/sim';

import { DiplomacyBlock } from './DiplomacyBlock.tsx';
import styles from './TerritoryMenu.module.css';
import { maxArmySoldiers } from './army-limit.ts';
import { armyName } from './army-name.ts';
import { NEW_ARMY, armyCounts, orderFields, totalOf } from './direction-order.ts';
import { countsFromShares, defaultShares, sharesFromCounts, type Shares } from './force-share.ts';
import { t } from '../i18n/dict.ts';
import { tokens } from '../theme/tokens.ts';
import { IconButton } from '../ui/icon-button.tsx';

const MENU_WIDTH = 264;
const EDGE = 8;

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
  const max = maxArmySoldiers(view);
  // Армия приказа: уже стоящая на эту цель выбрана сразу и показывает свой состав; «Новая» — с нуля.
  const existing = view.armies.find((a) => a.dir?.target === other);
  const [armyId, setArmyId] = useState<number>(existing?.id ?? NEW_ARMY);
  // Состав приказа: общее число и доли по типам; у существующей армии — её собственные.
  const fresh = (): { total: number; shares: Shares } => {
    const total = Math.max(1, Math.floor(max / 2));
    return { total, shares: defaultShares(view, total) };
  };
  const fromArmy = (army: ArmyView): { total: number; shares: Shares } => {
    const counts = armyCounts(view, army);
    return { total: Math.min(max, totalOf(counts)), shares: sharesFromCounts(counts) };
  };
  // Размер и состав меняются только на карточке самой армии; приказ берёт армию как есть.
  const [force, setForce] = useState(() => (existing ? fromArmy(existing) : fresh()));
  const pickArmy = (id: number): void => {
    setArmyId(id);
    const army = view.armies.find((a) => a.id === id);
    setForce(army ? fromArmy(army) : fresh());
  };
  const ref = useRef<HTMLDivElement | null>(null);
  // Реальная высота окна: оно растёт от числа источников, и фиксированная оценка уводила его за край.
  const [height, setHeight] = useState(220);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  const counts = countsFromShares(force.total, force.shares);
  const amount = force.total;
  const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - MENU_WIDTH - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE));
  const mine = view.units.filter((u) => u.owner === view.playerId);
  const soldiersOf = (armyId: number | null): number =>
    Math.floor(
      mine.filter((u) => u.armyId === armyId).reduce((sum, u) => sum + u.soldiers, 0) / FP,
    );
  const name = neutral ? t('menu.neutral') : (player?.name ?? '');
  // Клик не выбирает место удара: ось наступления и приоритет занятия определяет ИИ.
  const where = orderFields(counts, armyId);
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
        <div className={styles.sources} role="group" aria-label={t('menu.army')}>
          <button
            type="button"
            className={armyId === NEW_ARMY ? styles.sourceOn : styles.source}
            aria-pressed={armyId === NEW_ARMY}
            onClick={() => pickArmy(NEW_ARMY)}
          >
            <span className={styles.sourceName}>{t('menu.newArmy')}</span>
          </button>
          {view.armies.map((army) => (
            <button
              key={army.id}
              type="button"
              className={armyId === army.id ? styles.sourceOn : styles.source}
              aria-pressed={armyId === army.id}
              title={army.id === existing?.id ? t('menu.onTarget') : undefined}
              onClick={() => pickArmy(army.id)}
            >
              <span className={styles.sourceName}>{armyName(army)}</span>
              <span>{soldiersOf(army.id)}</span>
              {army.id === existing?.id && <IconCheck size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          {!neutral && (
            <button
              type="button"
              className={styles.act}
              data-tutorial="hold"
              disabled={amount < 1}
              onClick={() => go({ t: 'holdBorder', target: other, ...where })}
            >
              <IconShield size={20} aria-hidden="true" />
              {t('menu.holdShort')}
            </button>
          )}
          {(atWar || neutral) && (
            <button
              type="button"
              className={styles.actGo}
              data-tutorial={neutral ? 'occupy' : 'attack'}
              disabled={amount < 1}
              onClick={() => go({ t: 'launchOffensive', target: other, ...where })}
            >
              {neutral ? (
                <IconFlag size={20} aria-hidden="true" />
              ) : (
                <IconSwords size={20} aria-hidden="true" />
              )}
              {t(neutral ? 'menu.occupy' : 'menu.attack')}
            </button>
          )}
        </div>
        {existing && (
          <button
            type="button"
            className={styles.release}
            onClick={() => go({ t: 'holdBorder', target: other, soldiers: 0 })}
          >
            <IconShieldOff size={16} aria-hidden="true" />
            {t('menu.release')}
          </button>
        )}
      </div>
    </div>
  );
}
