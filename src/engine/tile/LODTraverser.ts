import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { Tile, tileKey } from "./Tile";
import { TileManager } from "./TileManager";
import { TerrainLoaderFn } from "./TerrainLoadQueue";
import {
  getTileBounds,
  getChildCoords,
  getParentCoord,
  worldToTileCoord,
  TileBounds,
} from "./TileCoords";
import { createDebugTileMesh } from "./DebugTileMesh";
import {
  MAX_LOD_LEVEL,
  GEO_ROOT_Z,
  DEBUG,
  SPLIT_THRESHOLD,
  MERGE_THRESHOLD,
} from "../constants";

export class LODTraverser {
  private prevVisibleKeys = new Set<string>();
  private loaderFn: TerrainLoaderFn;

  constructor(
    private tileManager: TileManager,
    private scene: Scene,
    tileLoader: (
      x: number,
      y: number,
      z: number,
    ) => Promise<Partial<Omit<Tile, "x" | "y" | "z" | "state">>>,
  ) {
    // debug fallback을 loaderFn 안에 래핑 — TerrainLoadQueue는 debug 메시 몰라도 됨
    this.loaderFn = async (x, y, z) => {
      try {
        return await tileLoader(x, y, z);
      } catch {
        if (!DEBUG) throw new Error(`Tile load failed: ${z}/${x}/${y}`);
        console.warn(`[Tile] No data for ${z}/${x}/${y}, using debug mesh`);
        const bounds = getTileBounds(x, y, z);
        const tile = tileManager.getTile(x, y, z);
        return { mesh: createDebugTileMesh(tile, bounds, scene) };
      }
    };
  }

  update(camera: ArcRotateCamera): void {
    const visibleKeys = new Set<string>();
    const desiredTiles = new Map<string, { x: number; y: number; z: number }>();

    // forward 벡터 한 번 계산 — traverse() 전달용
    const forward = camera.target.subtract(camera.position).normalize();

    const [cx, cy] = worldToTileCoord(
      camera.position.x,
      camera.position.z,
      GEO_ROOT_Z,
    );

    const tilesX = Math.pow(2, GEO_ROOT_Z + 1);
    const tilesY = Math.pow(2, GEO_ROOT_Z);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= tilesX || ny < 0 || ny >= tilesY) continue;
        this.traverse(nx, ny, GEO_ROOT_Z, camera, forward, visibleKeys);
      }
    }

    // visibleKeys → desiredTiles Map으로 변환
    for (const key of visibleKeys) {
      const [z, x, y] = key.split("/").map(Number);
      desiredTiles.set(key, { x, y, z });
    }

    this.tileManager.sync(desiredTiles, this.loaderFn);

    // sync() 이후 visibility 결정 — setEnabled의 유일한 호출자
    this.applyVisibility(visibleKeys);

    // 다음 프레임 hysteresis 판단용
    this.prevVisibleKeys = visibleKeys;
  }

  private traverse(
    x: number,
    y: number,
    z: number,
    camera: ArcRotateCamera,
    forward: Vector3,
    visibleKeys: Set<string>,
  ): void {
    const bounds = getTileBounds(x, y, z);
    const cameraPos = camera.position;

    // Frustum cull — 타일 크기의 1.5배보다 멀고 카메라 뒤쪽이면 skip
    const toTile = new Vector3(
      bounds.centerX - cameraPos.x,
      0,
      bounds.centerZ - cameraPos.z,
    );
    const dist = toTile.length();
    if (
      dist > bounds.size * 1.5 &&
      Vector3.Dot(toTile.normalizeToNew(), forward) < -0.3
    )
      return;

    const key = tileKey(x, y, z);
    const isCurrentlyVisible = this.prevVisibleKeys.has(key);

    if (
      z < MAX_LOD_LEVEL &&
      this.shouldSplit(bounds, camera, isCurrentlyVisible)
    ) {
      for (const [cx, cy, cz] of getChildCoords(x, y, z)) {
        this.traverse(cx, cy, cz, camera, forward, visibleKeys);
      }
    } else {
      visibleKeys.add(key);
    }
  }

  private shouldSplit(
    bounds: TileBounds,
    camera: ArcRotateCamera,
    isCurrentlyVisible: boolean,
  ): boolean {
    const cameraPos = camera.position;
    const forward = camera.target.subtract(cameraPos).normalize();

    const tileCenter = new Vector3(bounds.centerX, 0, bounds.centerZ);
    const toTile = tileCenter.subtract(cameraPos);

    const depth = Vector3.Dot(toTile, forward);
    const euclidean = toTile.length();
    const effectiveDepth = Math.max(depth, euclidean * 0.5, 1);

    const geometricError = bounds.size / 2;
    const screenH = this.scene.getEngine().getRenderHeight();
    const projFactor = screenH / (2 * Math.tan(camera.fov / 2));

    const screenError = (geometricError * projFactor) / effectiveDepth;

    // Hysteresis: 이미 leaf이면 SPLIT_THRESHOLD (높은 기준 → 쉽게 split 안 함, 안정화)
    // 이전에 split이었으면 MERGE_THRESHOLD (낮은 기준 → split 유지, 안정화)
    const threshold = isCurrentlyVisible ? SPLIT_THRESHOLD : MERGE_THRESHOLD;
    return screenError > threshold;
  }

  /**
   * 매 프레임 sync() 이후 호출. setEnabled의 유일한 호출자.
   * TileManager는 state·data·LRU만 담당하고, visibility 결정은 여기서만 한다.
   */
  private applyVisibility(visibleKeys: Set<string>): void {
    const activatedParents = new Set<string>();

    // Pass 1+2: visibleKeys 기준 enable/disable + parent fallback
    for (const key of visibleKeys) {
      const [z, x, y] = key.split("/").map(Number);
      const tile = this.tileManager.getTile(x, y, z);

      if (tile.state === "loading" || tile.state === "queued") {
        // child 아직 준비 안 됨 → parent fallback
        tile.mesh?.setEnabled(false);
        const parent = getParentCoord(x, y, z);
        if (parent) {
          const [px, py, pz] = parent;
          const parentKey = tileKey(px, py, pz);
          const parentTile = this.tileManager.getTile(px, py, pz);
          if (
            (parentTile.state === "ready" || parentTile.state === "cached") &&
            !activatedParents.has(parentKey)
          ) {
            parentTile.mesh?.setEnabled(true);
            activatedParents.add(parentKey);
          }
        }
      } else if (tile.state === "ready") {
        tile.mesh?.setEnabled(true);
      }
    }

    // Pass 3: non-visible cached 타일 비활성화 (ghost + stale 정리)
    for (const tile of this.tileManager.getAllTiles()) {
      if (tile.state === "cached" && tile.mesh?.isEnabled()) {
        if (!activatedParents.has(tileKey(tile.x, tile.y, tile.z))) {
          tile.mesh.setEnabled(false);
        }
      }
    }
  }
}
