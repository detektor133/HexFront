import { useEffect, useRef } from 'react';

import type { RadialAction, RadialMenuState } from './radial-menu.ts';
import { t, type MessageKey } from '../i18n/dict.ts';

function label(action: RadialAction): string {
  return action.label.includes('.')
    ? (t(action.label as MessageKey) ?? action.label)
    : action.label;
}

const MENU_BUTTON_HALF_SIZE = 48;

function clampViewportCoordinate(value: number, viewportSize: number): number {
  const min = MENU_BUTTON_HALF_SIZE;
  const max = viewportSize - MENU_BUTTON_HALF_SIZE;
  if (max < min) return viewportSize / 2;
  return Math.min(Math.max(value, min), max);
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
  if (kind === 'split') {
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
  if (kind === 'bombard') {
    return (
      <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
        <circle cx="17" cy="7" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M4 20h9M7 17l5-5h5M12 12l-2-4H6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  throw new Error(`Неизвестная пиктограмма действия: ${kind}`);
}

export function RadialMenu(props: {
  state: RadialMenuState;
  onAction: (action: RadialAction) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { state } = props;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const center = {
    x: clampViewportCoordinate(state.center.x, viewport.width),
    y: clampViewportCoordinate(state.center.y, viewport.height),
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const lastActivationRef = useRef<{ key: string; source: 'pointer' | 'keyboard' } | null>(null);
  useEffect(() => {
    const releaseCanvasCapture = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        typeof target.hasPointerCapture === 'function' &&
        target.hasPointerCapture(event.pointerId)
      ) {
        target.releasePointerCapture(event.pointerId);
      }
    };
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      props.onClose();
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('pointermove', releaseCanvasCapture);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('pointermove', releaseCanvasCapture);
      document.removeEventListener('keydown', escape);
    };
  }, [props]);
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('unit.toArmy')}
      style={{
        position: 'fixed',
        left: center.x,
        top: center.y,
        width: '1px',
        height: '1px',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        zIndex: 20,
      }}
    >
      {state.active.map((action, index) => {
        const actionKey = `${action.kind}:${action.label}`;
        const angle = -Math.PI / 2 + ((index + 0.5) / state.active.length) * Math.PI * 2;
        const rawX = Math.cos(angle) * 88;
        const rawY = Math.sin(angle) * 88;
        return (
          <button
            key={`${action.kind}-${action.label}`}
            type="button"
            role="menuitem"
            aria-label={label(action)}
            style={{
              position: 'absolute',
              left: `${clampViewportCoordinate(center.x + rawX, viewport.width) - center.x}px`,
              top: `${clampViewportCoordinate(center.y + rawY, viewport.height) - center.y}px`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'auto',
              minWidth: '72px',
            }}
            onPointerUp={() => {
              lastActivationRef.current = { key: actionKey, source: 'pointer' };
              props.onAction(action);
            }}
            onClick={(event) => {
              event.preventDefault();
              if (lastActivationRef.current?.key === actionKey) {
                lastActivationRef.current = null;
                return;
              }
              props.onAction(action);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                lastActivationRef.current = { key: actionKey, source: 'keyboard' };
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
