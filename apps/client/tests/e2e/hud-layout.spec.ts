import { expect, test } from '@playwright/test';

const WIDTHS = [360, 768, 1024, 1366, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout HUD ${width} px: группы видимы, не пересекаются и не переполняются`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/match?map=small');
    const hud = page.getByRole('banner');
    await expect(hud).toBeVisible();

    const result = await hud.evaluate((element) => {
      const hudRect = element.getBoundingClientRect();
      const groups = Array.from(element.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const errors: string[] = [];
      let previousRight = hudRect.left;
      if (hudRect.width <= 0 || hudRect.height <= 0) errors.push('HUD имеет нулевой размер');
      if (element.scrollWidth > element.clientWidth) errors.push('HUD имеет горизонтальный скролл');
      if (groups.length !== 8) errors.push(`ожидалось 8 групп, получено ${groups.length}`);
      for (const [index, group] of groups.entries()) {
        const rect = group.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0)
          errors.push(`группа ${index} имеет нулевой размер`);
        if (rect.left < hudRect.left || rect.right > hudRect.right)
          errors.push(`группа ${index} выходит за HUD`);
        if (rect.left < previousRight) errors.push(`группа ${index} пересекает предыдущую`);
        previousRight = rect.right;

        const metric = group.className.includes('slot') || group.className.includes('taxWrap');
        const childRects: DOMRect[] = [];
        for (const child of metric
          ? group.querySelectorAll<HTMLElement>(
              ':scope > svg, :scope > [class*="slotText"], :scope > [class*="rate"], :scope > [class*="taxButton"]',
            )
          : []) {
          const childRect = child.getBoundingClientRect();
          childRects.push(childRect);
          if (childRect.width <= 0 || childRect.height <= 0)
            errors.push(`дочерний элемент группы ${index} имеет нулевой размер`);
          if (childRect.left < rect.left || childRect.right > rect.right)
            errors.push(`дочерний элемент группы ${index} выходит за группу`);
        }
        for (const child of metric
          ? group.querySelectorAll<HTMLElement>(
              ':scope > [class*="slotText"] > [class*="value"], :scope > [class*="slotText"] > [class*="rate"], :scope > [class*="taxButton"] > svg, :scope > [class*="taxButton"] > [class*="value"], :scope > [class*="taxButton"] > [class*="rate"]',
            )
          : []) {
          const childRect = child.getBoundingClientRect();
          let effectivelyVisible = true;
          for (
            let ancestor: HTMLElement | null = child;
            ancestor && ancestor !== group;
            ancestor = ancestor.parentElement
          ) {
            const style = getComputedStyle(ancestor);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number(style.opacity) === 0
            ) {
              effectivelyVisible = false;
              break;
            }
          }
          if (
            childRect.width <= 0 ||
            childRect.height <= 0 ||
            child.getClientRects().length === 0 ||
            !effectivelyVisible
          ) {
            errors.push(`значение ${child.className} группы ${index} не видно`);
          }
          for (
            let ancestor = child.parentElement;
            ancestor && ancestor !== group;
            ancestor = ancestor.parentElement
          ) {
            const ancestorStyle = getComputedStyle(ancestor);
            const clips = ['hidden', 'clip', 'scroll', 'auto'].some(
              (overflow) =>
                ancestorStyle.overflowX === overflow || ancestorStyle.overflowY === overflow,
            );
            if (!clips) continue;
            const ancestorRect = ancestor.getBoundingClientRect();
            if (
              childRect.left < ancestorRect.left ||
              childRect.right > ancestorRect.right ||
              childRect.top < ancestorRect.top ||
              childRect.bottom > ancestorRect.bottom
            ) {
              errors.push(`значение ${child.className} группы ${index} обрезано`);
            }
          }
        }
        const taxButton = group.querySelector<HTMLElement>(':scope > [class*="taxButton"]');
        const taxButtonRect = taxButton?.getBoundingClientRect();
        const taxContents = taxButton
          ? Array.from(taxButton.children).filter(
              (child): child is Element => child instanceof Element,
            )
          : [];
        for (const child of taxContents) {
          const childRect = child.getBoundingClientRect();
          if (!taxButtonRect) continue;
          if (childRect.width <= 0 || childRect.height <= 0)
            errors.push(`содержимое кнопки налога группы ${index} имеет нулевой размер`);
          if (
            childRect.left < taxButtonRect.left ||
            childRect.right > taxButtonRect.right ||
            childRect.top < taxButtonRect.top ||
            childRect.bottom > taxButtonRect.bottom
          ) {
            errors.push(`содержимое кнопки налога группы ${index} выходит за кнопку`);
          }
        }
        for (let first = 0; first < taxContents.length; first += 1) {
          for (let second = first + 1; second < taxContents.length; second += 1) {
            const firstRect = taxContents[first]?.getBoundingClientRect();
            const secondRect = taxContents[second]?.getBoundingClientRect();
            if (!firstRect || !secondRect) continue;
            if (
              firstRect.left < secondRect.right &&
              firstRect.right > secondRect.left &&
              firstRect.top < secondRect.bottom &&
              firstRect.bottom > secondRect.top
            ) {
              errors.push(`содержимое кнопки налога группы ${index} пересекается`);
            }
          }
        }
        for (let first = 0; first < childRects.length; first += 1) {
          for (let second = first + 1; second < childRects.length; second += 1) {
            const firstRect = childRects[first];
            const secondRect = childRects[second];
            if (!firstRect || !secondRect) continue;
            if (
              firstRect.left < secondRect.right &&
              firstRect.right > secondRect.left &&
              firstRect.top < secondRect.bottom &&
              firstRect.bottom > secondRect.top
            ) {
              errors.push(`child elements in group ${index} overlap`);
            }
          }
        }
      }
      return errors;
    });

    expect(result).toEqual([]);
  });
}

test('@layout кнопка налога меняет backgroundColor при наведении', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/match?map=small');
  const taxButton = page.locator('button[class*="taxButton"]');
  await expect(taxButton).toBeVisible();

  const initialBackgroundColor = await taxButton.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await taxButton.hover();
  const hoveredColors = await taxButton.evaluate((element) => {
    const expected = document.createElement('span');
    expected.style.backgroundColor = 'var(--ui-surface2)';
    document.body.append(expected);
    const expectedBackgroundColor = getComputedStyle(expected).backgroundColor;
    expected.remove();
    return {
      actualBackgroundColor: getComputedStyle(element).backgroundColor,
      expectedBackgroundColor,
    };
  });

  expect(hoveredColors.actualBackgroundColor).not.toBe(initialBackgroundColor);
  expect(hoveredColors.actualBackgroundColor).toBe(hoveredColors.expectedBackgroundColor);
});
