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
              ':scope > svg, :scope > [class*="slotText"], :scope > [class*="rate"]',
            )
          : []) {
          const childRect = child.getBoundingClientRect();
          childRects.push(childRect);
          if (childRect.width <= 0 || childRect.height <= 0)
            errors.push(`дочерний элемент группы ${index} имеет нулевой размер`);
          if (childRect.left < rect.left || childRect.right > rect.right)
            errors.push(`дочерний элемент группы ${index} выходит за группу`);
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
