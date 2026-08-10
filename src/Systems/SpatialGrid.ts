/**
 * SpatialGrid.ts — uniform grid hash for proximity queries.
 *
 * With ~200 animals plus players all asking "who is near me?" every tick, the
 * naive O(n²) sweep is what would actually melt the frame budget — not the
 * rendering. This keeps neighbour queries proportional to the number of
 * neighbours rather than the size of the world.
 *
 * Rebuilt from scratch each tick: cheaper and far less bug-prone than
 * incrementally moving entries between cells.
 */

export interface GridItem {
  id: number;
  pos: { x: number; z: number };
}

export class SpatialGrid<T extends GridItem> {
  private cells = new Map<number, T[]>();
  private readonly invCellSize: number;

  constructor(cellSize = 24) {
    this.invCellSize = 1 / cellSize;
  }

  /** Combine cell coordinates into one map key. */
  private key(cx: number, cz: number): number {
    // 16-bit signed halves; the world is far smaller than that range.
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  clear(): void {
    // Reuse the arrays instead of reallocating: this runs every tick.
    for (const list of this.cells.values()) list.length = 0;
  }

  insert(item: T): void {
    const cx = Math.floor(item.pos.x * this.invCellSize);
    const cz = Math.floor(item.pos.z * this.invCellSize);
    const k = this.key(cx, cz);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(item);
  }

  /** Rebuild the whole grid from a collection. */
  rebuild(items: Iterable<T>): void {
    this.clear();
    for (const item of items) this.insert(item);
  }

  /**
   * Visit every item within `radius` of (x, z). The callback may be invoked for
   * items slightly outside the radius on the cell boundary, so callers that
   * need an exact circle should re-check the distance.
   */
  forEachInRadius(x: number, z: number, radius: number, fn: (item: T) => void): void {
    const minX = Math.floor((x - radius) * this.invCellSize);
    const maxX = Math.floor((x + radius) * this.invCellSize);
    const minZ = Math.floor((z - radius) * this.invCellSize);
    const maxZ = Math.floor((z + radius) * this.invCellSize);
    const r2 = radius * radius;

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const dx = item.pos.x - x;
          const dz = item.pos.z - z;
          if (dx * dx + dz * dz <= r2) fn(item);
        }
      }
    }
  }

  /** Nearest item satisfying an optional filter, or null. */
  findNearest(
    x: number,
    z: number,
    radius: number,
    filter?: (item: T) => boolean,
  ): T | null {
    let best: T | null = null;
    let bestDist = Infinity;
    this.forEachInRadius(x, z, radius, (item) => {
      if (filter && !filter(item)) return;
      const dx = item.pos.x - x;
      const dz = item.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    });
    return best;
  }

  /** Number of occupied cells — useful when profiling. */
  get cellCount(): number {
    let n = 0;
    for (const list of this.cells.values()) if (list.length > 0) n++;
    return n;
  }
}
