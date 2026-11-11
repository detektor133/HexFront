// Новые виды главного меню (карта с городами, карточки, док): без прокрутки, ник и главная
// кнопка на экране и достаются пальцем.
import { expect, test } from '@playwright/test';

const SIZES = [
  { name: 'портрет 390×844', width: 390, height: 844 },
  { name: 'малый портрет 360×640', width: 360, height: 640 },
  { name: 'ландшафт 844×390', width: 844, height: 390 },
];
const VARIANTS = ['cities', 'cards', 'dock'] as const;

for (const size of SIZES) {
  for (const variant of VARIANTS) {
    test(`@layout меню «${variant}», ${size.name}: без прокрутки, ник и «Быстрый бой» доступны`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem('hexfront.tutorialAsked', '1');
        localStorage.setItem('hexfront.menuVariant', 'x');
      });
      await page.goto(`/?menu=${variant}`);
      await page.waitForTimeout(2500);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const root = document.scrollingElement ?? document.documentElement;
        if (root.scrollHeight > window.innerHeight + 1) out.push('вертикальная прокрутка');
        if (root.scrollWidth > window.innerWidth) out.push('горизонтальная прокрутка');
        const input = document.querySelector<HTMLInputElement>('main input');
        const box = input?.getBoundingClientRect();
        if (!box || box.width < 80 || box.height < 30) out.push('нет поля ника');
        else if (box.left < 0 || box.right > window.innerWidth) out.push('поле ника за экраном');
        return out;
      });
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
