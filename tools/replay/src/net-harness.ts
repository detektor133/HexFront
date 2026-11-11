// Обвязка сетевых тестов на виртуальном времени: мир с очередью событий и канал в стиле TCP между
// настоящим клиентом (NetClient) и настоящим хабом сервера. Время не ждётся: тик матча стоит ровно
// столько, сколько работает процессор, а секунды игры пролетают мгновенно.
import type { NetClock, NetSocket } from '../../../apps/client/src/net/net-client.ts';
import type { Hub } from '../../../apps/server/src/hub.ts';

interface Item {
  at: number;
  id: number;
  run: () => void;
  live: { on: boolean };
}

/** Виртуальное время: очередь событий по моменту срабатывания (двоичная куча). */
export class World {
  public time = 1_000_000;
  private seq = 0;
  private readonly heap: Item[] = [];

  public readonly clock: NetClock = {
    now: () => this.time,
    setTimeout: (handler, ms) => this.after(ms, handler),
    clearTimeout: (handle) => {
      (handle as { on: boolean }).on = false;
    },
  };

  private less(a: Item, b: Item): boolean {
    return a.at < b.at || (a.at === b.at && a.id < b.id);
  }

  public after(ms: number, run: () => void): { on: boolean } {
    const live = { on: true };
    const item: Item = { at: this.time + ms, id: (this.seq += 1), run, live };
    const heap = this.heap;
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(item, heap[parent] as Item)) break;
      heap[i] = heap[parent] as Item;
      i = parent;
    }
    heap[i] = item;
    return live;
  }

  private pop(): Item | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined) return top;
    if (heap.length === 0) return top;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child =
        right < heap.length && this.less(heap[right] as Item, heap[left] as Item) ? right : left;
      if (!this.less(heap[child] as Item, last)) break;
      heap[i] = heap[child] as Item;
      i = child;
    }
    heap[i] = last;
    return top;
  }

  /** Прогоняет мир на `ms` миллисекунд вперёд. */
  public run(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = this.heap[0];
      if (next === undefined || next.at > end) break;
      const item = this.pop();
      if (!item) break;
      this.time = Math.max(this.time, item.at);
      if (item.live.on) item.run();
    }
    this.time = end;
  }
}

/** Канал в стиле TCP: порядок сохраняется, есть задержка, обрыв и «чёрная дыра». */
export class Link {
  public oneWayMs = 20;
  public jitterMs = 0;
  public connects = 0;
  private manual = false;
  private until = 0;
  private lastDown = 0;
  private lastUp = 0;
  private current: { cut: () => void; severServer: () => void } | null = null;

  public constructor(
    private readonly world: World,
    private readonly hub: Hub,
    private readonly random: () => number,
    private readonly ip = 'ip-1',
  ) {}

  /** Пакеты молча пропадают: пока длится `blackholeFor` или пока выставлено вручную. */
  public get blackhole(): boolean {
    return this.manual || this.world.time < this.until;
  }

  public set blackhole(value: boolean) {
    this.manual = value;
    if (!value) this.until = 0;
  }

  private delay(): number {
    return this.oneWayMs + Math.floor(this.random() * this.jitterMs);
  }

  public connect = (): NetSocket => {
    this.connects += 1;
    let open: () => void = () => undefined;
    let message: (text: string) => void = () => undefined;
    let close: () => void = () => undefined;
    let alive = true;
    const world = this.world;
    const session = this.hub.connect(
      {
        send: (text) => {
          if (!alive || this.blackhole) return;
          this.lastDown = Math.max(this.lastDown, world.time + this.delay());
          const at = this.lastDown;
          world.after(at - world.time, () => {
            if (alive) message(text);
          });
        },
        close: () => {
          if (!alive) return;
          this.lastDown = Math.max(this.lastDown, world.time + this.delay());
          world.after(this.lastDown - world.time, () => {
            if (alive) cut();
          });
        },
      },
      this.ip,
    );
    const cut = (): void => {
      if (!alive) return;
      alive = false;
      close();
      session?.onClose();
    };
    this.current = {
      cut,
      // Сервер замечает мёртвое соединение сам (ping по ws), клиент ещё ничего не знает.
      severServer: () => {
        session?.onClose();
      },
    };
    world.after(this.delay(), () => {
      if (alive) open();
    });
    return {
      send: (text) => {
        if (!alive || this.blackhole) return;
        this.lastUp = Math.max(this.lastUp, world.time + this.delay());
        world.after(this.lastUp - world.time, () => {
          if (alive) session?.onMessage(text);
        });
      },
      close: () => {
        alive = false;
        session?.onClose();
      },
      onOpen: (handler) => {
        open = handler;
      },
      onMessage: (handler) => {
        message = handler;
      },
      onClose: (handler) => {
        close = handler;
      },
    };
  };

  /** Обрыв соединения: обе стороны узнают сразу. */
  public drop(): void {
    this.current?.cut();
  }

  /**
   * «Чёрная дыра» на `ms`: пакеты молча пропадают. Если она длится дольше ws-пинга сервера (20 с),
   * сервер сам закрывает соединение, как `HEARTBEAT_MS` в `server.ts`.
   */
  public blackholeFor(ms: number): void {
    this.until = Math.max(this.until, this.world.time + ms);
    const current = this.current;
    if (ms > 20_000) {
      this.world.after(20_000, () => {
        if (this.current === current) current?.severServer();
      });
    }
  }
}
