import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { Tile, tileKey } from "./Tile";
import { getTileBounds } from "./TileCoords";

type QueueEntry = {
  key: string;
  x: number;
  y: number;
  z: number;
  enqueuedAt: number;
};

export type TerrainLoaderFn = (
  x: number,
  y: number,
  z: number,
) => Promise<Partial<Omit<Tile, "x" | "y" | "z" | "state">>>;

const MAX_QUEUE_SIZE = 100;
const MAX_CONCURRENT = 4;
const LEVEL_WEIGHT = 50;
// Starvation 방지: MAX_CONCURRENT번마다 1번은 대기 시간 기준으로 선택
const STARVATION_SLOT = MAX_CONCURRENT;

export class TerrainLoadQueue {
  /** TileManager.sync()에서 직접 접근 — 대기 중인 항목 제거용 */
  queue: QueueEntry[] = [];
  private running = 0;
  private isDraining = false;
  private dispatchCount = 0;

  constructor(
    private cameraPosProvider: () => Vector3,
    private getTile: (x: number, y: number, z: number) => Tile,
    private isDesired: (key: string) => boolean,
    private cacheTileFn: (x: number, y: number, z: number) => void,
  ) {}

  enqueue(x: number, y: number, z: number): void {
    const tile = this.getTile(x, y, z);
    // idle/error만 진입 허용 — queued/loading/ready/cached 완전 차단
    if (tile.state !== "idle" && tile.state !== "error") return;
    tile.state = "queued"; // push 전에 state 변경 (단일 소스)
    this.queue.push({ key: tileKey(x, y, z), x, y, z, enqueuedAt: Date.now() });
  }

  remove(key: string): void {
    // loading 중인 항목은 건드리지 않음 (soft ignore 대상)
    this.queue = this.queue.filter((e) => e.key !== key);
  }

  drain(loaderFn: TerrainLoaderFn): void {
    if (this.isDraining) return; // 재진입 차단
    this.isDraining = true;
    try {
      const cameraPos = this.cameraPosProvider();

      // MAX_QUEUE_SIZE 초과분 drop — reduce로 worst 탐색 (pop() 금지)
      while (this.queue.length > MAX_QUEUE_SIZE) {
        const worst = this.queue.reduce((a, b) =>
          this.calcPriority(a, cameraPos) > this.calcPriority(b, cameraPos) ? a : b,
        );
        this.remove(worst.key);
        const tile = this.getTile(worst.x, worst.y, worst.z);
        if (tile.state === "queued") tile.state = "idle";
      }

      // priority 재계산 후 정렬 (매 drain마다) — O(n log n)
      // MAX_QUEUE_SIZE=100 기준 문제 없음
      // TODO: queue size 증가 시 min-heap으로 전환 고려
      // TODO: priority 공식 튜닝 — dist/(1+z*0.3) 형태가 더 자연스러울 수 있음 (실측 후 결정)
      this.queue.sort(
        (a, b) => this.calcPriority(a, cameraPos) - this.calcPriority(b, cameraPos),
      );

      while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
        const entry = this.dequeue();
        // state 검증은 running++ 전에 — running 음수 방지, remove() race 방지
        const tile = this.getTile(entry.x, entry.y, entry.z);
        if (tile.state !== "queued") continue;

        this.running++;
        this.execute(entry, loaderFn);
      }
    } finally {
      this.isDraining = false;
    }
  }

  private calcPriority(entry: QueueEntry, cameraPos: Vector3): number {
    const bounds = getTileBounds(entry.x, entry.y, entry.z);
    const dx = bounds.centerX - cameraPos.x;
    const dz = bounds.centerZ - cameraPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // 가까울수록, z-level 높을수록 우선 처리 (낮을수록 먼저)
    return dist - entry.z * LEVEL_WEIGHT;
  }

  private dequeue(): QueueEntry {
    this.dispatchCount++;
    // Starvation 방지: STARVATION_SLOT번마다 1번은 가장 오래 대기한 항목 선택
    if (this.dispatchCount % STARVATION_SLOT === 0) {
      let oldestIdx = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].enqueuedAt < this.queue[oldestIdx].enqueuedAt) {
          oldestIdx = i;
        }
      }
      return this.queue.splice(oldestIdx, 1)[0];
    }
    return this.queue.shift()!;
  }

  private execute(entry: QueueEntry, loaderFn: TerrainLoaderFn): void {
    const { key, x, y, z } = entry;
    const tile = this.getTile(x, y, z);
    tile.state = "loading";
    console.log("[Tile] start loading", key);

    loaderFn(x, y, z)
      .then((data) => {
        // stale 체크 먼저 — ready로 바꾸기 전에 확인
        if (!this.isDesired(key)) {
          // mesh 즉시 dispose 대신 cached 보존 → LRU eviction 위임
          // 카메라 복귀 시 재fetch 없이 cache hit 가능
          Object.assign(tile, data);
          this.cacheTileFn(x, y, z);
          console.log("[Tile] discard (stale → cached)", key);
          return;
        }
        Object.assign(tile, data);
        tile.state = "ready";
        console.log("[Tile] ready", key);
      })
      .catch(() => {
        tile.state = "error";
      })
      .finally(() => {
        this.running--;
        // 즉시 재귀 호출 금지 — isDraining true 상태에서 drain()이 skip되는 race 방지
        // 현재 drain while 루프가 끝난 후 다음 microtask에서 실행
        Promise.resolve().then(() => this.drain(loaderFn));
      });
  }
}
