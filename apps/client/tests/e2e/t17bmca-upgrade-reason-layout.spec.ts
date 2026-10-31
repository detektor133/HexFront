import { expect, test } from '@playwright/test';

const WIDTHS = [360, 1024, 1920] as const;

for (const width of WIDTHS) {
  test(`@layout 07/T17bmca: причина upgrade не перекрывает кнопку при ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dev/sandbox?map=small&seed=42&select=765');

    const card = page.locator('section[aria-label]').filter({
      has: page.getByRole('button', { name: /close hex card|закрыть карточку клетки/i }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator('h2')).toContainText(/city|capital|город|столица/i);

    const upgrade = card.getByRole('button', { name: /upgrade city|улучшить город/i });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toBeEnabled();

    // Песочница не задаёт правило недоступности upgrade, поэтому измеряется управляемый CSS-срез.
    const reasonId = await upgrade.evaluate((button) => {
      const reasonClass = Array.from(document.styleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .flatMap((rule) => (rule instanceof CSSStyleRule ? rule.selectorText.split(',') : []))
        .map((selector) => /\.(_?reason_[\w-]+)/u.exec(selector)?.[1])
        .find((className) => className !== undefined);
      const row = button.parentElement;
      if (!reasonClass || !row) throw new Error('Не найдены стили причины или строка upgrade');

      button.disabled = true;
      const reason = document.createElement('span');
      reason.id = 'upgrade-layout-reason';
      reason.className = reasonClass;
      reason.textContent = 'Not enough gold';
      button.setAttribute('aria-describedby', reason.id);
      row.append(reason);
      return reason.id;
    });
    await expect(upgrade).toBeDisabled();
    const reason = card.locator(`[id="${reasonId}"]`);
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/not enough gold|не хватает золота/i);

    const buttonBox = await upgrade.boundingBox();
    const reasonBox = await reason.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(reasonBox).not.toBeNull();
    if (!buttonBox || !reasonBox) throw new Error('Кнопка или причина не имеют границ');
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(reasonBox.y);
  });
}
