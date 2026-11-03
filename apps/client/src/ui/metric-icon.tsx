import {
  IconArrowUp,
  IconClock,
  IconCoin,
  IconPackage,
  IconPercentage,
  IconShield,
  IconTrophy,
  IconTrendingUp,
  IconUsers,
} from '@tabler/icons-react';

import { t, type MessageKey } from '../i18n/dict.ts';

export type MetricIconName =
  | 'people'
  | 'gold'
  | 'tax'
  | 'supply'
  | 'time'
  | 'place'
  | 'growth'
  | 'fort'
  | 'improvement'
  | 'organization'
  | 'population';

const METRIC_ICONS = {
  people: IconUsers,
  gold: IconCoin,
  tax: IconPercentage,
  supply: IconPackage,
  time: IconClock,
  place: IconTrophy,
  growth: IconTrendingUp,
  fort: IconShield,
  improvement: IconArrowUp,
  organization: IconShield,
  population: IconUsers,
} as const;

const METRIC_LABELS: Record<MetricIconName, MessageKey> = {
  people: 'hud.people',
  gold: 'hud.gold',
  tax: 'hud.tax',
  supply: 'hud.supply',
  time: 'hud.time',
  place: 'hud.place',
  growth: 'card.growth',
  fort: 'card.fort',
  improvement: 'card.improvement',
  organization: 'unit.org',
  population: 'card.pop',
};

export function MetricIcon(props: {
  name: MetricIconName;
  className?: string;
  decorative?: boolean;
}): React.JSX.Element {
  const Icon = METRIC_ICONS[props.name];
  const label = t(METRIC_LABELS[props.name]);
  return (
    <Icon
      size={14}
      stroke={1.75}
      {...(props.className ? { className: props.className } : {})}
      {...(props.decorative ? { 'aria-hidden': true } : { title: label, 'aria-label': label })}
      data-metric-icon={props.name}
    />
  );
}

export function MetricRow(props: { name: MetricIconName; value: string }): React.JSX.Element {
  return (
    <div>
      <dt>
        <MetricIcon name={props.name} />
      </dt>
      <dd>{props.value}</dd>
    </div>
  );
}
