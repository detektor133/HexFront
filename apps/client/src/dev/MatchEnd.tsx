import type { PlayerView, WinReason } from '@hexfront/sim';

import { MatchEndScreen } from '../match/MatchEndScreen.tsx';

export function MatchEnd(props: {
  readonly view: PlayerView;
  readonly fog?: boolean;
  readonly onWatch?: (message: { readonly type: 'setFog'; readonly enabled: boolean }) => void;
  readonly onMenu?: (path: string) => void;
  readonly replay?: readonly PlayerView[];
  readonly reason?: WinReason;
}): React.JSX.Element | null {
  const player = props.view.players[props.view.playerId];
  const eliminated = player?.status !== 'alive';
  if (props.view.winner < 0 && !eliminated) return null;
  return MatchEndScreen({
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
    ...(props.reason ? { reason: props.reason } : {}),
    victoryHold: props.view.victoryHold ?? null,
    onWatch: props.onWatch ?? (() => undefined),
    onMenu: props.onMenu ?? (() => undefined),
  });
}
