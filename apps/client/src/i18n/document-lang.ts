import { lang } from './dict.ts';

/**
 * Атрибут `lang` корня документа — язык интерфейса `i18n`, выбранный при запуске.
 * Корня нет у подменного `document` тестов оболочки, которые только рендерят приложение.
 */
export function applyDocumentLang(root: HTMLElement | undefined): void {
  if (root) root.lang = lang;
}
