import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { Tile, tileKey } from "./Tile";
import { TileLoadQueue, TileLoaderFn } from "./TileLoadQueue";

const CACHE_LIMIT = 64;

type CachedTile = Tile;

export class TileManager {
  private cache = new Map<string, CachedTile>();
  /** LRU 순서 — 앞이 오래된 항목 */
  private lruOrder: string[] = [];
  private currentDesiredTiles = new Map<
    string,
    { x: number; y: number; z: number }
  >();
  private loadQueue: TileLoadQueue;

  constructor(cameraPosProvider: () => Vector3) {
    this.loadQueue = new TileLoadQueue(
      cameraPosProvider,
      (x, y, z) => this.getTile(x, y, z),
      (key) => this.isDesired(key),
      (x, y, z) => this.cacheTile(x, y, z),
    );
  }

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

  getAllTiles(): CachedTile[] {
    return Array.from(this.cache.values());
  }

  isDesired(key: string): boolean {
    return this.currentDesiredTiles.has(key);
  }

  /**
   * 타일을 캐시 상태로 전환한다. mesh는 유지하되 GPU 렌더링에서 제외한다.
   * LRU 한도 초과 시 가장 오래된 항목을 실제 dispose한다.
   */
  cacheTile(x: number, y: number, z: number): void {
    const key = tileKey(x, y, z);
    const tile = this.cache.get(key);
    if (!tile) return;

    tile.state = "cached";
    tile.lastUsed = Date.now();
    // setEnabled 제거 — visibility는 LODTraverser.applyVisibility()가 단독 담당

    // filter-before-push — 중복 key 방지 (eviction 시 동일 key 중복 dispose 차단)
    this.lruOrder = this.lruOrder.filter((k) => k !== key);
    this.lruOrder.push(key);

    if (this.lruOrder.length > CACHE_LIMIT) {
      this._evict();
    }
  }

  /**
   * cached 타일을 ready 상태로 복원한다. mesh를 다시 활성화한다.
   */
  readyTile(x: number, y: number, z: number): void {
    const key = tileKey(x, y, z);
    const tile = this.cache.get(key);
    if (!tile) return;

    tile.state = "ready";
    // setEnabled 제거 — visibility는 LODTraverser.applyVisibility()가 단독 담당

    this.lruOrder = this.lruOrder.filter((k) => k !== key);
    this.lruOrder.push(key);
  }

  private _evict(): void {
    const key = this.lruOrder.shift();
    if (!key) return;
    const tile = this.cache.get(key);
    if (!tile) return;

    tile.onDispose?.();
    tile.mesh?.dispose();
    tile.mesh = undefined;
    tile.state = "disposed";
    this.cache.delete(key);
  }

  /**
   * 매 프레임 LODTraverser에서 호출한다.
   * desiredTiles 기준으로 로드 큐를 동기화하고 drain한다.
   */
  sync(
    desiredTiles: Map<string, { x: number; y: number; z: number }>,
    loaderFn: TileLoaderFn,
  ): void {
    this.currentDesiredTiles = desiredTiles;

    // 1. desired 타일 처리 — cache hit은 queue 완전 우회
    for (const [key, coord] of desiredTiles) {
      const tile = this.getTile(coord.x, coord.y, coord.z);
      if (tile.state === "ready") continue;
      if (tile.state === "cached") {
        // cached → visible 복귀: state="ready", setEnabled(true)
        this.readyTile(coord.x, coord.y, coord.z);
        continue;
      }
      if (tile.state === "loading" || tile.state === "queued") continue;
      // idle/error → enqueue
      this.loadQueue.enqueue(coord.x, coord.y, coord.z);
      console.log("[Tile] enqueue", key);
    }

    // 2. desired에서 제외된 queued 항목 제거 (state → idle)
    for (const entry of [...this.loadQueue.queue]) {
      if (!desiredTiles.has(entry.key)) {
        this.loadQueue.remove(entry.key);
        const tile = this.getTile(entry.x, entry.y, entry.z);
        if (tile.state === "queued") tile.state = "idle";
      }
    }

    // 3. desired에서 제외된 ready 타일 → cache 이동
    //    loading 타일은 그대로 — 완료 시 isDesired() soft ignore로 정리
    for (const tile of this.getAllTiles()) {
      if (
        !desiredTiles.has(tileKey(tile.x, tile.y, tile.z)) &&
        tile.state === "ready"
      ) {
        this.cacheTile(tile.x, tile.y, tile.z);
      }
    }

    // 4. drain (cameraPos는 TileLoadQueue 내부에서 cameraPosProvider()로 최신값 획득)
    this.loadQueue.drain(loaderFn);
  }
}
