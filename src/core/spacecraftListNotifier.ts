export class SpacecraftListNotifier {
  private version = 0;
  private versionListener: ((version: number) => void) | null = null;
  private readonly subscribers = new Set<() => void>();

  public setVersionListener(callback: ((version: number) => void) | null): void {
    this.versionListener = callback;
  }

  public subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public emit(): number {
    this.version += 1;

    try {
      this.versionListener?.(this.version);
    } catch {}

    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber();
      } catch {}
    }

    return this.version;
  }
}
