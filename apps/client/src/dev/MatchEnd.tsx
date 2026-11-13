import type { PlayerView, WinReason } from '@hexfront/sim';

import { matchStatistics } from './match-end.ts';
import { MatchEndScreen } from '../match/MatchEndScreen.tsx';

export function MatchEnd(props: {
  readonly view: PlayerView;
  readonly fog?: boolean;
  /** Зритель или выбывший, смотрящий чужой вид: нейтральный итог матча. */
  readonly spectating?: boolean;
  readonly onWatch?: (message: { readonly type: 'setFog'; readonly enabled: boolean }) => void;
  readonly onMenu?: (path: string) => void;
  readonly onRematch?: (() => void) | undefined;
  readonly replay?: readonly PlayerView[];
  readonly reason?: WinReason;
  /** Победившая коалиция: победа засчитывается и союзникам. */
  readonly allies?: readonly number[];
}): React.JSX.Element | null {
  const player = props.view.players[props.view.playerId];
  const eliminated = props.spectating !== true && player?.status !== 'alive';
  if (props.view.winner < 0 && !eliminated) return null;
  const names = new Map(props.view.players.map((p) => [p.id, p.name]));
  const nameOf = (id: number): string => names.get(id) ?? '#' + String(id + 1);
  const rows = [...(props.view.ranking ?? [])]
    .sort((a, b) => a.place - b.place || a.id - b.id)
    .slice(0, 8)
    .map((r) => ({ id: r.id, name: nameOf(r.id), place: r.place, score: r.score }));
  const stats = matchStatistics(props.view);
  return MatchEndScreen({
    rows,
    stats: { hexes: stats.hexes, cities: stats.cities, score: stats.score },
    ...(props.view.winner >= 0 ? { winnerName: nameOf(props.view.winner) } : {}),
    soldiers: props.view.units
      .filter((unit) => unit.owner === props.view.playerId)
      .reduce((total, unit) => total + unit.soldiers, 0),
    gold: player?.gold ?? 0,
    winner: props.view.winner,
    playerId: props.view.playerId,
    ...(player?.name ? { playerName: player.name } : {}),
    place: props.view.me.place,
    eliminated,
    fog: props.fog ?? true,
    ...(props.spectating ? { spectating: true } : {}),
    onRematch: props.onRematch,
    ...(props.reason ? { reason: props.reason } : {}),
    ...(props.allies ? { allies: props.allies } : {}),
    victoryHold: props.view.victoryHold ?? null,
    onWatch: props.onWatch ?? (() => undefined),
    onMenu: props.onMenu ?? (() => undefined),
  });
}
