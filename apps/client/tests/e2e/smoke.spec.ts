// Сквозные проверки поведения продукта: матч открывается, карточка города работает, набор идёт.
// Пиксели и устройство компонентов не проверяются — их смотрит человек по снимкам visual-*.
import { expect, test } from '@playwright/test';

const CLOSE_CARD = /close hex card|закрыть карточку клетки/i;

test('@layout smoke: матч открывается с HUD и картой', async ({ page }) => {
  await page.goto('/match?map=small');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('@layout smoke: выбор своего города и улучшение', async ({ page }) => {
  await page.goto('/dev/sandbox?map=small&seed=42&select=765');
  const card = page.locator('section[aria-label]').filter({
    has: page.getByRole('button', { name: CLOSE_CARD }),
  });
  await expect(card).toBeVisible();
  // Набора войск из города нет (армии набирают приказом на панели армии): здесь стройка.
  const upgrade = card.getByRole('button', { name: /upgrade city|улучшить город/i });
  await expect(upgrade).toBeEnabled();
  await upgrade.click();
  await expect(card.getByText(/building|строится/i)).toBeVisible();
});

test('@layout smoke: карточка закрывается', async ({ page }) => {
  await page.goto('/dev/sandbox?map=small&seed=42&select=724');
  const close = page.getByRole('button', { name: CLOSE_CARD });
  await expect(close).toBeVisible();
  await close.click();
  await expect(close).toBeHidden();
});

for (const size of [12, 30, 60]) {
  test(`@layout smoke: случайная карта размера ${size} строится на устройстве и матч открывается`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/match?map=gen&seed=${1_000_000 + size}&players=4&size=${size}`);
    await expect(page.getByRole('banner')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
