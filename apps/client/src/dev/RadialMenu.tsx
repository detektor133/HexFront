import type { RadialAction, RadialMenuState } from './radial-menu.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

function label(action: RadialAction): string {
  return action.label.includes('.') ? t(action.label as MessageKey) : action.label;
}

function icon(kind: RadialAction['kind']): React.JSX.Element {
  if (kind === 'merge') {
    return (
      <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
        <path
          d="M4 6h6l4 4h6M4 18h6l4-4h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="m17 7 3 3-3 3M17 11l3 3-3 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'assignUnits') {
    return (
      <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
        <circle cx="9" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M3 19c0-3 2.5-5 6-5s6 2 6 5M15 14c3 0 5 1.8 5 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
      <path
        d="M4 20h7M7 17l7-7M10 20l7-7M14 10l3-3 3 3M17 7V4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 4h5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RadialMenu(props: {
  state: RadialMenuState;
  onAction: (action: RadialAction) => void;
}): React.JSX.Element {
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
            onClick={() => props.onAction(action)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.onAction(action);
              }
            }}
          >
            {icon(action.kind)}
            {label(action)}
          </button>
        );
      })}
    </div>
  );
}
