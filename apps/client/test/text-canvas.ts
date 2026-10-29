import { vi } from 'vitest';

export function installTextCanvasStub(): void {
  class TestCanvasRenderingContext2D {
    public font = '';

    public scale(_x: number, _y: number): void {}

    public fillText(_text: string, _x: number, _y: number): void {}

    public measureText(value: string): TextMetrics {
      const width = [...value].reduce(
        (total, character) => total + ('МШЮW'.includes(character) ? 18 : 8),
        0,
      );
      return { width } as TextMetrics;
    }
  }
  const context = new TestCanvasRenderingContext2D();
  vi.stubGlobal('CanvasRenderingContext2D', TestCanvasRenderingContext2D);
  vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
}
