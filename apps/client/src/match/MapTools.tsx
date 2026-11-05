import {
  IconBuildingCastle,
  IconChevronsUp,
  IconHammer,
  IconMap2,
  IconPackage,
  IconShield,
} from '@tabler/icons-react';

import styles from './MapTools.module.css';
import type { BuildTool, MapMode } from './map-modes.ts';
import { t, type MessageKey } from '../i18n/dict.ts';
import { IconButton } from '../ui/icon-button.tsx';

const BUILD_TOOLS: readonly {
  readonly tool: BuildTool;
  readonly icon: typeof IconShield;
  readonly label: MessageKey;
}[] = [
  { tool: 'city', icon: IconBuildingCastle, label: 'mapTools.city' },
  { tool: 'depot', icon: IconPackage, label: 'mapTools.depot' },
  { tool: 'fort', icon: IconShield, label: 'mapTools.fort' },
  { tool: 'improve', icon: IconChevronsUp, label: 'mapTools.improve' },
];

interface Props {
  readonly mapMode: MapMode;
  readonly build: BuildTool | null;
  readonly setMapMode: (mode: MapMode) => void;
  readonly setBuild: (tool: BuildTool | null) => void;
  /** Отступ от низа страницы, px: над панелью армий. */
  readonly bottom: number;
}

/** Правый нижний угол: молоточек (режим строительства) и режимы карты — обычная и снабжение. */
export function MapTools({
  mapMode,
  build,
  setMapMode,
  setBuild,
  bottom,
}: Props): React.JSX.Element {
  const hammerOn = build !== null;
  return (
    <div className={styles.root} style={{ bottom }} data-testid="map-tools">
      {hammerOn && (
        <div className={styles.row} role="toolbar" aria-label={t('mapTools.build')}>
          {BUILD_TOOLS.map(({ tool, icon: Icon, label }) => (
            <IconButton
              key={tool}
              label={t(label)}
              className={tool === build ? styles.active : styles.button}
              aria-pressed={tool === build}
              onClick={() => setBuild(tool)}
            >
              <Icon size={22} stroke={1.75} />
            </IconButton>
          ))}
        </div>
      )}
      <div className={styles.column}>
        <IconButton
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
          label={t('mapTools.supply')}
          className={mapMode === 'supply' && !hammerOn ? styles.active : styles.button}
          aria-pressed={mapMode === 'supply'}
          onClick={() => setMapMode('supply')}
        >
          <IconPackage size={22} stroke={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
