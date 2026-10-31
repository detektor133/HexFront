import { IconCoin } from '@tabler/icons-react';

export function GoldIcon(props: { className?: string; label?: string }): React.JSX.Element {
  return (
    <IconCoin
      size={14}
      stroke={1.75}
      {...(props.className ? { className: props.className } : {})}
      {...(props.label ? { 'aria-label': props.label } : { 'aria-hidden': true })}
      data-gold-icon="true"
    />
  );
}
