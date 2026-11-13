import type { PlayerView } from '@hexfront/sim';

import styles from './PoliticalLegend.module.css';
import { t, type MessageKey } from '../i18n/dict.ts';
import { politicalKind, politicalLine, type PoliticalKind } from '../render/political.ts';

interface Group {
  readonly key: string;
  readonly kind: PoliticalKind;
  readonly color: string;
  readonly members: readonly string[];
}

// Группы легенды: ваш блок, враги, чужие альянсы (каждый свой), остальные поодиночке.
function groups(view: PlayerView): Group[] {
  const d = view.diplomacy;
  const out = new Map<string, { kind: PoliticalKind; color: string; members: string[] }>();
  for (const p of view.players) {
    if (p.status !== 'alive') continue;
    const kind = politicalKind(view, p.id);
    const bloc = d?.blocs[p.id] ?? p.id;
    const key = kind === 'bloc' ? `bloc:${bloc}` : kind;
    const name = p.id === view.playerId ? t('vote.you') : (p.name ?? String(p.id + 1));
    const group = out.get(key) ?? { kind, color: politicalLine(view, p.id), members: [] };
    group.members.push(name);
    out.set(key, group);
  }
  const order: Record<PoliticalKind, number> = { own: 0, war: 1, bloc: 2, solo: 3 };
  return [...out.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.key.localeCompare(b.key));
}

/** Легенда политической карты: кто с кем в одном альянсе и с кем вы воюете. */
export function PoliticalLegend(props: {
  readonly view: PlayerView;
  readonly top: number;
}): React.JSX.Element {
  return (
    <aside
      className={styles.legend}
      style={{ top: props.top }}
      aria-label={t('mapTools.political')}
    >
      <h3 className={styles.title}>{t('mapTools.political')}</h3>
      <ul className={styles.list}>
        {groups(props.view).map((g) => (
          <li key={g.key} className={styles.item}>
            <span className={styles.swatch} style={{ background: g.color }} />
            <span className={styles.text}>
              <b>{t(`political.${g.kind}` as MessageKey)}</b>
              <span className={styles.members}>{g.members.join(', ')}</span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
