import { expect, test } from '@playwright/test';

test('@layout статусная панель на 360 px сжимается в один ряд без переполнения', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/match?map=small');

  const hud = page.getByRole('banner');
  await expect(hud).toBeVisible();

  const result = await hud.evaluate((element) => {
    const hudRect = element.getBoundingClientRect();
    const groups = Array.from(element.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const metrics = groups.filter(
      (group) => group.className.includes('slot') || group.className.includes('taxWrap'),
    );
    const rows = metrics.map((group) => {
      const rect = group.getBoundingClientRect();
      const values = Array.from(
        group.querySelectorAll<HTMLElement>('[class*="value"], [class*="rate"], svg'),
      );
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        valuesVisible: values.every((value) => value.getClientRects().length > 0),
      };
    });

    return {
      hudBottom: hudRect.bottom,
      hudLeft: hudRect.left,
      hudRight: hudRect.right,
      hudTop: hudRect.top,
      horizontalOverflow: element.scrollWidth > element.clientWidth,
      rows,
      text: element.textContent ?? '',
    };
  });

  expect(result.horizontalOverflow).toBe(false);
  expect(result.rows).toHaveLength(6);
  expect(
    result.rows.every((row) => row.left >= result.hudLeft && row.right <= result.hudRight),
  ).toBe(true);
  expect(
    result.rows.every((row) => row.top >= result.hudTop && row.bottom <= result.hudBottom),
  ).toBe(true);
  expect(result.rows.every((row) => row.valuesVisible)).toBe(true);
  const firstRow = result.rows[0];
  expect(firstRow).toBeDefined();
  expect(
    result.rows.every(
      (row) =>
        row.top < (firstRow?.bottom ?? row.bottom) && row.bottom > (firstRow?.top ?? row.top),
    ),
  ).toBe(true);
  expect(result.text).toMatch(/\+|%|#/u);
});
