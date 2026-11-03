import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;
const CARD = 'section[aria-label]';
const CLOSE_CARD = /close hex card|закрыть карточку клетки/i;

for (const width of WIDTHS) {
  test(`@layout 07/T17ccb: строки показателей карточек не переполняются при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });

    for (const selection of [
      { id: 765, kind: 'город', heading: /city|capital|город|столица/i },
      { id: 724, kind: 'гекс', heading: /plain|forest|mountain|равнина|лес|гора/i },
    ] as const) {
      await page.goto(`/dev/sandbox?map=small&seed=42&select=${selection.id}`);
      const card = page.locator(CARD).filter({
        has: page.getByRole('button', { name: CLOSE_CARD }),
      });

      await expect(card, `открыта карточка: ${selection.kind}`).toBeVisible();
      await expect(card.locator('h2')).toContainText(selection.heading);
      const stats = card.locator('dl');
      await expect(stats.locator('dt')).not.toHaveCount(0);
      if (selection.kind === 'город') await expect(card.getByRole('slider')).toHaveCount(1);
      else await expect(card.getByRole('slider')).toHaveCount(0);

      const geometry = await stats.evaluate((element) => {
        const rows = Array.from(element.querySelectorAll<HTMLElement>(':scope > dt')).map(
          (label) => {
            const value = label.nextElementSibling;
            if (!(value instanceof HTMLElement)) return null;
            const labelRect = label.getBoundingClientRect();
            const valueRect = value.getBoundingClientRect();
            return {
              labelRight: labelRect.right,
              valueLeft: valueRect.left,
              valueRight: valueRect.right,
              rowTop: labelRect.top,
              valueTop: valueRect.top,
              rowBottom: labelRect.bottom,
              valueBottom: valueRect.bottom,
            };
          },
        );
        return {
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          bounds: element.getBoundingClientRect().toJSON(),
          rows,
        };
      });

      expect(geometry.scrollWidth, `${selection.kind}: ширина строк`).toBeLessThanOrEqual(
        geometry.clientWidth,
      );
      expect(geometry.rows.length).toBeGreaterThan(0);
      for (const row of geometry.rows) {
        expect(row, `${selection.kind}: значение строки`).not.toBeNull();
        if (!row) throw new Error('Строка показателя не имеет значения');
        expect(row.valueRight).toBeLessThanOrEqual(geometry.bounds.right);
        expect(row.valueLeft).toBeGreaterThanOrEqual(row.labelRight);
        expect(row.rowTop).toBeLessThan(row.valueBottom);
        expect(row.valueTop).toBeLessThan(row.rowBottom);
      }
    }
  });
}
