import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { Tile, tileKey } from "./Tile";
import { TileManager } from "./TileManager";
import { getTileBounds, getChildCoords, TileBounds } from "./TileCoords";
import { createDebugTileMesh, disposeDebugTileMesh } from "./DebugTileMesh";
import { MAX_LOD_LEVEL } from "../constants";

const PIXEL_THRESHOLD = 150;

type TileLoaderFn = (
  x: number,
  y: number,
  z: number,
) => Promise<Partial<Pick<Tile, "dem" | "texture" | "mesh">>>;

export class LODTraverser {
  constructor(
    private tileManager: TileManager,
    private scene: Scene,
    private tileLoader: TileLoaderFn,
  ) {}

  update(camera: ArcRotateCamera): void {
    const visibleKeys = new Set<string>();
    this.traverse(0, 0, 0, camera, visibleKeys);
    this.syncTiles(visibleKeys);
  }

  private traverse(
    x: number,
    y: number,
    z: number,
    camera: ArcRotateCamera,
    visibleKeys: Set<string>,
  ): void {
    const bounds = getTileBounds(x, y, z);

    if (z < MAX_LOD_LEVEL && this.shouldSplit(bounds, camera)) {
      for (const [cx, cy, cz] of getChildCoords(x, y, z)) {
        this.traverse(cx, cy, cz, camera, visibleKeys);
      }
    } else {
      visibleKeys.add(tileKey(x, y, z));
    }
  }

  private shouldSplit(bounds: TileBounds, camera: ArcRotateCamera): boolean {
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

    return screenError > PIXEL_THRESHOLD;
  }

  private syncTiles(visibleKeys: Set<string>): void {
    // 더 이상 필요 없는 타일 제거
    for (const tile of this.tileManager.getAllTiles()) {
      if (!visibleKeys.has(tileKey(tile.x, tile.y, tile.z))) {
        disposeDebugTileMesh(tile);
        this.tileManager.disposeTile(tile.x, tile.y, tile.z);
      }
    }

    // 새로 필요한 타일 생성
    for (const key of visibleKeys) {
      const [z, x, y] = key.split("/").map(Number);
      if (!this.tileManager.hasTile(x, y, z)) {
        const bounds = getTileBounds(x, y, z);
        this.tileManager
          .load(x, y, z, () => this.tileLoader(x, y, z))
          .catch(() => {
            // 로드 실패 → 디버그 메시 폴백
            const tile = this.tileManager.getTile(x, y, z);
            tile.mesh = createDebugTileMesh(tile, bounds, this.scene);
            tile.state = "ready";
          });
      }
    }
  }
}
