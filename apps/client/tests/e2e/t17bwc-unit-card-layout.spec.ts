import { expect, test } from '@playwright/test';

const viewports = [
  { width: 360, height: 640 },
  { width: 1024, height: 768 },
  { width: 1920, height: 1080 },
];

function tokenColorToRgb(token: string): string {
  const match = /^#([\da-f]{6})$/iu.exec(token);
  if (!match?.[1]) throw new Error(`цветовой токен не в формате #RRGGBB: ${token}`);
  const value = Number.parseInt(match[1], 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

for (const viewport of viewports) {
  test(`@layout 07/T17bwc: список и действие не пересекаются при ${viewport.width} px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/dev/sandbox?map=small&seed=42&unitCard=groups-style');

    const card = page
      .locator('section[aria-label="Selected units"], section[aria-label="Выбранные отряды"]')
      .filter({ has: page.locator('h3 button') });
    await expect(card).toBeVisible();
    await expect(card.locator('h3 button')).toHaveCount(2);
    await expect(card.locator('ul button')).toHaveCount(3);
    const action = card.locator(':scope > div > button');
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();

    const layout = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      const body = element.firstElementChild;
      const groups = element.querySelector<HTMLElement>('[class*="unitGroups"]');
      const firstPlate = element.querySelector<HTMLElement>('[class*="unitPlate"]');
      const selectedPlate = element.querySelector<HTMLElement>(
        '[class*="unitPlate"][aria-pressed="true"]',
      );
      const actionButton = element.querySelector<HTMLElement>(':scope > div > button');
      if (
        !(body instanceof HTMLElement) ||
        !groups ||
        !firstPlate ||
        !selectedPlate ||
        !actionButton
      ) {
        throw new Error('фикстура карточки, списка или действия отсутствует');
      }
      const groupsStyle = getComputedStyle(groups);
      const plateStyle = getComputedStyle(firstPlate);
      const bounds = (node: Element): DOMRect => node.getBoundingClientRect();
      const cardBounds = bounds(element);
      const groupsBounds = bounds(groups);
      const actionBounds = bounds(actionButton);
      return {
        card: [cardBounds.left, cardBounds.top, cardBounds.right, cardBounds.bottom],
        groups: [groupsBounds.left, groupsBounds.top, groupsBounds.right, groupsBounds.bottom],
        action: [actionBounds.left, actionBounds.top, actionBounds.right, actionBounds.bottom],
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        cardSurface: style.backgroundColor,
        cardSurfaceToken: style.getPropertyValue('--ui-surface').trim(),
        groupDisplay: groupsStyle.display,
        listDisplay: getComputedStyle(groups.querySelector('ul')).display,
        plateSurface: plateStyle.backgroundColor,
        plateSurfaceToken: style.getPropertyValue('--ui-surface2').trim(),
        plateRadius: plateStyle.borderRadius,
        radiusToken: style.getPropertyValue('--radius-chip').trim(),
        selectionToken: style.getPropertyValue('--selection-color').trim(),
        selectedBorder: getComputedStyle(selectedPlate).borderTopColor,
        lastChildTag: body.lastElementChild?.tagName,
      };
    });

    expect(layout.cardSurface).toBe(tokenColorToRgb(layout.cardSurfaceToken));
    expect(layout.plateSurface).toBe(tokenColorToRgb(layout.plateSurfaceToken));
    expect(layout.plateRadius).toBe(layout.radiusToken);
    expect(layout.selectedBorder).toBe(tokenColorToRgb(layout.selectionToken));
    expect(layout.groupDisplay).not.toBe('table');
    expect(layout.listDisplay).not.toBe('table');
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
    expect(layout.card[0]).toBeGreaterThanOrEqual(0);
    expect(layout.card[1]).toBeGreaterThanOrEqual(0);
    expect(layout.card[2]).toBeLessThanOrEqual(viewport.width);
    expect(layout.card[3]).toBeLessThanOrEqual(viewport.height);
    expect(layout.action[1]).toBeGreaterThanOrEqual(layout.groups[3]);
    expect(layout.action[0]).toBeGreaterThanOrEqual(layout.card[0]);
    expect(layout.action[2]).toBeLessThanOrEqual(layout.card[2]);
    expect(layout.lastChildTag).toBe('BUTTON');
  });
}
