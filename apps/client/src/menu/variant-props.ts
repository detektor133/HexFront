import type { MenuSettings } from './menu-config.ts';
import type { MenuMapApi } from './use-menu-background.ts';

/** Что получает каждый вид меню от оболочки. `go` уже проверяет ник и включает полный экран. */
export interface VariantProps {
  readonly settings: MenuSettings;
  readonly update: (patch: Partial<MenuSettings>) => void;
  readonly go: (url: string) => void;
  readonly api: MenuMapApi | null;
}
