import { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

import {
  getSatelliteTileRange,
  latToMercatorYFrac,
  terrainTileBounds,
} from "./SatelliteProjection";
import { SAT_Z_MIN, SAT_Z_MAX, SAT_TILE_PIXEL_SIZE, DEBUG } from "../constants";

export class SatelliteTextureBuilder {
  private readonly blobCache = new Map<string, Promise<Blob>>();

  constructor(
    private readonly scene: Scene,
    private readonly satBaseUrl: string,
  ) {}

  /** terrain tile → DynamicTexture (null=전체 실패 시 fallback 유지) */
  async buildCompositeTexture(
    x: number,
    y: number,
    z: number,
  ): Promise<DynamicTexture | null> {
    const satZ = Math.max(SAT_Z_MIN, Math.min(SAT_Z_MAX, z));
    const { xMin, xMax, yMin, yMax } = getSatelliteTileRange(z, x, y, satZ);

    const cols = xMax - xMin + 1;
    const rows = yMax - yMin + 1;
    const W = cols * SAT_TILE_PIXEL_SIZE;
    const H = rows * SAT_TILE_PIXEL_SIZE;

    const fetches: Promise<{
      sx: number;
      sy: number;
      bmp: ImageBitmap | null;
    }>[] = [];
    for (let sy = yMin; sy <= yMax; sy++) {
      for (let sx = xMin; sx <= xMax; sx++) {
        fetches.push(
          this.fetchSatTile(sx, sy, satZ)
            .then((bmp) => ({ sx, sy, bmp }))
            .catch(() => ({ sx, sy, bmp: null })),
        );
      }
    }
    const results = await Promise.all(fetches);
    if (results.every((r) => r.bmp === null)) return null;

    // OffscreenCanvas 합성: Y=0=top=north (XYZ 규약과 일치)
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d")!;
    for (const { sx, sy, bmp } of results) {
      if (!bmp) continue;
      const dx = (sx - xMin) * SAT_TILE_PIXEL_SIZE;
      const dy = (sy - yMin) * SAT_TILE_PIXEL_SIZE;
      ctx.drawImage(bmp, dx, dy, SAT_TILE_PIXEL_SIZE, SAT_TILE_PIXEL_SIZE);
      bmp.close();

      if (DEBUG) {
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.strokeRect(dx, dy, SAT_TILE_PIXEL_SIZE, SAT_TILE_PIXEL_SIZE);
        ctx.fillStyle = "red";
        ctx.font = `bold ${SAT_TILE_PIXEL_SIZE / 8}px monospace`;
        ctx.fillText(`${sx},${sy}`, dx + 6, dy + SAT_TILE_PIXEL_SIZE / 8 + 6);
      }
    }

    // terrain tile의 지리적 경계에 맞게 crop — UV u[i]/v[i]와 텍스처 경계를 일치시킴
    const { lonMin, lonMax, latMin, latMax } = terrainTileBounds(z, x, y);
    const nSat = Math.pow(2, satZ);
    const cropX0 = ((lonMin + 180) / 360 * nSat - xMin) * SAT_TILE_PIXEL_SIZE;
    const cropX1 = ((lonMax + 180) / 360 * nSat - xMin) * SAT_TILE_PIXEL_SIZE;
    const cropY0 = (latToMercatorYFrac(latMax, nSat) - yMin) * SAT_TILE_PIXEL_SIZE; // north
    const cropY1 = (latToMercatorYFrac(latMin, nSat) - yMin) * SAT_TILE_PIXEL_SIZE; // south
    const cropW = Math.max(1, Math.round(cropX1 - cropX0));
    const cropH = Math.max(1, Math.round(cropY1 - cropY0));

    const tex = new DynamicTexture(
      `sat_${z}/${x}/${y}`,
      { width: cropW, height: cropH },
      this.scene,
    );
    tex.getContext().drawImage(canvas, -cropX0, -cropY0);
    tex.update();
    return tex;
  }

  private fetchSatTile(
    sx: number,
    sy: number,
    satZ: number,
  ): Promise<ImageBitmap> {
    const url = `${this.satBaseUrl}/maps-satellite/${satZ}/${sx}/${sy}.jpg`;
    if (!this.blobCache.has(url)) {
      const p = fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status}`);
          return res.blob();
        });
      this.blobCache.set(url, p);
    }
    return this.blobCache.get(url)!.then((blob) => createImageBitmap(blob));
  }
}
