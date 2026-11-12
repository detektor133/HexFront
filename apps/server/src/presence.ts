// Сколько людей сейчас «в сети»: те, у кого открыто меню (оно опрашивает `/healthz`), и те, у кого
// открыт сокет игры. Считаем различные адреса в памяти, ничего не пишем на диск.

/** Меню опрашивает раз в 15 с; адрес считается «в сети», пока с последнего опроса не прошло это. */
export const VISITOR_TTL_MS = 40_000;

export class Presence {
  private readonly seen = new Map<string, number>();
  private readonly sockets = new Map<string, number>();

  /** Меню игры спросило `/healthz`. */
  public visit(ip: string, now: number): void {
    this.seen.set(ip, now);
  }

  public socketOpened(ip: string): void {
    this.sockets.set(ip, (this.sockets.get(ip) ?? 0) + 1);
  }

  public socketClosed(ip: string): void {
    const left = (this.sockets.get(ip) ?? 0) - 1;
    if (left > 0) this.sockets.set(ip, left);
    else this.sockets.delete(ip);
  }

  /** Различные адреса: недавние посетители меню и владельцы открытых сокетов. */
  public count(now: number): number {
    for (const [ip, at] of this.seen) {
      if (now - at > VISITOR_TTL_MS) this.seen.delete(ip);
    }
    const all = new Set<string>(this.seen.keys());
    for (const ip of this.sockets.keys()) all.add(ip);
    return all.size;
  }
}
