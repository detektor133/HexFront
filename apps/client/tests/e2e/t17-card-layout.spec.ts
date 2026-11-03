import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;
const CARDS = [
  { kind: 'клетка', select: 724 },
  { kind: 'город', select: 765 },
] as const;

for (const width of WIDTHS) {
  test(`@layout карточки клетки и города: всё внутри окна, плитки и причины не пересекаются при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const card of CARDS) {
      await page.goto(`/dev/sandbox?map=small&seed=42&select=${card.select}`);
      const section = page.locator('section[aria-label]').filter({
        has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
      });
      await expect(section, card.kind).toBeVisible();

      const geometry = await section.evaluate((root) => {
        const rect = (node: Element): DOMRect => node.getBoundingClientRect();
        const frame = rect(root);
        const boxes = [...root.querySelectorAll('button, [id][class*="reason"], dl, svg')]
          .filter((node) => !node.closest('button') || node.tagName === 'BUTTON')
          .map((node) => ({ tag: node.tagName, box: rect(node) }))
          .filter((item) => item.box.width > 0);
        const outside = boxes.filter(
          (item) =>
            item.box.left < frame.left - 0.5 ||
            item.box.right > frame.right + 0.5 ||
            item.box.top < frame.top - 0.5 ||
            item.box.bottom > frame.bottom + 0.5,
        ).length;
        const clickable = [...root.querySelectorAll('button')].map((node) => rect(node));
        const overlaps = clickable.filter((a, i) =>
          clickable.some(
            (b, j) =>
              j > i &&
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5,
          ),
        ).length;
        const reasons = [...root.querySelectorAll('[id][class*="reason"]')].map((node) =>
          rect(node),
        );
        const reasonOverlaps = reasons.filter((r) =>
          clickable.some(
            (b) =>
              r.left < b.right - 0.5 &&
              b.left < r.right - 0.5 &&
              r.top < b.bottom - 0.5 &&
              b.top < r.bottom - 0.5,
          ),
        ).length;
        return {
          outside,
          overlaps,
          reasonOverlaps,
          scrollW: root.scrollWidth,
          clientW: root.clientWidth,
          smallest: Math.min(...clickable.map((b) => Math.min(b.width, b.height))),
        };
      });

      expect(geometry.outside, `${card.kind}: элементы вне окна`).toBe(0);
      expect(geometry.overlaps, `${card.kind}: кнопки пересекаются`).toBe(0);
      expect(geometry.reasonOverlaps, `${card.kind}: причина перекрывает кнопку`).toBe(0);
      expect(geometry.scrollW, `${card.kind}: горизонтальная прокрутка`).toBeLessThanOrEqual(
        geometry.clientW,
      );
      expect(
        geometry.smallest,
        `${card.kind}: кнопка меньше области нажатия`,
      ).toBeGreaterThanOrEqual(44);
    }
  });
}
