// Словари интерфейса (CONVENTIONS.md §1: тексты UI — только через i18n).

const ru = {
  'dev.map.title': 'Карта: отладка',
  'dev.map.scale': 'Масштаб',
  'dev.map.detail': 'Детализация',
  'dev.map.fps': 'Кадров/с',
  'dev.map.loading': 'Загрузка карты…',
  'dev.map.error': 'Карта не загрузилась',
  'dev.map.territories': 'Территории',
  'dev.map.on': 'вкл',
  'dev.map.off': 'выкл',
  'terrain.water': 'Вода',
  'terrain.plains': 'Равнина',
  'terrain.forest': 'Лес',
  'terrain.hills': 'Холмы',
  'terrain.mountains': 'Горы',
  'terrain.desert': 'Пустыня, степь',
  'dev.notFound': 'Страница не найдена',
} as const;

export type MessageKey = keyof typeof ru;

const en: Record<MessageKey, string> = {
  'dev.map.title': 'Map: debug',
  'dev.map.scale': 'Scale',
  'dev.map.detail': 'Detail',
  'dev.map.fps': 'FPS',
  'dev.map.loading': 'Loading map…',
  'dev.map.error': 'Map failed to load',
  'dev.map.territories': 'Territories',
  'dev.map.on': 'on',
  'dev.map.off': 'off',
  'terrain.water': 'Water',
  'terrain.plains': 'Plains',
  'terrain.forest': 'Forest',
  'terrain.hills': 'Hills',
  'terrain.mountains': 'Mountains',
  'terrain.desert': 'Desert, steppe',
  'dev.notFound': 'Page not found',
};

const lang = typeof navigator !== 'undefined' && navigator.language.startsWith('ru') ? 'ru' : 'en';
const dict: Record<MessageKey, string> = lang === 'ru' ? ru : en;

/** Текст интерфейса по ключу на языке браузера (ru или en). */
export function t(key: MessageKey): string {
  return dict[key];
}
