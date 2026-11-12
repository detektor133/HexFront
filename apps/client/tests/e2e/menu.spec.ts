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
