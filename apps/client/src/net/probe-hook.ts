/**
 * Крючок для зонда производительности (tests/probe): страница сообщает длительность стадий приёма
 * вида (разбор, применение, показ). Без зонда вызов стоит одно чтение глобальной переменной.
 */
type ProbeHook = (kind: string, ms: number) => void;

/** Засекает стадию и сообщает зонду; возвращает результат стадии. */
export function probed<T>(kind: string, run: () => T): T {
  const hook = (globalThis as { __hexfrontProbe?: ProbeHook }).__hexfrontProbe;
  if (hook === undefined) return run();
  const started = performance.now();
  try {
    return run();
  } finally {
    hook(kind, performance.now() - started);
  }
}
