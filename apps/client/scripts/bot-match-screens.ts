// Запись полного матча ботов 04/T24 для отчёта: песочница, карта small, сид 42, 6 игроков — все под
// ботом (watch=1), ускорение ×10, вся карта. Видео и кадр примерно раз в 2,5 игровые минуты — до
// карточки «Конец матча». Тот же матч без клиента — tools/replay bot-match (графики).
// Запуск при работающем dev-сервере:
//   node --experimental-strip-types apps/client/scripts/bot-match-screens.ts 5173
import { renameSync } from 'node:fs';

import { chromium } from '@playwright/test';

const PORT = process.argv[2] ?? '5173';
const PLAYERS = 6;
const SPEED = 10;
const OUT = new URL('../../../docs/reports/stage-04/', import.meta.url);
const file = (name: string): string => new URL(name, OUT).pathname.replace(/^\/([A-Z]:)/, '$1');
const png = (name: string): string => file(`${name}.png`);

/** Кадр раз в столько реальных секунд: ×10 — 2,5 игровые минуты. */
const FRAME_EVERY_MS = 15_000;
/** Матч не дольше 25:00 игры — при ×10 это 150 с; с запасом на медленный тик. */
const MATCH_LIMIT_MS = 8 * 60_000;
const VIDEO = { width: 960, height: 600 };

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: file('video'), size: VIDEO },
});
const page = await context.newPage();
await page.goto(
  `http://localhost:${PORT}/dev/sandbox?map=small&scale=1&players=${PLAYERS}&watch=1&speed=${SPEED}`,
);
await page.getByText('1-я армия').first().waitFor();
const clock = (): Promise<string> =>
  page
    .locator('header')
    .innerText()
    .then((s) => /\d\d:\d\d/.exec(s)?.[0] ?? '');

const start = Date.now();
const end = page.getByRole('dialog', { name: 'Конец матча' });
let next = 0;
while (Date.now() - start < MATCH_LIMIT_MS && (await end.count()) === 0) {
  if (Date.now() - start >= next) {
    const at = (await clock()).replace(':', '');
    await page.screenshot({ path: png(`bot-match-${at}`) });
    console.log('кадр', at);
    next += FRAME_EVERY_MS;
  }
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: png('bot-match-end') });
console.log('конец', await clock(), await end.innerText().catch(() => 'нет карточки'));
const video = page.video();
await context.close();
if (video) renameSync(await video.path(), file('bot-match.webm'));
await browser.close();
