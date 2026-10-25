import { expect, test } from '@playwright/test';

const WIDTHS = [1280, 1366, 1440, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout T17awb HUD ${width} px: числа и приросты видимы без обрезания и пересечения`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(
      '/match?map=small&hudPop=987654&hudPopRate=12345&hudGold=1234567&hudGoldRate=-2100',
    );
    const hud = page.getByRole('banner');
    await expect(hud).toBeVisible();

    await expect(hud.getByTitle('987 654')).toBeVisible();
    await expect(hud.getByTitle('1 234 567')).toBeVisible();
    await expect(hud.getByTitle(/^\+12 345\/[sc]$/u)).toBeVisible();
    await expect(hud.getByTitle(/^[−-]2 100\/[sc]$/u)).toBeVisible();
    await expect(hud.getByText(/^987[kк]$/u)).toBeVisible();
    await expect(hud.getByText(/^1[.,]2[mм]$/u)).toBeVisible();
    await expect(hud.getByText(/^\+12[kк]\/[sc]$/u)).toBeVisible();
    await expect(hud.getByText(/^[−-]2[.,]1[kк]\/[sc]$/u)).toBeVisible();

    const result = await hud.evaluate((element) => {
      const nodes = Array.from(
        element.querySelectorAll<HTMLElement>('[class*="value"], [class*="rate"]'),
      ).filter((node) => getComputedStyle(node).display !== 'none');
      const errors: string[] = [];
      const slotTexts = Array.from(element.querySelectorAll<HTMLElement>('[class*="slotText"]'));
      for (const slotText of slotTexts) {
        const value = slotText.querySelector<HTMLElement>(':scope > [class*="value"]');
        const rate = slotText.querySelector<HTMLElement>(':scope > [class*="rate"]');
        if (!value || !rate || getComputedStyle(rate).display === 'none') continue;
        const valueRect = value.getBoundingClientRect();
        const rateRect = rate.getBoundingClientRect();
        if (valueRect.bottom <= rateRect.top || rateRect.bottom <= valueRect.top)
          errors.push('значение и прирост расположены в две строки');
      }
      for (const node of nodes) {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.textOverflow === 'ellipsis') errors.push('найден ellipsis');
        if (node.scrollWidth > node.clientWidth) errors.push('число обрезано по ширине');
        if (rect.width <= 0 || rect.height <= 0) errors.push('число невидимо');
        const parent = node.parentElement;
        if (!parent) continue;
        const parentRect = parent.getBoundingClientRect();
        if (rect.left < parentRect.left || rect.right > parentRect.right)
          errors.push('число выходит за слот');
      }
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const left = nodes[first]?.getBoundingClientRect();
          const right = nodes[second]?.getBoundingClientRect();
          if (!left || !right) continue;
          if (
            left.left < right.right &&
            left.right > right.left &&
            left.top < right.bottom &&
            left.bottom > right.top
          ) {
            errors.push('числа пересекаются');
          }
        }
      }
      return errors;
    });

    expect(result).toEqual([]);
  });
}
