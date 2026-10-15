export interface PauseControllerOptions {
  readonly worker: { postMessage(message: { readonly type: 'pause' | 'resume' }): void };
  readonly seed: number;
  readonly navigate: (path: string) => void;
  readonly restart: (seed: number) => void;
  readonly onStateChange?: (paused: boolean, menuOpen: boolean) => void;
}

export interface PauseController {
  pause(): void;
  resume(): void;
  restart(): void;
  goToMenu(): void;
  handleVisibilityChange(hidden: boolean): void;
  isPaused(): boolean;
  isMenuOpen(): boolean;
}

export function createPauseController(options: PauseControllerOptions): PauseController {
  let paused = false;
  let menuOpen = false;

  const publish = (): void => options.onStateChange?.(paused, menuOpen);
  const setPaused = (value: boolean): void => {
    paused = value;
    menuOpen = value;
    options.worker.postMessage({ type: value ? 'pause' : 'resume' });
    publish();
  };

  return {
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    restart: () => options.restart(options.seed),
    goToMenu: () => options.navigate('/'),
    handleVisibilityChange: (hidden) => {
      if (hidden) setPaused(true);
    },
    isPaused: () => paused,
    isMenuOpen: () => menuOpen,
  };
}
