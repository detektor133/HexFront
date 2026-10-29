import { expect, test } from '@playwright/test';

test('@layout 07/T17bdc: список выбранных групп не переполняется, кнопки имеют область 44×44 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/dev/sandbox?map=small&seed=42&unitCard=groups');

  const card = page.locator('section[aria-label]').filter({ has: page.locator('h3 button') });
  await expect(card).toBeVisible();
  const groups = card.locator('h3 button');
  const rows = card.locator('ul button');
  await expect(groups).toHaveCount(2);
  await expect(rows).toHaveCount(2);
  const groupTitles = await groups.allTextContents();
  expect(groupTitles[0]).not.toMatch(/^(Reserve|Резерв)$/);
  expect(groupTitles[1]).toMatch(/^(Reserve|Резерв)$/);
  const groupLists = card.locator('ul');
  await expect(groupLists).toHaveCount(2);
  await expect(groupLists.nth(0).locator('button')).toHaveCount(1);
  await expect(groupLists.nth(1).locator('button')).toHaveCount(1);

  const [scrollWidth, clientWidth] = await card.evaluate((element) => [
    element.scrollWidth,
    element.clientWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

  const [cardBounds, leaderboardBounds] = await Promise.all([
    card.boundingBox(),
    page.locator('[aria-label="Leaderboard"], [aria-label="Таблица лидеров"]').boundingBox(),
  ]);
  expect(cardBounds).not.toBeNull();
  expect(leaderboardBounds).not.toBeNull();
  if (!cardBounds || !leaderboardBounds) throw new Error('панель не имеет границ');
  const overlapsLeaderboard =
    cardBounds.x < leaderboardBounds.x + leaderboardBounds.width &&
    cardBounds.x + cardBounds.width > leaderboardBounds.x &&
    cardBounds.y < leaderboardBounds.y + leaderboardBounds.height &&
    cardBounds.y + cardBounds.height > leaderboardBounds.y;
  expect(overlapsLeaderboard).toBe(false);

  for (const button of await card.getByRole('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('кнопка списка не имеет границ');
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
});
