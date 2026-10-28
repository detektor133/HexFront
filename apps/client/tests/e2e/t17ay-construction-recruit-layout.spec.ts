import { expect, test } from '@playwright/test';

test('@layout T17ay: отключённые действия показывают причину, курсор и не меняются при наведении', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dev/economy?map=small&seed=42&freezeTime=1&select=724');

  const blocked = page.locator('section[aria-label] button:disabled[aria-describedby]').first();
  await expect(blocked).toBeVisible();
  const blockedReasonId = await blocked.getAttribute('aria-describedby');
  expect(blockedReasonId).not.toBeNull();
  const blockedReason = page.locator(`[id="${blockedReasonId}"]`);
  await expect(blockedReason).toBeVisible();
  await expect(blockedReason).not.toHaveText('');
  await expect(blocked).toHaveCSS('cursor', 'not-allowed');
  await expect(blocked).not.toHaveClass(/accent/u);
  const blockedBefore = await blocked.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, border: style.borderColor };
  });
  await blocked.hover();
  await expect
    .poll(() =>
      blocked.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, border: style.borderColor };
      }),
    )
    .toEqual(blockedBefore);

  await page.goto('/dev/economy?map=small&seed=42&select=765');
  const armorSlider = page.getByRole('slider').nth(1);
  await expect(armorSlider).toBeVisible();
  const maximum = await armorSlider.getAttribute('max');
  expect(maximum).not.toBeNull();
  await armorSlider.fill(maximum ?? '');
  const recruit = armorSlider.locator('xpath=following::button[1]');
  await expect(recruit).toBeEnabled();
  await expect(recruit).toHaveClass(/accent/u);
  await expect(recruit).toHaveCSS('background-color', 'rgb(34, 33, 30)');
  await expect(recruit).toHaveCSS('color', 'rgb(255, 255, 255)');
  await recruit.focus();
  await expect(recruit).toHaveCSS('outline-style', 'solid');
  await recruit.click();
  const unaffordable = page
    .locator('section[aria-label] button:disabled[aria-describedby]:not([class*="muted"])')
    .first();
  await expect(unaffordable).toBeDisabled();
  await expect(unaffordable).not.toHaveClass(/accent/u);
  await expect(unaffordable).toHaveCSS('cursor', 'not-allowed');
  const unaffordableReasonId = await unaffordable.getAttribute('aria-describedby');
  expect(unaffordableReasonId).not.toBeNull();
  const unaffordableReason = page.locator(`[id="${unaffordableReasonId}"]`);
  await expect(unaffordableReason).toBeVisible();
  await expect(unaffordableReason).not.toHaveText('');
  const unaffordableAppearance = await unaffordable.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor, border: style.borderColor };
  });

  await unaffordable.hover();
  await expect
    .poll(() =>
      unaffordable.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor, border: style.borderColor };
      }),
    )
    .toEqual(unaffordableAppearance);

  expect(unaffordableAppearance).not.toEqual(blockedBefore);
});
