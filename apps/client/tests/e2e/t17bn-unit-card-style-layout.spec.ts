import { expect, test } from '@playwright/test';

const viewports = [
  { width: 360, height: 640 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports) {
  test(`@layout 07/T17bn: стили и геометрия групп отрядов при ${viewport.width} px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/dev/sandbox?map=small&seed=42&unitCard=groups-style');

    const card = page
      .locator('section[aria-label="Selected units"], section[aria-label="Выбранные отряды"]')
      .filter({ has: page.locator('h3 button') });
    const groups = card.locator('section:not([aria-label])');
    const rows = card.locator('[class*="unitList"] button');
    await expect(card).toBeVisible();
    await expect(groups).toHaveCount(2);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(rows.nth(2)).toHaveAttribute('aria-pressed', 'true');

    const initial = await card.evaluate((element) => {
      const group = element.querySelector<HTMLElement>('section:not([aria-label])');
      const heading = element.querySelector<HTMLElement>('h3');
      const headingButton = element.querySelector<HTMLElement>('h3 button');
      const marker = element.querySelector<HTMLElement>('[class*="armyMarker"]');
      if (!group || !heading || !headingButton || !marker)
        throw new Error('группа армии не подготовлена');
      return {
        cardSurface: getComputedStyle(element).backgroundColor,
        cardBorder: getComputedStyle(element).borderTopColor,
        surface: getComputedStyle(group).backgroundColor,
        border: getComputedStyle(group).borderTopColor,
        heading: getComputedStyle(heading).color,
        actionSurface: getComputedStyle(headingButton).backgroundColor,
        marker: getComputedStyle(marker).backgroundColor,
        armyNumber: Number(marker.dataset.armyNumber),
      };
    });
    expect(initial.cardSurface).toBe('rgb(255, 255, 255)');
    expect(initial.cardBorder).toBe('rgb(217, 215, 207)');
    expect(initial.surface).toBe('rgb(246, 245, 241)');
    expect(initial.border).toBe('rgb(217, 215, 207)');
    expect(initial.heading).toBe('rgb(91, 90, 85)');
    expect(initial.actionSurface).toBe('rgb(246, 245, 241)');
    const armyPalette = [
      'rgb(123, 63, 140)',
      'rgb(11, 127, 142)',
      'rgb(158, 44, 140)',
      'rgb(79, 100, 117)',
      'rgb(148, 106, 8)',
      'rgb(99, 106, 28)',
      'rgb(148, 86, 27)',
    ];
    expect(initial.marker).toBe(armyPalette[(initial.armyNumber - 1) % armyPalette.length]);

    const rowStyles = await Promise.all(
      [0, 1].map((index) =>
        rows.nth(index).evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          color: getComputedStyle(element).color,
          borderTopColor: getComputedStyle(element).borderTopColor,
          borderTopStyle: getComputedStyle(element).borderTopStyle,
          borderTopWidth: getComputedStyle(element).borderTopWidth,
        })),
      ),
    );
    expect(rowStyles[0]?.background).toBe('rgb(246, 245, 241)');
    expect(rowStyles[1]?.background).toBe('rgb(255, 255, 255)');
    expect(rowStyles[0]?.color).toBe('rgb(34, 33, 30)');
    expect(rowStyles[1]?.color).toBe('rgb(34, 33, 30)');
    for (const rowStyle of rowStyles) {
      expect(rowStyle?.borderTopColor).toBe('rgb(217, 215, 207)');
      expect(rowStyle?.borderTopStyle).toBe('solid');
      expect(rowStyle?.borderTopWidth).toBe('1px');
    }

    await rows.nth(1).hover();
    const hoverBackground = await rows
      .nth(1)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(hoverBackground).toBe('rgb(246, 245, 241)');
    await rows.nth(1).focus();
    const focusOutline = await rows.nth(1).evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
      };
    });
    expect(focusOutline).toEqual({
      style: 'solid',
      width: '2px',
      color: 'rgb(201, 154, 46)',
    });

    const geometry = await card.evaluate((element) => {
      const bounds = (node: Element): DOMRect => node.getBoundingClientRect();
      const cardBounds = bounds(element);
      const groupBounds = [...element.querySelectorAll('section:not([aria-label])')].map(bounds);
      const rowsByGroup = [...element.querySelectorAll('section:not([aria-label])')].map((group) =>
        [...group.querySelectorAll('.unitList button')].map(bounds),
      );
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        card: [cardBounds.left, cardBounds.top, cardBounds.right, cardBounds.bottom],
        groups: groupBounds.map((item) => [item.left, item.top, item.right, item.bottom]),
        rows: rowsByGroup.map((items) =>
          items.map((item) => [item.left, item.top, item.right, item.bottom]),
        ),
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.card[0]).toBeGreaterThanOrEqual(0);
    expect(geometry.card[1]).toBeGreaterThanOrEqual(0);
    expect(geometry.card[2]).toBeLessThanOrEqual(viewport.width);
    expect(geometry.card[3]).toBeLessThanOrEqual(viewport.height);
    for (let index = 0; index < geometry.groups.length; index += 1) {
      const group = geometry.groups[index];
      if (!group) throw new Error('границы группы отсутствуют');
      expect(group[0]).toBeGreaterThanOrEqual(geometry.card[0]);
      expect(group[1]).toBeGreaterThanOrEqual(geometry.card[1]);
      expect(group[2]).toBeLessThanOrEqual(geometry.card[2]);
      expect(group[3]).toBeLessThanOrEqual(geometry.card[3]);
      const groupRows = geometry.rows[index] ?? [];
      for (const row of groupRows) {
        expect(row[0]).toBeGreaterThanOrEqual(group[0]);
        expect(row[1]).toBeGreaterThanOrEqual(group[1]);
        expect(row[2]).toBeLessThanOrEqual(group[2]);
        expect(row[3]).toBeLessThanOrEqual(group[3]);
      }
      for (let rowIndex = 0; rowIndex < groupRows.length - 1; rowIndex += 1) {
        const current = groupRows[rowIndex];
        const next = groupRows[rowIndex + 1];
        if (!current || !next) throw new Error('границы строки отсутствуют');
        expect(current[3]).toBeLessThanOrEqual(next[1]);
      }
    }
    const [firstGroup, secondGroup] = geometry.groups;
    if (!firstGroup || !secondGroup) throw new Error('фикстура должна содержать две группы');
    expect(firstGroup[3]).toBeLessThanOrEqual(secondGroup[1]);
  });
}
