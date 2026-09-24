// Словари интерфейса (CONVENTIONS.md §1: тексты UI — только через i18n).

const ru = {
  'dev.map.title': 'Карта: отладка',
  'dev.map.radius': 'Радиус гекса',
  'dev.map.scale': 'Масштаб',
  'dev.map.detail': 'Детализация',
  'dev.map.fps': 'Кадров/с',
  'dev.map.loading': 'Загрузка карты…',
  'dev.map.error': 'Карта не загрузилась',
  'dev.notFound': 'Страница не найдена',
} as const;

export type MessageKey = keyof typeof ru;

const en: Record<MessageKey, string> = {
  'dev.map.title': 'Map: debug',
  'dev.map.radius': 'Hex radius',
  'dev.map.scale': 'Scale',
  'dev.map.detail': 'Detail',
  'dev.map.fps': 'FPS',
  'dev.map.loading': 'Loading map…',
  'dev.map.error': 'Map failed to load',
  'dev.notFound': 'Page not found',
};

const lang = typeof navigator !== 'undefined' && navigator.language.startsWith('ru') ? 'ru' : 'en';
const dict: Record<MessageKey, string> = lang === 'ru' ? ru : en;

/** Текст интерфейса по ключу на языке браузера (ru или en). */
export function t(key: MessageKey): string {
  return dict[key];
}
