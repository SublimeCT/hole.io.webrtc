import type { Vector2 } from "./types";

/**
 * 网格空间哈希。原本用 `${fx}:${fy}` 字符串作 key，每步 695 次 insert + 若干 query 都要分配字符串；
 * 改成数值 key（fx * 100000 + fy），零字符串分配。地图坐标有限（fy ∈ 约 [-15,15]），100000 间距无碰撞。
 */
export class SpatialHash {
  readonly #cellSize: number;
  readonly #cells = new Map<number, string[]>();

  constructor(cellSize: number) {
    if (cellSize <= 0) {
      throw new Error("Spatial hash cell size must be positive");
    }
    this.#cellSize = cellSize;
  }

  insert(id: string, position: Vector2): void {
    const key = this.#key(position.x, position.y);
    const cell = this.#cells.get(key);
    if (cell) {
      cell.push(id);
      return;
    }
    this.#cells.set(key, [id]);
  }

  query(position: Vector2, radius: number): readonly string[] {
    const minX = Math.floor((position.x - radius) / this.#cellSize);
    const maxX = Math.floor((position.x + radius) / this.#cellSize);
    const minY = Math.floor((position.y - radius) / this.#cellSize);
    const maxY = Math.floor((position.y + radius) / this.#cellSize);
    const results: string[] = [];

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const cellXKey = cellX * 100000;
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        const cell = this.#cells.get(cellXKey + cellY);
        if (cell) {
          results.push(...cell);
        }
      }
    }

    return results;
  }

  #key(x: number, y: number): number {
    return Math.floor(x / this.#cellSize) * 100000 + Math.floor(y / this.#cellSize);
  }
}
