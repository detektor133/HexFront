import {
  IconBuildingCommunity,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsUp,
  IconHammer,
  IconListDetails,
  IconMap2,
  IconMessage,
  IconPackage,
  IconUsersGroup,
  IconShield,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';

import { DEPOT_COST, FORT_COST, IMPROVEMENT_COST } from '@hexfront/sim';

import { ChatPanel } from './ChatDock.tsx';
import styles from './MapTools.module.css';
import type { BuildTool, MapMode } from './map-modes.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { formatCompact } from '../i18n/format.ts';
import { chatStore, useChat } from '../net/chat-store.ts';
import { IconButton } from '../ui/icon-button.tsx';

const BUILD_TOOLS: readonly {
  readonly tool: BuildTool;
  readonly icon: typeof IconShield;
  readonly label: MessageKey;
}[] = [
  { tool: 'city', icon: IconBuildingCommunity, label: 'mapTools.city' },
  { tool: 'depot', icon: IconPackage, label: 'mapTools.depot' },
  { tool: 'fort', icon: IconShield, label: 'mapTools.fort' },
  { tool: 'improve', icon: IconChevronsUp, label: 'mapTools.improve' },
];

/** Цена стройки, fixed-point; `more` — цена растёт с уровнем (улучшение гекса), показана наименьшая. */
function buildPrices(
  cityCost: number,
): Record<BuildTool, { readonly fp: number; readonly more: boolean }> {
  return {
    city: { fp: cityCost, more: false },
    depot: { fp: DEPOT_COST, more: false },
    fort: { fp: FORT_COST, more: false },
    improve: { fp: IMPROVEMENT_COST[0], more: true },
  };
}

interface Props {
  readonly mapMode: MapMode;
  readonly build: BuildTool | null;
  readonly setMapMode: (mode: MapMode) => void;
  readonly setBuild: (tool: BuildTool | null) => void;
  /** Отступ от низа страницы, px: над панелью армий. */
  readonly bottom: number;
  /** Отступ от верха, px: на низком экране (телефон в ландшафте) кнопки стоят под HUD, а не над панелью армий. */
  readonly top?: number | undefined;
  /** Золото игрока, fixed-point: рядом с ценой выбранной стройки. */
  readonly gold: number;
  /** Цена основания следующего города, fixed-point. */
  readonly cityCost: number;
  readonly buildingsOpen: boolean;
  readonly onToggleBuildings: () => void;
  /** Колонка кнопок прячется за правый край экрана, торчит только ручка (телефон в портрете). */
  readonly drawer?: boolean;
  /** Игроки для адресата чата онлайн-матча. */
  readonly chatPlayers?: readonly { readonly id: number; readonly name: string }[];
}

/** Правый нижний угол: молоточек (режим строительства) и режимы карты — обычная и снабжение. */
export function MapTools({
  mapMode,
  build,
  setMapMode,
  setBuild,
  bottom,
  top,
  gold,
  cityCost,
  buildingsOpen,
  onToggleBuildings,
  drawer = false,
  chatPlayers = [],
}: Props): React.JSX.Element {
  const hammerOn = build !== null;
  const chat = useChat();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Выдвинутая колонка прячется нажатием в любом другом месте.
  useEffect(() => {
    if (!drawer || !open) return;
    const onDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [drawer, open]);
  const prices = buildPrices(cityCost);
  return (
    <div
      ref={rootRef}
      className={[
        styles.root,
        top === undefined ? '' : styles.fromTop,
        drawer ? styles.drawer : '',
      ].join(' ')}
      style={
        top === undefined
          ? ({ bottom, '--tools-bottom': `${bottom}px` } as React.CSSProperties)
          : { top }
      }
      data-testid="map-tools"
    >
      {hammerOn && (
        <div className={styles.row} role="toolbar" aria-label={t('mapTools.build')}>
          {BUILD_TOOLS.map(({ tool, icon: Icon, label }) => {
            const cost = prices[tool];
            return (
              <IconButton
                key={tool}
                data-tutorial={`build-${tool}`}
                label={t(label)}
                className={tool === build ? styles.toolActive : styles.tool}
                aria-pressed={tool === build}
                onClick={() => setBuild(tool)}
              >
                <Icon size={22} stroke={1.75} />
                <span className={gold < cost.fp ? styles.costBad : styles.cost}>
                  {formatCompact(cost.fp)}
                  {cost.more ? '+' : ''}
                </span>
              </IconButton>
            );
          })}
        </div>
      )}
      <ChatPanel players={chatPlayers} />
      <div className={styles.group} data-open={!drawer || open}>
        {drawer && (
          <button
            type="button"
            className={styles.handle}
            aria-label={t('mapTools.drawer')}
            aria-expanded={open}
            onClick={() => setOpen((now) => !now)}
          >
            {open ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </button>
        )}
        <div className={styles.column} onClickCapture={() => drawer && setOpen(false)}>
          <IconButton
            data-tutorial="buildings"
            label={t('buildings.title')}
            className={buildingsOpen ? styles.active : styles.button}
            aria-pressed={buildingsOpen}
            onClick={onToggleBuildings}
          >
            <IconListDetails size={22} stroke={1.75} />
          </IconButton>
          <IconButton
            data-tutorial="hammer"
            label={t('mapTools.build')}
            className={hammerOn ? styles.active : styles.button}
            aria-pressed={hammerOn}
            onClick={() => setBuild(hammerOn ? null : 'city')}
          >
            <IconHammer size={22} stroke={1.75} />
          </IconButton>
          <IconButton
            label={t('mapTools.normal')}
            className={mapMode === 'normal' && !hammerOn ? styles.active : styles.button}
            aria-pressed={mapMode === 'normal'}
            onClick={() => setMapMode('normal')}
          >
            <IconMap2 size={22} stroke={1.75} />
          </IconButton>
          <IconButton
            data-tutorial="supply-mode"
            label={t('mapTools.supply')}
            className={mapMode === 'supply' && !hammerOn ? styles.active : styles.button}
            aria-pressed={mapMode === 'supply'}
            onClick={() => setMapMode(mapMode === 'supply' && !hammerOn ? 'normal' : 'supply')}
          >
            <IconPackage size={22} stroke={1.75} />
          </IconButton>
          <IconButton
            label={t('mapTools.political')}
            className={mapMode === 'political' && !hammerOn ? styles.active : styles.button}
            aria-pressed={mapMode === 'political'}
            onClick={() =>
              setMapMode(mapMode === 'political' && !hammerOn ? 'normal' : 'political')
            }
          >
            <IconUsersGroup size={22} stroke={1.75} />
          </IconButton>
          {chat.sender !== null && (
            <IconButton
              label={chat.open ? t('chat.close') : t('chat.open')}
              className={chat.open ? styles.active : styles.button}
              aria-pressed={chat.open}
              onClick={chatStore.toggle}
            >
              <IconMessage size={22} stroke={1.75} />
              {chat.unread > 0 && <span className={styles.badge}>{Math.min(chat.unread, 9)}</span>}
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
