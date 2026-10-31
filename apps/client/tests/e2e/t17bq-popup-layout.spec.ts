import { expect, test, type Locator } from '@playwright/test';

const VIEWPORTS = [360, 1024, 1920] as const;
const SURFACE = 'rgb(255, 255, 255)';
const SURFACE2 = 'rgb(246, 245, 241)';
const BORDER = 'rgb(217, 215, 207)';
const INK = 'rgb(34, 33, 30)';
const INK2 = 'rgb(91, 90, 85)';

for (const width of VIEWPORTS) {
  test(`@layout 07/T17bq: окна HUD и паузы имеют светлую геометрию при ${width} px`, async ({
    page,
  }) => {
    const height = 900;
    await page.setViewportSize({ width, height });
    await page.goto('/match?map=small');

    const hud = page.getByRole('banner');
    await expect(hud).toBeVisible();
    const taxButton = page.getByRole('button', { name: /Налог|Tax/u });
    await expect(taxButton).toBeVisible();
    await taxButton.click();
    const taxPopup = page.getByRole('dialog', { name: /Налог|Tax/u });
    await expect(taxPopup).toBeVisible();
    await expect(taxPopup).toHaveCSS('background-color', SURFACE);
    await expect(taxPopup).toHaveCSS('border-top-color', BORDER);
    const taxSlider = taxPopup.getByRole('slider');
    await expect(taxSlider).toHaveCSS('background-color', SURFACE2);
    await expect(taxSlider).toHaveCSS('border-top-color', BORDER);
    await expect(taxPopup.locator('p').first()).toHaveCSS('color', INK2);
    await expectAnchoredBelow(taxPopup, taxButton, hud, width, height);
    await taxButton.click();
    await expect(taxPopup).toBeHidden();

    const settingsButton = page.getByRole('button', { name: /Настройки|Settings/u });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const settingsPopup = page.getByRole('dialog', { name: /Настройки|Settings/u });
    await expect(settingsPopup).toBeVisible();
    await expect(settingsPopup).toHaveCSS('background-color', SURFACE);
    await expect(settingsPopup).toHaveCSS('border-top-color', BORDER);
    const setting = settingsPopup.getByRole('switch').first();
    await expect(setting).toHaveCSS('background-color', SURFACE2);
    await expect(setting).toHaveCSS('border-top-color', BORDER);
    await expect(setting).toHaveCSS('color', INK);
    await expectAnchoredBelow(settingsPopup, settingsButton, hud, width, height);
    await settingsButton.click();
    await expect(settingsPopup).toBeHidden();

    const pauseButton = page.getByRole('button', { name: /Пауза|Pause/u });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    const pauseMenu = page.getByRole('dialog', { name: /Пауза|Pause/u });
    await expect(pauseMenu).toBeVisible();
    await expect(pauseMenu).toHaveCSS('background-color', SURFACE);
    await expect(pauseMenu).toHaveCSS('border-top-color', BORDER);
    await expect(pauseMenu.locator('h2')).toHaveCSS('color', INK);
    for (const action of await pauseMenu.getByRole('button').all()) {
      await expect(action).toHaveCSS('background-color', SURFACE2);
      await expect(action).toHaveCSS('border-top-color', BORDER);
      await expect(action).toHaveCSS('color', INK);
    }
    const menuBounds = await pauseMenu.boundingBox();
    const hudBounds = await hud.boundingBox();
    const pauseStyle = await pauseMenu.getAttribute('style');
    expect(menuBounds).not.toBeNull();
    expect(hudBounds).not.toBeNull();
    if (!menuBounds || !hudBounds) throw new Error('Окно паузы или HUD не имеет геометрии');
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.y).toBeGreaterThanOrEqual(hudBounds.y + hudBounds.height);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(height);
    expect(pauseStyle).toContain('width: 280px');
    expect(Math.abs(menuBounds.x + menuBounds.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(menuBounds.y + menuBounds.height / 2 - height / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(menuBounds.width - 280)).toBeLessThanOrEqual(1);
  });
}

async function awaitNoOverflow(popup: Locator): Promise<void> {
  const overflow = await popup.evaluate(
    (element) =>
      element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
  );
  expect(overflow).toBe(false);
}

async function expectAnchoredBelow(
  popup: Locator,
  button: Locator,
  hud: Locator,
  viewportWidth: number,
  viewportHeight: number,
): Promise<void> {
  const [popupBounds, buttonBounds, hudBounds] = await Promise.all([
    popup.boundingBox(),
    button.boundingBox(),
    hud.boundingBox(),
  ]);
  expect(popupBounds).not.toBeNull();
  expect(buttonBounds).not.toBeNull();
  expect(hudBounds).not.toBeNull();
  if (!popupBounds || !buttonBounds || !hudBounds)
    throw new Error('Попап, кнопка или HUD не имеют геометрии');
  expect(popupBounds.y).toBeGreaterThanOrEqual(buttonBounds.y + buttonBounds.height);
  expect(popupBounds.y).toBeGreaterThanOrEqual(hudBounds.y + hudBounds.height);
  expect(popupBounds.x).toBeGreaterThanOrEqual(0);
  expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(viewportHeight);
  expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(viewportWidth);
  await awaitNoOverflow(popup);
}
