import { vi } from 'vitest';

interface ResizeRecord {
  readonly kind: 'dock' | 'card';
  readonly target: HTMLElement;
  readonly callback: ResizeObserverCallback;
  readonly observer: ResizeObserver;
  contentHeight: number;
}

export interface ResizeStats {
  dockObserves: number;
  dockDisconnects: number;
  dockCallbacks: number;
  cardObserves: number;
  cardDisconnects: number;
  observers: ResizeRecord[];
}

function pixels(value: string): number {
  return Number.parseFloat(value) || 0;
}

function verticalBox(element: HTMLElement): { padding: number; border: number } {
  const style = getComputedStyle(element);
  return {
    padding: pixels(style.paddingTop) + pixels(style.paddingBottom),
    border: pixels(style.borderTopWidth) + pixels(style.borderBottomWidth),
  };
}

function innerHeight(record: ResizeRecord): number {
  const { target, contentHeight } = record;
  const outer = target.parentElement;
  const outerBox = outer ? verticalBox(outer) : { padding: 0, border: 0 };
  const assigned = target.style.height.endsWith('%')
    ? Math.max(0, pixels(outer?.style.height ?? '') - outerBox.padding - outerBox.border)
    : pixels(target.style.height);
  return Math.max(contentHeight, assigned);
}

function notify(stats: ResizeStats, record: ResizeRecord): void {
  if (record.kind === 'dock') stats.dockCallbacks += 1;
  record.callback(
    [
      {
        target: record.target,
        contentRect: new DOMRect(0, 0, 100, innerHeight(record)),
      } as unknown as ResizeObserverEntry,
    ],
    record.observer,
  );
}

/** Моделирует только измеряемые размеры; CSS и дерево узлов остаются настоящими. */
export function installResizeObserver(stats: ResizeStats): void {
  class Observer {
    private record: ResizeRecord | undefined;
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: HTMLElement): void {
      const kind = target.className.includes('content') ? 'dock' : 'card';
      if (kind === 'card' && !target.className.includes('cardBody')) {
        const height = target.className.includes('hud') ? 88 : 0;
        this.callback(
          [{ target, contentRect: new DOMRect(0, 0, 0, height) } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
        return;
      }
      if (kind === 'dock') stats.dockObserves += 1;
      else stats.cardObserves += 1;
      const record: ResizeRecord = {
        kind,
        target,
        callback: this.callback,
        observer: this as unknown as ResizeObserver,
        contentHeight: kind === 'dock' ? 150 : 88,
      };
      this.record = record;
      stats.observers.push(record);
      Object.defineProperty(target, 'scrollHeight', {
        configurable: true,
        get: () => innerHeight(record) + verticalBox(target).padding,
      });
      const outer = target.parentElement;
      if (outer)
        Object.defineProperty(outer, 'scrollHeight', {
          configurable: true,
          get: () => {
            const box = verticalBox(outer);
            const assigned = pixels(outer.style.height);
            const assignedContent =
              getComputedStyle(outer).boxSizing === 'border-box'
                ? Math.max(0, assigned - box.padding - box.border)
                : assigned;
            return Math.max(innerHeight(record), assignedContent) + box.padding;
          },
        });
      notify(stats, record);
    }
    disconnect(): void {
      if (this.record?.kind === 'dock') stats.dockDisconnects += 1;
      if (this.record?.kind === 'card') stats.cardDisconnects += 1;
    }
  }
  vi.stubGlobal('ResizeObserver', Observer);
}

/** Повторно читает актуальный style.height после предыдущего callback и рендера React. */
export function reportHeight(
  stats: ResizeStats,
  kind: 'dock' | 'card',
  contentHeight?: number,
): void {
  const record = [...stats.observers].reverse().find((item) => item.kind === kind);
  if (!record) throw new Error(`ResizeObserver для ${kind} не найден`);
  if (contentHeight !== undefined) record.contentHeight = contentHeight;
  notify(stats, record);
}
