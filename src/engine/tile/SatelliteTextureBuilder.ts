import { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

import {
  getSatelliteTileRange,
  latToMercatorYFrac,
  terrainTileBounds,
} from "./SatelliteProjection";
import {
  SAT_Z_MIN,
  SAT_Z_MAX,
  SAT_Z_OFFSET,
  SAT_TILE_PIXEL_SIZE,
  DEBUG,
} from "../constants";
import { TileFetchQueue } from "./TileFetchQueue";

const MAX_BLOB_CACHE = 300;
const MAX_COMPOSITE_CACHE = 100;

export class SatelliteTextureBuilder {
  private readonly blobCache = new Map<string, Promise<Blob>>();
  /** 합성 완료된 불변 이미지 (crop 적용됨) — lifecycle 간 공유 안전 */
  private readonly compositeCache = new Map<string, ImageBitmap>();
  /** 진행 중인 합성 작업 dedup — 완료 즉시 제거 */
  private readonly inflightCache = new Map<
    string,
    Promise<ImageBitmap | null>
  >();
  /** 진행 중인 합성의 AbortController — cancelComposite 시 취소 */
  private readonly inflightControllers = new Map<string, AbortController>();
  private readonly fetchQueue = new TileFetchQueue(6);

  constructor(
    private readonly scene: Scene,
    private readonly satBaseUrl: string,
  ) {}

  /** terrain tile → DynamicTexture (null=전체 실패 시 fallback 유지)
   *  onPartial: 첫 번째 sat 타일 도착 시 partial texture 콜백 (crop 없음, UV 약간 틀어짐)
   *  최종 결과는 Promise로 반환 (crop 적용된 정확한 texture)
   */
  async buildCompositeTexture(
    x: number,
    y: number,
    z: number,
    onPartial?: (tex: DynamicTexture) => void,
  ): Promise<DynamicTexture | null> {
    const bitmap = await this._getOrBuildComposite(x, y, z, onPartial);
    if (!bitmap) return null;

    const tex = new DynamicTexture(
      `sat_${z}/${x}/${y}`,
      { width: bitmap.width, height: bitmap.height },
      this.scene,
    );
    tex.getContext().drawImage(bitmap, 0, 0);
    tex.update();
    return tex;
  }

  /** inflight 취소만 — compositeCache는 유지 (재방문 시 재사용, LRU가 메모리 관리) */
  cancelComposite(x: number, y: number, z: number): void {
    const key = `${z}/${x}/${y}`;
    this.inflightControllers.get(key)?.abort();
  }

  /** tile dispose 시 명시적 메모리 해제 (LRU eviction으로도 처리됨) */
  disposeTexture(x: number, y: number, z: number): void {
    const key = `${z}/${x}/${y}`;
    this.compositeCache.get(key)?.close();
    this.compositeCache.delete(key);
  }

  /** compositeCache 조회 → inflightCache dedup → 신규 빌드 순서로 처리 */
  private _getOrBuildComposite(
    x: number,
    y: number,
    z: number,
    onPartial?: (tex: DynamicTexture) => void,
  ): Promise<ImageBitmap | null> {
    const key = `${z}/${x}/${y}`;

    if (this.compositeCache.has(key)) {
      return Promise.resolve(this.compositeCache.get(key)!);
    }

    if (!this.inflightCache.has(key)) {
      const controller = new AbortController();
      this.inflightControllers.set(key, controller);

      const p = this._buildComposite(x, y, z, controller.signal, onPartial)
        .then((bitmap) => {
          this.inflightCache.delete(key);
          this.inflightControllers.delete(key);
          if (bitmap) {
            this.compositeCache.set(key, bitmap);
            this._evictCompositeCache();
          }
          return bitmap;
        })
        .catch(() => {
          this.inflightCache.delete(key);
          this.inflightControllers.delete(key);
          return null;
        });
      this.inflightCache.set(key, p);
    }

    return this.inflightCache.get(key)!;
  }

  /** 위성 타일 fetch + OffscreenCanvas 합성 → crop된 ImageBitmap 반환
   *  onPartial: 첫 번째 타일 도착 시 1회 호출 (crop 없는 partial bitmap)
   */
  private async _buildComposite(
    x: number,
    y: number,
    z: number,
    signal: AbortSignal,
    onPartial?: (tex: DynamicTexture) => void,
  ): Promise<ImageBitmap | null> {
    const satZ = Math.max(SAT_Z_MIN, Math.min(SAT_Z_MAX, z + SAT_Z_OFFSET));
    const { xMin, xMax, yMin, yMax } = getSatelliteTileRange(z, x, y, satZ);

    const cols = xMax - xMin + 1;
    const rows = yMax - yMin + 1;
    const W = cols * SAT_TILE_PIXEL_SIZE;
    const H = rows * SAT_TILE_PIXEL_SIZE;

    // OffscreenCanvas 합성: Y=0=top=north (XYZ 규약과 일치)
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d")!;

    let anySuccess = false;
    let partialSent = false; // partial은 최초 1회만 — GPU texture churn 방지

    const tilePromises: Promise<void>[] = [];

    for (let sy = yMin; sy <= yMax; sy++) {
      for (let sx = xMin; sx <= xMax; sx++) {
        const p = this._fetchSatTile(sx, sy, satZ, signal)
          .then((bmp) => {
            if (signal.aborted) {
              bmp.close();
              return;
            }

            const dx = (sx - xMin) * SAT_TILE_PIXEL_SIZE;
            const dy = (sy - yMin) * SAT_TILE_PIXEL_SIZE;
            ctx.drawImage(
              bmp,
              dx,
              dy,
              SAT_TILE_PIXEL_SIZE,
              SAT_TILE_PIXEL_SIZE,
            );
            bmp.close();
            anySuccess = true;

            if (DEBUG) {
              ctx.strokeStyle = "red";
              ctx.lineWidth = 3;
              ctx.strokeRect(dx, dy, SAT_TILE_PIXEL_SIZE, SAT_TILE_PIXEL_SIZE);
              const fontSize = SAT_TILE_PIXEL_SIZE / 12;
              ctx.font = `bold ${fontSize}px monospace`;

              ctx.fillStyle = "coral";
              // ctx.fillText(
              //   `Sat:${satZ}/${sx},${sy}`,
              //   dx + 6,
              //   dy + SAT_TILE_PIXEL_SIZE / 8 + 6,
              // );
              const lines = ["[Sat]", `${satZ}/${sx}/${sy}`];
              lines.forEach((line, i) => {
                ctx.fillText(
                  line,
                  dx + 6,
                  dy +
                    SAT_TILE_PIXEL_SIZE / 8 +
                    16 -
                    fontSize +
                    i * (fontSize * 1.2),
                );
              });
            }

            // partial은 첫 번째 타일 도착 시 1회만 전송
            if (!partialSent && onPartial) {
              partialSent = true;
              createImageBitmap(canvas).then((partial) => {
                if (signal.aborted) {
                  partial.close();
                  return;
                }
                const tex = new DynamicTexture(
                  `sat_partial_${z}/${x}/${y}`,
                  { width: partial.width, height: partial.height },
                  this.scene,
                );
                tex.getContext().drawImage(partial, 0, 0);
                tex.update();
                partial.close();
                onPartial(tex);
              });
            }
          })
          .catch(() => {
            /* 개별 타일 실패 무시 */
          });

        tilePromises.push(p);
      }
    }

    await Promise.all(tilePromises);
    if (!anySuccess || signal.aborted) return null;

    return this._cropCanvas(canvas, x, y, z, satZ, xMin, yMin);
  }

  /** 합성 canvas를 terrain tile 지리 경계에 맞게 crop → ImageBitmap 반환 */
  private async _cropCanvas(
    canvas: OffscreenCanvas,
    x: number,
    y: number,
    z: number,
    satZ: number,
    xMin: number,
    yMin: number,
  ): Promise<ImageBitmap> {
    const { lonMin, lonMax, latMin, latMax } = terrainTileBounds(z, x, y);
    const nSat = Math.pow(2, satZ);
    const cropX0 = (((lonMin + 180) / 360) * nSat - xMin) * SAT_TILE_PIXEL_SIZE;
    const cropX1 = (((lonMax + 180) / 360) * nSat - xMin) * SAT_TILE_PIXEL_SIZE;
    const cropY0 =
      (latToMercatorYFrac(latMax, nSat) - yMin) * SAT_TILE_PIXEL_SIZE; // north
    const cropY1 =
      (latToMercatorYFrac(latMin, nSat) - yMin) * SAT_TILE_PIXEL_SIZE; // south
    const cropW = Math.max(1, Math.round(cropX1 - cropX0));
    const cropH = Math.max(1, Math.round(cropY1 - cropY0));

    const cropCanvas = new OffscreenCanvas(cropW, cropH);
    const ctx2d = cropCanvas.getContext("2d")!;
    ctx2d.drawImage(canvas, -cropX0, -cropY0);

    if (DEBUG) {
      const fontSize = Math.max(12, cropW / 12);
      ctx2d.font = `bold ${fontSize}px monospace`;
      ctx2d.fillStyle = "rgba(30,200,60,0.7)";
      ctx2d.textAlign = "center";
      const lines = ["[Terr]", `z: ${z}`, `x: ${x}`, `y: ${y}`];
      const totalH = lines.length * fontSize * 1.2;
      lines.forEach((line, i) => {
        ctx2d.fillText(
          line,
          cropW / 2,
          cropH / 2 - totalH / 2 + i * fontSize * 1.2,
        );
      });
    }

    return createImageBitmap(cropCanvas);
  }

  private _fetchSatTile(
    sx: number,
    sy: number,
    satZ: number,
    signal?: AbortSignal,
  ): Promise<ImageBitmap> {
    const url = `${this.satBaseUrl}/maps-satellite/${satZ}/${sx}/${sy}.jpg`;
    // blobCache는 signal 없이 — 다른 composite와 공유하는 캐시이므로 abort 오염 방지
    if (!this.blobCache.has(url)) {
      const p = this.fetchQueue.fetch(url).then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      });
      this.blobCache.set(url, p);
      this.evictBlobCache();
    }
    return this.blobCache.get(url)!.then((blob) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return createImageBitmap(blob);
    });
  }

  private evictBlobCache(): void {
    while (this.blobCache.size > MAX_BLOB_CACHE) {
      const oldest = this.blobCache.keys().next().value!;
      this.blobCache.delete(oldest);
    }
  }

  private _evictCompositeCache(): void {
    while (this.compositeCache.size > MAX_COMPOSITE_CACHE) {
      const oldest = this.compositeCache.keys().next().value!;
      this.compositeCache.get(oldest)?.close();
      this.compositeCache.delete(oldest);
    }
  }
}
