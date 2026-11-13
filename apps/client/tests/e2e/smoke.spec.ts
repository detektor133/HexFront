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

test('@layout smoke: выбор места старта на карте, затем матч начинается', async ({ page }) => {
  await page.goto('/match?map=small&seed=7&players=3&pick=1');
  const bar = page.getByRole('region', { name: /Выберите место старта|Pick your start/ });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('banner')).toHaveCount(0);
  const box = await page.locator('canvas').boundingBox();
  if (box === null) throw new Error('нет карты');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.getByRole('button', { name: /Начать|Start/ }).click();
  await expect(page.getByRole('banner')).toBeVisible({ timeout: 30_000 });
  await expect(bar).toHaveCount(0);
});

test('@layout smoke: «Случайно» начинает матч без выбранной точки', async ({ page }) => {
  await page.goto('/match?map=small&seed=7&players=3&pick=1');
  await page.getByRole('button', { name: /Случайно|Random/ }).click({ timeout: 30_000 });
  await expect(page.getByRole('banner')).toBeVisible({ timeout: 30_000 });
});
