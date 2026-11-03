/** Группы управления 1–9 (07-controls.md): живут в клиенте, в sim не входят. */
export class ControlGroups {
  private readonly groups = new Map<number, readonly number[]>();
  private lastRecalled: number | null = null;
  private readonly listeners = new Set<() => void>();

  /** Запоминает отряды в группе; пустой набор группу не создаёт. */
  store(digit: number, unitIds: readonly number[]): void {
    if (unitIds.length === 0) return;
    this.groups.set(digit, [...unitIds]);
    this.lastRecalled = null;
    this.emit();
  }

  /**
   * Вызывает группу: живые отряды и признак «повтор подряд» (камера центрируется).
   * Погибшие отряды из группы исчезают; пустая группа удаляется.
   */
  recall(digit: number, alive: ReadonlySet<number>): { units: number[]; repeat: boolean } {
    const units = (this.groups.get(digit) ?? []).filter((id) => alive.has(id));
    if (units.length === 0) {
      if (this.groups.delete(digit)) this.emit();
      return { units, repeat: false };
    }
    this.groups.set(digit, units);
    const repeat = this.lastRecalled === digit;
    this.lastRecalled = digit;
    return { units, repeat };
  }

  /** Номера занятых групп по возрастанию; погибшие отряды не считаются. */
  occupied(alive: ReadonlySet<number>): number[] {
    return [...this.groups]
      .filter(([, ids]) => ids.some((id) => alive.has(id)))
      .map(([digit]) => digit)
      .sort((a, b) => a - b);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
