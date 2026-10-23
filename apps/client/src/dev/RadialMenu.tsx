import type { RadialAction, RadialMenuState } from './radial-menu.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

function label(action: RadialAction): string {
  return action.label.includes('.') ? t(action.label as MessageKey) : action.label;
}

export function RadialMenu(props: { state: RadialMenuState }): React.JSX.Element {
  const { state } = props;
  return (
    <div
      role="menu"
      aria-label={t('unit.toArmy')}
      style={{
        position: 'fixed',
        left: state.center.x,
        top: state.center.y,
        pointerEvents: 'auto',
        zIndex: 20,
      }}
    >
      {state.active.map((action, index) => {
        const angle = -Math.PI / 2 + ((index + 0.5) / state.active.length) * Math.PI * 2;
        return (
          <button
            key={`${action.kind}-${action.label}`}
            type="button"
            role="menuitem"
            aria-label={label(action)}
            style={{
              position: 'absolute',
              left: `${Math.cos(angle) * 88}px`,
              top: `${Math.sin(angle) * 88}px`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              minWidth: '72px',
            }}
          >
            {label(action)}
          </button>
        );
      })}
    </div>
  );
}
