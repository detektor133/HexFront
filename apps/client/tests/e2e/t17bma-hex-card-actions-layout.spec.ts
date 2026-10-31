import { expect, test, type Locator } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;
const ENABLED_ACTION = 'button[class*="button"][class*="accent"]:enabled';

for (const width of WIDTHS) {
  test(`@layout 07/T17bma: доступные действия HexCard светлые при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/dev/sandbox?map=small&seed=42&select=724');
    const constructionCard = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(constructionCard).toBeVisible();
    const construction = constructionCard
      .locator(ENABLED_ACTION)
      .filter({ hasText: /found|depot|fort|склад|укреп|основать/i })
      .first();
    await expect(construction).toBeVisible();
    await expect(construction).toBeEnabled();
    await expectLightAction(construction);

    await page.goto('/dev/sandbox?map=small&seed=42&select=765');
    const cityCard = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(cityCard).toBeVisible();
    const upgrade = cityCard
      .locator(ENABLED_ACTION)
      .filter({ hasText: /upgrade|улучш/i })
      .first();
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toBeEnabled();
    await expectLightAction(upgrade);

    const sliders = page.getByRole('slider');
    const recruitSlider = sliders.nth(1);
    await expect(recruitSlider).toBeVisible();
    await recruitSlider.fill((await recruitSlider.getAttribute('max')) ?? '');
    const recruit = cityCard
      .locator(ENABLED_ACTION)
      .filter({ hasText: /recruit|набор/i })
      .first();
    await expect(recruit).toBeVisible();
    await expect(recruit).toBeEnabled();
    await expectLightAction(recruit);
  });
}

async function expectLightAction(action: Locator): Promise<void> {
  await expect(action).toHaveCSS('background-color', 'rgb(246, 245, 241)');
  await expect(action).toHaveCSS('color', 'rgb(34, 33, 30)');
  await expect(action).toHaveCSS('border-top-color', 'rgb(185, 183, 174)');
  await expect(action).toHaveCSS('border-left-color', 'rgb(201, 154, 46)');
  await expect(action).toHaveCSS('box-shadow', 'rgba(34, 33, 30, 0.14) 0px 2px 0px 0px');
}
