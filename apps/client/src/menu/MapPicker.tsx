// Выбор карты: стрелки «‹ название ›», мини-карта и выбор своей точки старта. Для случайной карты —
// кнопка «Другая карта». Один вид и для «Против ботов», и для лобби.
import { IconChevronLeft, IconChevronRight, IconDice3 } from '@tabler/icons-react';

import styles from './map-picker.module.css';
import { GEN_SIZES, MAPS, maxPlayersOf, type GenSize, type MenuMapId } from './menu-config.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

export interface MapPickerProps {
  readonly map: MenuMapId;
  /** Выбрать карту может не каждый (гость лобби только смотрит). */
  readonly editable: boolean;
  readonly onMap: (map: MenuMapId) => void;
  readonly seed: number;
  readonly onOtherMap: () => void;
  /** Размер случайной карты и его смена (только у того, кто выбирает карту). */
  readonly genSize: number;
  readonly onGenSize: (size: GenSize) => void;
  /** Выбран ли старт тапом по фону (иначе — случайный). */
  readonly spawn: number | null;
}

/** Карта рядом в списке по кругу: `step` = 1 вперёд, −1 назад. */
export function neighborMap(map: MenuMapId, step: 1 | -1): MenuMapId {
  const index = MAPS.findIndex((m) => m.id === map);
  const next = MAPS[(index + step + MAPS.length) % MAPS.length];
  return next?.id ?? map;
}

export function MapPicker(props: MapPickerProps): React.JSX.Element {
  const { map } = props;
  const entry = MAPS.find((m) => m.id === map);
  const name = t(`menu.map.${map}` as MessageKey);
  return (
    <div className={styles.picker}>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.arrow}
          aria-label={t('menu.mapPrev')}
          disabled={!props.editable}
          onClick={() => props.onMap(neighborMap(map, -1))}
        >
          <IconChevronLeft size={20} aria-hidden="true" />
        </button>
        <div className={styles.title} aria-live="polite">
          <b>{name}</b>
          {map === 'gen' && props.editable ? (
            <div className={styles.sizes} role="group" aria-label={t('menu.genSize')}>
              {GEN_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`${styles.size} ${size === props.genSize ? styles.sizeOn : ''}`}
                  aria-pressed={size === props.genSize}
                  onClick={() => props.onGenSize(size)}
                >
                  {t(`menu.genSize.${size}` as MessageKey)}
                </button>
              ))}
            </div>
          ) : (
            <small>
              {map === 'gen'
                ? `${t(`menu.genSize.${props.genSize}` as MessageKey)} · ${props.genSize}`
                : `${entry?.size ?? ''} · ${maxPlayersOf(map)}`}
            </small>
          )}
        </div>
        {map === 'gen' && props.editable && (
          <button
            type="button"
            className={styles.dice}
            aria-label={t('menu.otherMap')}
            title={t('menu.otherMap')}
            onClick={props.onOtherMap}
          >
            <IconDice3 size={20} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={styles.arrow}
          aria-label={t('menu.mapNext')}
          disabled={!props.editable}
          onClick={() => props.onMap(neighborMap(map, 1))}
        >
          <IconChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <p className={styles.hint}>
        {props.spawn === null ? t('menu.spawnHint') : t('menu.spawnChosen')}
      </p>
    </div>
  );
}
