import { expect, test, type Locator } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout @visual 07/T17bmb: содержимое HexCard не переполняется и не перекрывается при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=765');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();
    const hud = page.locator('header').filter({ has: page.getByText(/people|население/i) });
    const leaderboard = page.getByRole('region', { name: /leaderboard|таблица лидеров/i });
    const collapsedLeaderboard = page.getByRole('button', {
      name: /leaderboard|таблица лидеров/i,
    });
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    if (!cardBox) throw new Error('Карточка не имеет границ');
    for (const [name, panel] of [
      ['hud', hud],
      ['leaderboard', leaderboard],
      ['collapsed leaderboard', collapsedLeaderboard],
    ] as const) {
      if ((await panel.count()) === 0 || !(await panel.isVisible())) continue;
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      if (!panelBox) throw new Error('Панель не имеет границ');
      expect(
        intersects(cardBox, panelBox),
        `${name}: ${JSON.stringify({ cardBox, panelBox })}`,
      ).toBe(false);
    }
    const heading = card.locator('h2');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/city|capital|город|столица/i);

    const stats = card.locator('dl');
    await expect(stats.locator('dt')).not.toHaveCount(0);
    const sliders = card.getByRole('slider');
    await expect(sliders).toHaveCount(3);
    const pricedActions = card.locator('button:has(span > svg)');
    await expect(pricedActions).not.toHaveCount(0);

    const horizontalOverflow = await card.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(horizontalOverflow).toBe(false);

    const contentRows = card.locator(':scope > div > *');
    const contentBoxes = await boxes(contentRows);
    expectNoOverlap(contentBoxes);

    const statCells = stats.locator('dt, dd');
    expectNoOverlap(await boxes(statCells));

    for (const button of await pricedActions.all()) {
      const buttonBox = await button.boundingBox();
      const price = button.locator('span:has(svg)');
      const label = button.locator(':scope > span:not(:has(svg))');
      const priceBox = await price.boundingBox();
      const labelBox = await label.boundingBox();
      expect(buttonBox).not.toBeNull();
      expect(priceBox).not.toBeNull();
      expect(labelBox).not.toBeNull();
      if (!buttonBox || !priceBox || !labelBox) {
        throw new Error('Цена, подпись или кнопка не имеет границ');
      }
      expect(isInside(priceBox, buttonBox)).toBe(true);
      expect(intersects(priceBox, labelBox)).toBe(false);
    }

    const recruitRows = await sliders.evaluateAll((inputs) =>
      inputs.map((input) => {
        const action = input.parentElement?.parentElement;
        const control = input.parentElement;
        const button = action?.querySelector('button');
        if (!(control instanceof HTMLElement) || !(button instanceof HTMLElement)) return null;
        const controlBox = control.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();
        return {
          control: {
            x: controlBox.x,
            y: controlBox.y,
            width: controlBox.width,
            height: controlBox.height,
          },
          button: {
            x: buttonBox.x,
            y: buttonBox.y,
            width: buttonBox.width,
            height: buttonBox.height,
          },
        };
      }),
    );
    expect(recruitRows).toHaveLength(3);
    for (const row of recruitRows) {
      expect(row).not.toBeNull();
      if (!row) throw new Error('Строка набора не имеет границ');
      expect(row.button.width).toBeGreaterThan(0);
      expect(row.button.height).toBeGreaterThan(0);
      expect(intersects(row.control, row.button)).toBe(false);
    }

    const outDir = process.env.VISUAL_OUT_DIR;
    if (outDir) await page.screenshot({ path: `${outDir}/hex-card-${width}.png` });
  });
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
}

function expectNoOverlap(rects: readonly Box[]): void {
  for (let first = 0; first < rects.length; first += 1) {
    for (let second = first + 1; second < rects.length; second += 1) {
      const firstBox = rects[first];
      const secondBox = rects[second];
      if (!firstBox || !secondBox) throw new Error('Строка карточки не имеет границ');
      expect(intersects(firstBox, secondBox)).toBe(false);
    }
  }
}

function intersects(first: Box, second: Box): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function isInside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
