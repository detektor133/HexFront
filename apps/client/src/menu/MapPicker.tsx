// Выбор карты: стрелки «‹ название ›», мини-карта и выбор своей точки старта. Для случайной карты —
// кнопка «Другая карта». Один вид и для «Против ботов», и для лобби.
import { IconChevronLeft, IconChevronRight, IconDice3 } from '@tabler/icons-react';

import { MapPreview } from './MapPreview.tsx';
import styles from './map-picker.module.css';
import { MAPS, maxPlayersOf, type MenuMapId } from './menu-config.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

export interface MapPickerProps {
  readonly map: MenuMapId;
  /** Выбрать карту может не каждый (гость лобби только смотрит). */
  readonly editable: boolean;
  readonly onMap: (map: MenuMapId) => void;
  readonly seed: number;
  readonly onOtherMap: () => void;
  readonly players: number;
  readonly spawn: number | null;
  readonly taken: ReadonlyMap<number, string>;
  readonly onSpawn: (spawn: number | null) => void;
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
          <small>{`${entry?.size ?? ''} · ${maxPlayersOf(map)}`}</small>
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
      <MapPreview
        request={{ id: map, seed: props.seed, players: props.players }}
        selected={props.spawn}
        taken={props.taken}
        onPick={props.onSpawn}
        label={t('menu.spawn')}
      />
      <p className={styles.hint}>
        {props.spawn === null
          ? `${t('menu.spawn')}: ${t('menu.spawnRandom')}. ${t('menu.spawnHint')}`
          : `${t('menu.spawn')}: ${props.spawn + 1}`}
      </p>
    </div>
  );
}
