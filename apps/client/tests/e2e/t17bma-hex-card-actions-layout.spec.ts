import { expect, test, type Locator } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;
const IMPROVEMENT_WIDTHS = [1024, 1920] as const;

for (const width of IMPROVEMENT_WIDTHS) {
  test(`@layout 07/T17cebc: кнопка благоустройства в карточке обычной клетки без переполнения при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=724');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute(
      'aria-label',
      /^(Вода|Равнина|Лес|Холмы|Горы|Пустыня, степь|Water|Plains|Forest|Hills|Mountains|Desert, steppe)$/,
    );

    const improvement = card.getByRole('button', {
      name: /improve|благоустроить/i,
    });
    await expect(improvement).toBeVisible();
    await expect(improvement).toBeEnabled();

    const cardBox = await card.boundingBox();
    const buttonBox = await improvement.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    if (!cardBox || !buttonBox) throw new Error('карточка или кнопка не имеет геометрии');
    expect(buttonBox.x).toBeGreaterThanOrEqual(cardBox.x);
    expect(buttonBox.y).toBeGreaterThanOrEqual(cardBox.y);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    await expect(card).toHaveJSProperty(
      'scrollWidth',
      await card.evaluate((node) => node.clientWidth),
    );
    await expect(card).toHaveJSProperty(
      'scrollHeight',
      await card.evaluate((node) => node.clientHeight),
    );
  });
}

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
    const construction = constructionCard.getByRole('button', { name: /fort|укреп/i });
    await expect(construction).toBeVisible();
    await expect(construction).toBeEnabled();
    await expectLightAction(construction);

    await page.goto('/dev/sandbox?map=small&seed=42&select=765');
    const cityCard = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(cityCard).toBeVisible();
    const upgrade = cityCard.getByRole('button', { name: /upgrade city|улучшить город/i });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toBeEnabled();
    await expectLightAction(upgrade);

    const recruitSlider = cityCard.getByRole('slider', { name: /soldier count|число солдат/i });
    await expect(recruitSlider).toBeVisible();
    await recruitSlider.fill((await recruitSlider.getAttribute('max')) ?? '');
    const recruit = cityCard.getByRole('button', { name: /recruit|набор/i });
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
