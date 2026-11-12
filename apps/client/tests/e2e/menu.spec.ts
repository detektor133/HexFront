// Главное меню: помещается в экран без прокрутки, ник и док доступны пальцем, цвета и панели
// режимов не выходят за экран.
import { expect, test } from '@playwright/test';

const SIZES = [
  { name: 'портрет 390×844', width: 390, height: 844 },
  { name: 'малый портрет 360×640', width: 360, height: 640 },
  { name: 'ландшафт 844×390', width: 844, height: 390 },
  { name: 'компьютер 1280×720', width: 1280, height: 720 },
];

for (const size of SIZES) {
  test(`@layout меню ${size.name}: без прокрутки, окна внутри экрана`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      hasTouch: size.width < 900,
      isMobile: size.width < 900,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('hexfront.tutorialAsked', '1');
      localStorage.setItem('hexfront.nickname', 'Danil');
    });
    await page.goto('/');
    await page.waitForTimeout(2000);

    const inside = async (selector: string, label: string): Promise<string[]> =>
      page.evaluate(
        ({ selector: sel, label: name }) => {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) return [`${name}: нет на экране`];
          const r = el.getBoundingClientRect();
          const out: string[] = [];
          if (r.left < -0.5 || r.right > window.innerWidth + 0.5)
            out.push(`${name}: за краем по ширине`);
          if (r.top < -0.5 || r.bottom > window.innerHeight + 0.5)
            out.push(`${name}: за краем по высоте`);
          return out;
        },
        { selector, label },
      );

    const scroll = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return [
        ...(root.scrollHeight > window.innerHeight + 1 ? ['вертикальная прокрутка'] : []),
        ...(root.scrollWidth > window.innerWidth ? ['горизонтальная прокрутка'] : []),
      ];
    });
    expect(scroll).toEqual([]);
    expect(await inside('main input', 'ник')).toEqual([]);

    // Цвета раскрываются внутри плашки ника.
    await page
      .getByRole('button', { name: /Цвет|Color/ })
      .first()
      .click();
    await page.waitForTimeout(200);
    expect(await inside('[role="radiogroup"]', 'цвета')).toEqual([]);
    await page
      .getByRole('button', { name: /Цвет|Color/ })
      .first()
      .click();

    // Панель режима «Против ботов» целиком на экране; её содержимое листается внутри.
    await page.getByRole('button', { name: /Против ботов|Versus bots/ }).click();
    await page.waitForTimeout(600);
    expect(await inside('[role="group"]', 'панель режима')).toEqual([]);
    await context.close();
  });
}

test('@layout лобби открывается окном поверх меню без смены страницы', async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('hexfront.tutorialAsked', '1');
    localStorage.setItem('hexfront.nickname', 'Danil');
  });
  await page.routeWebSocket('ws://127.0.0.1:9999/**', (ws) => {
    ws.onMessage(() => {
      ws.send(
        JSON.stringify({
          t: 'welcome',
          playerId: 0,
          token: 'abc',
          room: 'K7QF',
          tickMs: 100,
          map: 'gen',
          seed: 42,
          players: 30,
          fog: true,
        }),
      );
      ws.send(
        JSON.stringify({
          t: 'lobby',
          info: { room: 'K7QF', humans: 7, max: 30, startsInS: 19, open: true },
          host: false,
        }),
      );
    });
  });
  await page.route('http://127.0.0.1:9999/healthz*', (route) =>
    route.fulfill({
      json: { ok: true, humans: 1234 },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.goto('/?server=ws://127.0.0.1:9999', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('status')).toContainText('1,2');
  await page.getByRole('button', { name: /Быстрый бой|Quick match/ }).click();
  const timer = page.getByRole('timer');
  await expect(timer).toContainText('19', { timeout: 10_000 });
  // Меню осталось на месте: фон, док и ник, а страница не перезагружалась.
  await expect(page.locator('main input')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  await page.getByRole('button', { name: /Отмена|Cancel/ }).click();
  await expect(timer).toHaveCount(0);
  await context.close();
});

test('@layout без сервера онлайн заблокирован, а быстрый бой открывает бой с ботами', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('hexfront.tutorialAsked', '1');
  });
  let alive = false;
  await page.route('http://127.0.0.1:9998/healthz*', (route) =>
    alive
      ? route.fulfill({
          json: { ok: true, humans: 842 },
          headers: { 'access-control-allow-origin': '*' },
        })
      : route.abort(),
  );
  await page.goto('/?server=ws://127.0.0.1:9998', { waitUntil: 'domcontentloaded' });
  const online = page.getByRole('button', { name: /Онлайн|Online/ });
  await expect(page.getByRole('status')).toContainText(/Офлайн|Offline/);
  await expect(online).toBeDisabled();
  // Быстрый бой без сервера — панель «Против ботов».
  await page.getByRole('button', { name: /Быстрый бой|Quick match/ }).click();
  await expect(page.getByRole('group', { name: /Против ботов|Versus bots/ })).toBeVisible();
  // Связь появилась: онлайн разблокируется сам, без перезагрузки.
  alive = true;
  await expect(page.getByRole('status')).toContainText('842', { timeout: 15_000 });
  await expect(online).toBeEnabled();
  await context.close();
});

test('@layout смена карты не двигает панель против ботов', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hexfront.tutorialAsked', '1');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Против ботов|Versus bots/ }).click();
  const panel = page.getByRole('group', { name: /Против ботов|Versus bots/ });
  const before = await panel.boundingBox();
  await page.getByRole('radio', { name: /Малая|Small/ }).click();
  const after = await panel.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(after?.y).toBe(before?.y);
});

test('@layout «Смотреть» по коду комнаты ведёт в матч зрителем', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('hexfront.tutorialAsked', '1');
    localStorage.setItem('hexfront.nickname', 'Danil');
    // Переходы экранов — pushState без загрузки страницы: запоминаем адреса.
    const seen: string[] = [];
    Object.assign(window, { seenUrls: seen });
    const push = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      seen.push(JSON.stringify(args[0]));
      push(...args);
    };
  });
  const hellos: Record<string, unknown>[] = [];
  await page.routeWebSocket('ws://127.0.0.1:9997/**', (ws) => {
    ws.onMessage((text) => {
      const message = JSON.parse(String(text)) as Record<string, unknown>;
      if (message.t !== 'hello') return;
      hellos.push(message);
      ws.send(
        JSON.stringify({
          t: 'welcome',
          playerId: 0,
          token: 'w-token',
          room: 'K7QF',
          tickMs: 100,
          map: 'small',
          seed: 42,
          players: 6,
          fog: true,
          spectator: true,
        }),
      );
      ws.send(JSON.stringify({ t: 'start', tick: 120 }));
    });
  });
  await page.route('http://127.0.0.1:9997/healthz*', (route) =>
    route.fulfill({
      json: { ok: true, humans: 5 },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.goto('/?server=ws://127.0.0.1:9997', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Онлайн|Online/ }).click();
  await page.getByRole('textbox', { name: /Войти по коду|Join by code/ }).fill('k7qf');
  await page.getByRole('button', { name: /Смотреть|Watch/ }).click();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          ((window as unknown as { seenUrls?: string[] }).seenUrls ?? []).some((url) =>
            /"pathname":"\/match","search":"[^"]*online=1[^"]*spectate=1/.test(url),
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(hellos[0]).toMatchObject({ room: 'K7QF', spectate: true });
  await context.close();
});
