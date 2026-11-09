// Телефон в портрете и ландшафте: ни одно окно интерфейса не выходит за экран, окна не лежат друг
// на друге, страница не прокручивается, кнопки не меньше 44 px. Состояния: начало, выбранная армия,
// «Постройки», режим строительства, настройки, пауза.
import { expect, test, type Page } from '@playwright/test';

const SIZES = [
  { name: 'портрет', width: 390, height: 844 },
  { name: 'ландшафт', width: 844, height: 390 },
  { name: 'малый портрет', width: 360, height: 640 },
  { name: 'малый ландшафт', width: 640, height: 360 },
] as const;

/** Пары окон, которым разрешено перекрываться: окно построек накрывает кнопки режимов карты. */
const ALLOWED_OVERLAP = [['buildings-panel', 'map-tools']];

async function problems(page: Page): Promise<string[]> {
  return page.evaluate((allowed) => {
    const out: string[] = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const boxes: { name: string; r: DOMRect; el: HTMLElement }[] = [];
    // Видимые «плашки»: элементы с фоном или рамкой, кроме самой карты и мелких украшений.
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.tagName === 'CANVAS' || el.closest('canvas') || el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      if (r.width >= W - 1 && r.height >= H - 1) continue;
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const bg = cs.backgroundColor;
      const filled = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const framed = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
      if (!filled && !framed && cs.backgroundImage === 'none') continue;
      if (el.matches('[class*="map"]:not([data-testid])')) continue;
      const name =
        el.getAttribute('data-testid') ??
        (String(el.className)
          .replace(/_[a-z0-9]{5,}_\d+/gu, '')
          .trim()
          .split(/\s+/u)[0] ||
          el.tagName);
      // Плашка внутри прокручиваемой ленты (армии внизу) может уходить за край: её листают пальцем.
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') clipped = true;
      }
      if (clipped) continue;
      boxes.push({ name, r, el });
      if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) {
        out.push(
          `${name} выходит за экран: x${Math.round(r.left)} y${Math.round(r.top)} r${Math.round(r.right)} b${Math.round(r.bottom)} из ${W}x${H}`,
        );
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (!a || !b || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        if (
          allowed.some(([x, y]) => (a.name === x && b.name === y) || (a.name === y && b.name === x))
        ) {
          continue;
        }
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 2 && oy > 2)
          out.push(`${a.name} лежит на ${b.name} (${Math.round(ox)}×${Math.round(oy)})`);
      }
    }
    // Текст верхней панели не обрезан и не вылезает из своей ячейки.
    for (const el of document.querySelectorAll<HTMLElement>(
      'header [class*="value"], header [class*="rate"]',
    )) {
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
        out.push(`текст верхней панели обрезан: "${el.textContent ?? ''}"`);
      }
    }
    const hud = document.querySelector('header');
    if (hud) {
      const hr = hud.getBoundingClientRect();
      for (const el of hud.querySelectorAll<HTMLElement>('[class*="value"], [class*="rate"]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.left < hr.left - 0.5 || r.right > hr.right + 0.5)) {
          out.push(`текст верхней панели вне панели: "${el.textContent ?? ''}"`);
        }
      }
    }
    if (document.documentElement.scrollWidth > W) out.push('горизонтальная прокрутка страницы');
    if (document.documentElement.scrollHeight > H) out.push('вертикальная прокрутка страницы');
    return out;
  }, ALLOWED_OVERLAP);
}

async function click(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => document.querySelector<HTMLElement>(sel)?.click(), selector);
  await page.waitForTimeout(350);
}

for (const size of SIZES) {
  test(`@layout телефон ${size.name} ${size.width}×${size.height}: окна на экране и не лежат друг на друге`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto('/match?map=small&seed=42&players=4');
    await page.waitForTimeout(2500);
    const report: Record<string, string[]> = {};
    report.start = await problems(page);

    await page.evaluate(() => {
      const add = Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) =>
        /новая армия|new army/iu.test(b.getAttribute('aria-label') ?? b.title ?? ''),
      );
      add?.click();
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[class*="strip"] [aria-pressed]')?.click();
    });
    await page.waitForTimeout(500);
    report.army = await problems(page);

    await click(page, '[data-tutorial="buildings"]');
    report.buildings = await problems(page);
    await click(page, '[data-tutorial="buildings"]');

    await click(page, '[data-tutorial="hammer"]');
    report.build = await problems(page);
    await click(page, '[data-tutorial="hammer"]');

    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[class*="settingsButton"]')?.click();
    });
    await page.waitForTimeout(350);
    report.settings = await problems(page);

    await page.evaluate(() => {
      const gear = document.querySelector<HTMLElement>('[class*="settingsButton"]');
      gear?.click();
      const pause = Array.from(document.querySelectorAll<HTMLElement>('header button')).find((b) =>
        /пауза|pause/iu.test(b.getAttribute('aria-label') ?? b.title ?? ''),
      );
      pause?.click();
    });
    await page.waitForTimeout(500);
    report.pause = await problems(page);

    const flat = Object.entries(report).flatMap(([state, list]) =>
      list.map((item) => `[${state}] ${item}`),
    );
    expect(flat).toEqual([]);
    await context.close();
  });
}

for (const size of SIZES) {
  test(`@layout телефон ${size.name} ${size.width}×${size.height}: главное меню помещается и листается`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('section');
      const r = card?.getBoundingClientRect();
      const out: string[] = [];
      if (!r) return ['нет карточки меню'];
      if (r.left < -0.5 || r.right > window.innerWidth + 0.5) out.push('карточка шире экрана');
      if (document.documentElement.scrollWidth > window.innerWidth)
        out.push('горизонтальная прокрутка');
      // Если карточка выше экрана, страница должна прокручиваться, а не обрезать кнопку «Играть».
      const play = document.querySelector<HTMLElement>('a[role="button"]');
      if (play) {
        const p = play.getBoundingClientRect();
        if (p.width < 44 || p.height < 44) out.push('кнопка меньше 44 px');
      }
      // Карточка выше экрана: страница листается, и кнопка «Играть» достаётся пальцем.
      if (play) {
        play.scrollIntoView({ block: 'end' });
        const p = play.getBoundingClientRect();
        if (p.bottom > window.innerHeight + 0.5 || p.top < 0)
          out.push('кнопка «Играть» недоступна');
      }
      return out;
    });
    expect(result).toEqual([]);
    await context.close();
  });
}
