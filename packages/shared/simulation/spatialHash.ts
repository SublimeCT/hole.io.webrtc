import type { Vector2 } from "./types";

export class SpatialHash {
  readonly #cellSize: number;
  readonly #cells = new Map<string, string[]>();

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
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        const cell = this.#cells.get(`${cellX}:${cellY}`);
        if (cell) {
          results.push(...cell);
        }
      }
    }

    return results;
  }

  #key(x: number, y: number): string {
    return `${Math.floor(x / this.#cellSize)}:${Math.floor(y / this.#cellSize)}`;
  }
}
