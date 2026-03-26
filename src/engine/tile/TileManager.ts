import { Tile, tileKey } from "./Tile";

type CachedTile = Tile & {
  inflight?: Promise<void>;
};

export class TileManager {
  private cache = new Map<string, CachedTile>();

  getTile(x: number, y: number, z: number): CachedTile {
    const key = tileKey(x, y, z);
    if (!this.cache.has(key)) {
      this.cache.set(key, { x, y, z, state: "idle" });
    }
    return this.cache.get(key)!;
  }

  hasTile(x: number, y: number, z: number): boolean {
    return this.cache.has(tileKey(x, y, z));
  }

  /**
   * 비동기 로더를 받아 타일을 로드한다.
   * 이미 loading 중이면 기존 inflight Promise를 반환한다.
   */
  load(
    x: number,
    y: number,
    z: number,
    loader: () => Promise<Partial<Omit<Tile, "x" | "y" | "z" | "state">>>,
  ): Promise<void> {
    const tile = this.getTile(x, y, z);

    if (tile.state === "loading" && tile.inflight) {
      return tile.inflight;
    }

    tile.state = "loading";
    tile.inflight = loader()
      .then((data) => {
        if (tile.state === "disposed") {
          (data as { mesh?: { dispose(): void } }).mesh?.dispose();
          return;
        }
        Object.assign(tile, data);
        tile.state = "ready";
      })
      .catch((e: unknown) => {
        tile.state = "error";
        throw e;
      })
      .finally(() => {
        tile.inflight = undefined;
      });

    return tile.inflight;
  }

  disposeTile(x: number, y: number, z: number): void {
    const key = tileKey(x, y, z);
    const tile = this.cache.get(key);
    if (!tile) return;

    tile.onDispose?.();
    tile.mesh?.dispose();
    tile.mesh = undefined;
    tile.state = "disposed";
    this.cache.delete(key);
  }

  getAllTiles(): CachedTile[] {
    return Array.from(this.cache.values());
  }
}
