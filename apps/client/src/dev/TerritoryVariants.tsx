// Пробные формы меню земли по клику (окно, «таблетка», круг, плитки, боковая панель): одни и те же
// действия, разная компоновка. Выбор — переключатель «n/5» в меню; лучшую форму оставим.
import { IconHeartHandshake, IconX } from '@tabler/icons-react';
import { useLayoutEffect, useRef, useState } from 'react';

import styles from './TerritoryVariants.module.css';
import { t } from '../i18n/dict.ts';
import { MENU_STYLES, type MenuStyle } from '../settings/menu-style.ts';

/** Действие меню земли: общее для всех форм. */
export interface TerritoryAct {
  readonly id: 'hold' | 'attack' | 'occupy';
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly run: () => void;
  readonly disabled: boolean;
  readonly title: string;
  readonly pressed?: boolean;
  readonly tutorial: string;
}

/** Всё, что нужно любой форме меню. */
export interface TerritoryCtx {
  readonly name: string;
  readonly color: string;
  readonly strength: React.ReactNode;
  readonly acts: readonly TerritoryAct[];
  /** Блок дипломатии (null — у ничьей земли). */
  readonly diplomacy: React.ReactNode;
  readonly at: { readonly x: number; readonly y: number };
  readonly style: MenuStyle;
  readonly onStyle: () => void;
  readonly onClose: () => void;
}

const EDGE = 8;

/** Размер элемента: форма ставится у точки клика и не выходит за экран. */
function useBox(): {
  readonly ref: React.RefObject<HTMLDivElement | null>;
  readonly box: { readonly w: number; readonly h: number };
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 280, h: 56 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setBox({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, box };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(value, Math.max(low, high)));

function Switch(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const text = `${t('menu.styleSwitch')}: ${MENU_STYLES.indexOf(props.ctx.style) + 1}/${MENU_STYLES.length}`;
  return (
    <button
      type="button"
      className={styles.switch}
      title={text}
      aria-label={text}
      onClick={props.ctx.onStyle}
    >
      {MENU_STYLES.indexOf(props.ctx.style) + 1}/{MENU_STYLES.length}
    </button>
  );
}

function Title(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const { ctx } = props;
  return (
    <span className={styles.title}>
      <span className={styles.dot} style={{ background: ctx.color }} />
      <span className={styles.name}>{ctx.name}</span>
      {ctx.strength}
    </span>
  );
}

function ActButton(props: {
  readonly act: TerritoryAct;
  readonly className: string | undefined;
  readonly caption?: boolean;
}): React.JSX.Element {
  const { act } = props;
  return (
    <button
      type="button"
      data-tutorial={act.tutorial}
      data-act={act.id}
      className={props.className}
      disabled={act.disabled}
      aria-pressed={act.pressed}
      title={act.title}
      onClick={act.run}
    >
      {act.icon}
      {props.caption !== false && <span>{act.label}</span>}
    </button>
  );
}

function DiplomacyToggle(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly className: string | undefined;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={props.className}
      aria-expanded={props.open}
      title={t('diplomacy.title')}
      aria-label={t('diplomacy.title')}
      onClick={props.onToggle}
    >
      <IconHeartHandshake size={20} aria-hidden="true" />
    </button>
  );
}

/** «Таблетка»: одна строка у точки клика — имя, действия, дипломатия по кнопке. */
export function PillMenu(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const { ctx } = props;
  const { ref, box } = useBox();
  const [open, setOpen] = useState(false);
  const left = clamp(ctx.at.x - box.w / 2, EDGE, window.innerWidth - box.w - EDGE);
  const top = clamp(ctx.at.y - box.h - 14, EDGE, window.innerHeight - box.h - EDGE);
  return (
    <div
      ref={ref}
      className={styles.pill}
      style={{ left, top }}
      role="dialog"
      aria-label={ctx.name}
    >
      <div className={styles.pillRow}>
        <Title ctx={ctx} />
        {ctx.acts.map((act) => (
          <ActButton key={act.id} act={act} className={styles.pillAct} />
        ))}
        {ctx.diplomacy !== null && (
          <DiplomacyToggle
            open={open}
            onToggle={() => setOpen((v) => !v)}
            className={styles.round}
          />
        )}
        <Switch ctx={ctx} />
        <button
          type="button"
          className={styles.round}
          aria-label={t('menu.close')}
          onClick={ctx.onClose}
        >
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      {open && ctx.diplomacy}
    </div>
  );
}

// Смещения кнопок круга от точки клика, px: дуга радиусом 72 над точкой.
const RING: readonly (readonly [number, number])[] = [
  [-64, -34],
  [0, -72],
  [64, -34],
];

/** Круг: кнопки вокруг точки клика с подписями, имя под ней; окна нет. */
export function RadialMenu(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const { ctx } = props;
  const [open, setOpen] = useState(false);
  const cx = clamp(ctx.at.x, 120, window.innerWidth - 120);
  const cy = clamp(ctx.at.y, 130, window.innerHeight - 100);
  // Единственное действие (ничья земля) — сверху; иначе — по дуге слева направо.
  const spots = ctx.acts.length === 1 ? [RING[1]] : RING;
  const at = (i: number): React.CSSProperties => {
    const [x, y] = spots[i] ?? [0, -72];
    return { left: x, top: y };
  };
  return (
    <div
      className={styles.radial}
      style={{ left: cx, top: cy }}
      role="dialog"
      aria-label={ctx.name}
    >
      {ctx.acts.map((act, i) => (
        <span key={act.id} className={styles.spot} style={at(i)}>
          <ActButton act={act} className={styles.ringButton} />
        </span>
      ))}
      {ctx.diplomacy !== null && (
        <span className={styles.spot} style={at(ctx.acts.length)}>
          <DiplomacyToggle
            open={open}
            onToggle={() => setOpen((v) => !v)}
            className={styles.ringButton}
          />
        </span>
      )}
      <div className={styles.ringName}>
        <Title ctx={ctx} />
        <Switch ctx={ctx} />
        <button
          type="button"
          className={styles.round}
          aria-label={t('menu.close')}
          onClick={ctx.onClose}
        >
          <IconX size={16} aria-hidden="true" />
        </button>
      </div>
      {open && <div className={styles.ringPanel}>{ctx.diplomacy}</div>}
    </div>
  );
}

/** Плитки: небольшое окно, действия — две крупные плитки рядом, дипломатия по кнопке. */
export function TilesMenu(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const { ctx } = props;
  const { ref, box } = useBox();
  const [open, setOpen] = useState(false);
  const left = clamp(ctx.at.x, EDGE, window.innerWidth - box.w - EDGE);
  const top = clamp(ctx.at.y, EDGE, window.innerHeight - box.h - EDGE);
  return (
    <div
      ref={ref}
      className={styles.tiles}
      style={{ left, top }}
      role="dialog"
      aria-label={ctx.name}
    >
      <div className={styles.tilesHead}>
        <Title ctx={ctx} />
        {ctx.diplomacy !== null && (
          <DiplomacyToggle
            open={open}
            onToggle={() => setOpen((v) => !v)}
            className={styles.round}
          />
        )}
        <Switch ctx={ctx} />
        <button
          type="button"
          className={styles.round}
          aria-label={t('menu.close')}
          onClick={ctx.onClose}
        >
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.tilesGrid} data-count={ctx.acts.length}>
        {ctx.acts.map((act) => (
          <ActButton key={act.id} act={act} className={styles.tile} />
        ))}
      </div>
      {open && ctx.diplomacy}
    </div>
  );
}

/** Боковая панель: закреплена у правого края, не привязана к точке клика. */
export function DrawerMenu(props: { readonly ctx: TerritoryCtx }): React.JSX.Element {
  const { ctx } = props;
  return (
    <aside className={styles.drawer} aria-label={ctx.name}>
      <div className={styles.tilesHead}>
        <Title ctx={ctx} />
        <Switch ctx={ctx} />
        <button
          type="button"
          className={styles.round}
          aria-label={t('menu.close')}
          onClick={ctx.onClose}
        >
          <IconX size={18} aria-hidden="true" />
        </button>
      </div>
      {ctx.diplomacy}
      <div className={styles.drawerActs}>
        {ctx.acts.map((act) => (
          <ActButton key={act.id} act={act} className={styles.drawerAct} />
        ))}
      </div>
    </aside>
  );
}
