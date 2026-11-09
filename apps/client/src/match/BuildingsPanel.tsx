import {
  IconBuildingCommunity,
  IconChevronsUp,
  IconHammer,
  IconPackage,
  IconShield,
  IconStar,
  IconX,
} from '@tabler/icons-react';
import { useRef, useState } from 'react';

import type { Command, PlayerView } from '@hexfront/sim';

import styles from './BuildingsPanel.module.css';
import { buildingsList, type SiteRow } from '../dev/buildings-list.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatCompact, formatRate } from '../i18n/format.ts';
import { GoldIcon } from '../ui/gold-icon.tsx';
import { IconButton } from '../ui/icon-button.tsx';

type Tab = 'cities' | 'depots' | 'forts' | 'building';
const TABS: readonly {
  readonly id: Tab;
  readonly icon: typeof IconShield;
  readonly label: MessageKey;
}[] = [
  { id: 'cities', icon: IconBuildingCommunity, label: 'buildings.cities' },
  { id: 'depots', icon: IconPackage, label: 'buildings.depots' },
  { id: 'forts', icon: IconShield, label: 'buildings.forts' },
  { id: 'building', icon: IconHammer, label: 'buildings.building' },
];

const WIDTH = 340;
const MARGIN = 8;

interface Props {
  readonly view: PlayerView;
  readonly send: (cmd: Command) => void;
  /** Центрирует камеру на гексе и открывает его карточку. */
  readonly onFocus: (hex: number) => void;
  readonly onClose: () => void;
  /** Высота верхней полосы HUD: окно по умолчанию — под ней. */
  readonly top: number;
  /** Нижний край таблицы лидеров, px: окно по умолчанию стоит ниже неё, не перекрывая. */
  readonly avoidY?: number;
}

/** Окно можно двигать за заголовок; оно остаётся целиком в пределах экрана. */
function useDraggable(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const clamp = (x: number, y: number): { x: number; y: number } => ({
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN)),
    y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - 80)),
  });
  return {
    pos,
    handle: {
      onPointerDown: (e: React.PointerEvent<HTMLElement>): void => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>): void => {
        const d = drag.current;
        if (d) setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
      },
      onPointerUp: (): void => {
        drag.current = null;
      },
    },
  };
}

function Cost({ value, gold }: { value: number; gold: number }): React.JSX.Element {
  return (
    <span className={value > gold ? styles.poor : styles.cost}>
      <GoldIcon />
      {formatCompact(value)}
    </span>
  );
}

function Level({ level }: { level: number }): React.JSX.Element {
  return <span className={styles.level}>{level}</span>;
}

function UpgradeButton(props: {
  readonly cost: number | null;
  readonly gold: number;
  readonly busy: boolean;
  readonly onClick: () => void;
}): React.JSX.Element | null {
  if (props.cost === null) return <span className={styles.max}>{t('buildings.max')}</span>;
  const disabled = props.busy || props.cost > props.gold;
  return (
    <IconButton
      label={t('buildings.upgrade')}
      className={styles.upgrade}
      disabled={disabled}
      onClick={props.onClick}
    >
      <IconChevronsUp size={18} stroke={1.75} />
      <Cost value={props.cost} gold={props.gold} />
    </IconButton>
  );
}

/** Окно «Постройки»: где что построено, с улучшением и переходом к месту на карте. */
export function BuildingsPanel({
  view,
  send,
  onFocus,
  onClose,
  top,
  avoidY = 0,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('cities');
  const list = buildingsList(view);
  const { pos, handle } = useDraggable({
    x: Math.max(MARGIN, window.innerWidth - WIDTH - 16),
    y: Math.min(
      Math.max(top + 72, avoidY + 12, Math.round(window.innerHeight * 0.34)),
      Math.max(top + 72, window.innerHeight - 340),
    ),
  });
  const sites = (
    rows: readonly SiteRow[],
    icon: React.JSX.Element,
    label: string,
  ): React.JSX.Element[] =>
    rows.map((row, index) => (
      <li key={row.hex} className={styles.row}>
        <button type="button" className={styles.focus} onClick={() => onFocus(row.hex)}>
          {icon}
          <span className={styles.name}>{`${label} ${index + 1}`}</span>
          <Level level={row.level} />
        </button>
        <UpgradeButton
          cost={row.upgradeCost}
          gold={list.gold}
          busy={row.busy}
          onClick={() =>
            send({
              t: 'build',
              hex: row.hex,
              kind: tab === 'forts' ? 'fort' : 'depot',
            })
          }
        />
      </li>
    ));
  // «Улучшить всё»: +1 уровень каждой постройке вкладки, у которой он есть и которая не занята.
  const bulk: { readonly cost: number; readonly cmd: Command }[] =
    tab === 'cities'
      ? list.cities.flatMap((c) =>
          c.upgradeCost === null || c.busy
            ? []
            : [{ cost: c.upgradeCost, cmd: { t: 'upgradeCity', cityId: c.id } as Command }],
        )
      : tab === 'building'
        ? []
        : (tab === 'forts' ? list.forts : list.depots).flatMap((row) =>
            row.upgradeCost === null || row.busy
              ? []
              : [
                  {
                    cost: row.upgradeCost,
                    cmd: {
                      t: 'build',
                      hex: row.hex,
                      kind: tab === 'forts' ? 'fort' : 'depot',
                    } as Command,
                  },
                ],
          );
  const bulkCost = bulk.reduce((sum, item) => sum + item.cost, 0);
  const rows =
    tab === 'cities'
      ? list.cities.map((c) => (
          <li key={c.id} className={styles.row}>
            <button type="button" className={styles.focus} onClick={() => onFocus(c.hex)}>
              {c.isCapital ? (
                <IconStar size={18} stroke={1.75} />
              ) : (
                <IconBuildingCommunity size={18} stroke={1.75} />
              )}
              <span className={styles.name}>{c.name || t('buildings.city')}</span>
              <Level level={c.level} />
              <span className={styles.meta}>{formatCompact(c.pop)}</span>
              {c.isolated && <span className={styles.warn}>{t('buildings.isolated')}</span>}
            </button>
            <UpgradeButton
              cost={c.upgradeCost}
              gold={list.gold}
              busy={c.busy}
              onClick={() => send({ t: 'upgradeCity', cityId: c.id })}
            />
          </li>
        ))
      : tab === 'depots'
        ? sites(list.depots, <IconPackage size={18} stroke={1.75} />, t('buildings.depot'))
        : tab === 'forts'
          ? sites(list.forts, <IconShield size={18} stroke={1.75} />, t('buildings.fort'))
          : list.constructions.map((c) => (
              <li key={`${c.kind}-${c.hex}`} className={styles.row}>
                <button type="button" className={styles.focus} onClick={() => onFocus(c.hex)}>
                  <IconHammer size={18} stroke={1.75} />
                  <span className={styles.name}>{t(`build.${c.kind}` as MessageKey)}</span>
                  <span className={styles.meta}>{Math.round(c.progress * 100)}%</span>
                </button>
              </li>
            ));
  return (
    <section
      className={styles.panel}
      style={{ left: pos.x, top: pos.y, width: WIDTH }}
      aria-label={t('buildings.title')}
      data-testid="buildings-panel"
    >
      <header className={styles.header} {...handle}>
        <h2 className={styles.title}>{t('buildings.title')}</h2>
        <span className={styles.summary}>
          <GoldIcon />
          {formatCompact(list.gold)} · {formatRate(list.incomePerS)}
        </span>
        <IconButton label={t('buildings.close')} className={styles.close} onClick={onClose}>
          <IconX size={18} stroke={1.75} />
        </IconButton>
      </header>
      <div className={styles.tabs} role="tablist">
        {TABS.map(({ id, icon: Icon, label }) => (
          <IconButton
            key={id}
            label={t(label)}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? styles.tabOn : styles.tab}
            onClick={() => setTab(id)}
          >
            <Icon size={18} stroke={1.75} />
            <span className={styles.count}>
              {id === 'cities'
                ? list.cities.length
                : id === 'depots'
                  ? list.depots.length
                  : id === 'forts'
                    ? list.forts.length
                    : list.constructions.length}
            </span>
          </IconButton>
        ))}
      </div>
      {tab !== 'building' && (
        <button
          type="button"
          className={styles.bulk}
          data-testid="upgrade-all"
          disabled={bulk.length === 0 || bulkCost > list.gold}
          title={t('buildings.upgradeAllHint')}
          onClick={() => bulk.forEach((item) => send(item.cmd))}
        >
          <IconChevronsUp size={18} stroke={1.75} />
          <span>{t('buildings.upgradeAll')}</span>
          {bulk.length > 0 && <span className={styles.bulkCount}>{'×' + String(bulk.length)}</span>}
          {bulk.length > 0 && <Cost value={bulkCost} gold={list.gold} />}
        </button>
      )}
      <ul className={styles.list}>
        {rows.length > 0 ? rows : <li className={styles.empty}>{t('buildings.empty')}</li>}
      </ul>
    </section>
  );
}
