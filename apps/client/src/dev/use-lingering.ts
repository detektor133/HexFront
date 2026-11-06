import { useEffect, useRef, useState } from 'react';

/**
 * Держит исчезнувшее значение на экране ещё `ms` миллисекунд, чтобы панель успела плавно закрыться,
 * а не пропадала рывком (окно отрядов при переходе на гекс).
 * @returns значение для показа (последнее — пока идёт закрытие) и признак закрытия
 */
export function useLingering<T>(
  value: T | null,
  ms: number,
): { readonly value: T | null; readonly closing: boolean } {
  const last = useRef<T | null>(value);
  if (value !== null) last.current = value;
  const open = value !== null;
  const [gone, setGone] = useState(!open);
  useEffect(() => {
    if (open) {
      setGone(false);
      return;
    }
    const id = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(id);
  }, [open, ms]);
  const shown = open ? value : gone ? null : last.current;
  return { value: shown, closing: !open && shown !== null };
}
