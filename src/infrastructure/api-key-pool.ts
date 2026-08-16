export function parseCommaSeparatedKeys(value: string): string[] {
  return [...new Set(value.split(',').map((key) => key.trim()).filter(Boolean))];
}

export interface KeyCandidate {
  key: string;
  index: number;
  slot: number;
}

/**
 * In-process failover pool. It keeps the last successful key preferred while
 * still returning every key exactly once for a provider attempt. Keys are
 * never exposed by this API except to the provider that must authenticate.
 */
export class ApiKeyPool {
  private preferredIndex = 0;

  constructor(private readonly keys: readonly string[]) {}

  get size(): number {
    return this.keys.length;
  }

  candidates(): KeyCandidate[] {
    if (this.keys.length === 0) return [];
    return Array.from({ length: this.keys.length }, (_, offset) => {
      const index = (this.preferredIndex + offset) % this.keys.length;
      return { key: this.keys[index]!, index, slot: index + 1 };
    });
  }

  prefer(index: number): void {
    if (this.keys.length > 0) this.preferredIndex = index % this.keys.length;
  }

  advancePast(index: number): void {
    if (this.keys.length > 0 && this.preferredIndex === index) {
      this.preferredIndex = (index + 1) % this.keys.length;
    }
  }
}
