import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

const LONG_PRESS_MS = 350;
const MOVE_CANCEL_DISTANCE_PX = 8;

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'title'
> {
  readonly label: string;
  readonly children: ReactNode;
}

/** Кнопка-иконка с подписью при удержании на сенсорном экране. */
export function IconButton(props: IconButtonProps): React.JSX.Element {
  const { children, label, onClick, type, ...buttonProps } = props;
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const longPressRef = useRef<boolean>(false);

  const clearPress = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPointRef.current = null;
  };

  useEffect(() => clearPress, []);

  const cancelPress = (): void => {
    clearPress();
    longPressRef.current = false;
    setShowTooltip(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === 'mouse') return;
    longPressRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      longPressRef.current = true;
      flushSync(() => setShowTooltip(true));
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const start = startPointRef.current;
    if (start === null) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > MOVE_CANCEL_DISTANCE_PX) cancelPress();
  };

  const handlePointerUp = (): void => {
    clearPress();
    setShowTooltip(false);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (longPressRef.current) {
      event.preventDefault();
      longPressRef.current = false;
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        {...buttonProps}
        type={type ?? 'button'}
        aria-label={label}
        title={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelPress}
        onClick={handleClick}
      >
        {children}
      </button>
      {showTooltip && (
        <span role="tooltip" aria-label={label}>
          {label}
        </span>
      )}
    </>
  );
}
