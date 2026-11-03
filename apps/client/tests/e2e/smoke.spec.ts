// Сквозные проверки поведения продукта: матч открывается, карточка города работает, набор идёт.
// Пиксели и устройство компонентов не проверяются — их смотрит человек по снимкам visual-*.
import { expect, test } from '@playwright/test';

const CLOSE_CARD = /close hex card|закрыть карточку клетки/i;

test('@layout smoke: матч открывается с HUD и картой', async ({ page }) => {
  await page.goto('/match?map=small');
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('@layout smoke: выбор своего города и набор войск', async ({ page }) => {
  await page.goto('/dev/sandbox?map=small&seed=42&select=765');
  const card = page.locator('section[aria-label]').filter({
    has: page.getByRole('button', { name: CLOSE_CARD }),
  });
  await expect(card).toBeVisible();
  const recruit = card.getByRole('button', { name: /recruit|набор/i });
  await expect(recruit).toBeEnabled();
  await recruit.click();
  await expect(card.getByText(/recruiting|набор:/i)).toBeVisible();
});

test('@layout smoke: карточка закрывается', async ({ page }) => {
  await page.goto('/dev/sandbox?map=small&seed=42&select=724');
  const close = page.getByRole('button', { name: CLOSE_CARD });
  await expect(close).toBeVisible();
  await close.click();
  await expect(close).toBeHidden();
});
