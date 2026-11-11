// Меню и матч — экраны одной страницы: адрес не меняется, страница не перезагружается, а выход в
// меню освобождает холст и воркер матча (иначе повторные заходы копили бы память). В меню всегда
// крутится один фоновый матч, в игре — один настоящий: число холстов и воркеров не растёт.
import { expect, test, type Page } from '@playwright/test';

async function trackWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const live = new Set<Worker>();
    const Native = window.Worker;
    class Counted extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        live.add(this);
      }
      override terminate(): void {
        live.delete(this);
        super.terminate();
      }
    }
    window.Worker = Counted;
    Object.assign(window, { __liveWorkers: () => live.size, __navMark: Math.random() });
  });
}

const liveWorkers = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __liveWorkers: () => number }).__liveWorkers());

const navMark = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __navMark: number }).__navMark);

test('@layout «Играть» открывает матч на месте, «назад» возвращает в меню без утечек', async ({
  page,
}) => {
  await trackWorkers(page);
  await page.addInitScript(() => localStorage.setItem('hexfront.menuVariant', 'classic'));
  await page.goto('/');
  await expect(page.locator('canvas')).toHaveCount(1, { timeout: 20_000 });
  const mark = await navMark(page);
  const play = page.locator('a[role="button"]').first();

  for (let round = 0; round < 3; round += 1) {
    await play.click();
    // Меню ушло (его кнопки нет), остались один холст и один воркер — матча.
    await expect(play).toHaveCount(0);
    await expect.poll(() => liveWorkers(page), { timeout: 20_000 }).toBe(1);
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe('/');

    await page.goBack();
    await expect(play).toBeVisible();
    // Снова один фоновый матч меню: матч игры освобождён.
    await expect.poll(() => liveWorkers(page), { timeout: 20_000 }).toBe(1);
    await expect(page.locator('canvas')).toHaveCount(1, { timeout: 20_000 });
    expect(await navMark(page)).toBe(mark);
  }
});
