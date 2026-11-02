import { expect, test } from '@playwright/test';

const WIDTHS = [1024, 1920] as const;
const CARD = 'section[aria-label]';
const CLOSE_CARD = /close hex card|закрыть карточку клетки/i;

for (const width of WIDTHS) {
  test(`@layout 07/T17cea: кнопка основания города компактна в карточке гекса при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=724');

    const card = page.locator(CARD).filter({ has: page.getByRole('button', { name: CLOSE_CARD }) });
    await expect(card).toBeVisible();
    await expect(card.locator('h2')).toContainText(/plain|forest|mountain|равнина|лес|гора/i);
    await expect(card.getByRole('slider')).toHaveCount(0);

    const foundCity = card.getByRole('button', { name: /found city|основать город/i });
    await expect(foundCity).toBeVisible();
    await expect(foundCity).toHaveAttribute('title', /found city|основать город/i);
    await expect(foundCity).toBeDisabled();
    const price = foundCity.locator('span:has(> [data-gold-icon="true"])');
    await expect(price).toBeVisible();
    await expect(price).toContainText(/\d/u);

    const geometry = await card.evaluate((element) => {
      const cardBounds = element.getBoundingClientRect();
      const button = element.querySelector<HTMLButtonElement>(
        'button[aria-label*="Основать город"], button[aria-label*="Found city"]',
      );
      if (!button) throw new Error('В открытой карточке гекса нет кнопки основания города');
      const buttonBounds = button.getBoundingClientRect();
      return {
        card: {
          left: cardBounds.left,
          right: cardBounds.right,
          top: cardBounds.top,
          bottom: cardBounds.bottom,
        },
        button: {
          left: buttonBounds.left,
          right: buttonBounds.right,
          top: buttonBounds.top,
          bottom: buttonBounds.bottom,
        },
        price: (() => {
          const price = button.querySelector<HTMLElement>('span:has(> [data-gold-icon="true"])');
          if (!price) throw new Error('У кнопки основания города не отображается цена');
          const bounds = price.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        })(),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.card.left);
    expect(geometry.button.right).toBeLessThanOrEqual(geometry.card.right);
    expect(geometry.button.top).toBeGreaterThanOrEqual(geometry.card.top);
    expect(geometry.button.bottom).toBeLessThanOrEqual(geometry.card.bottom);
    expect(geometry.price.left).toBeGreaterThanOrEqual(geometry.button.left);
    expect(geometry.price.right).toBeLessThanOrEqual(geometry.button.right);
    expect(geometry.price.top).toBeGreaterThanOrEqual(geometry.button.top);
    expect(geometry.price.bottom).toBeLessThanOrEqual(geometry.button.bottom);
  });
}
