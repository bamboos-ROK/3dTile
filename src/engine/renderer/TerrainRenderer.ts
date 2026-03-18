import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { BoundingBox } from '@babylonjs/core/Culling/boundingBox';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import type { Scene } from '@babylonjs/core/scene';
import type { TileCoord } from '../terrain/TerrainTile';
import { tileKey, parseTileKey } from '../terrain/TerrainTile';
import type { TerrainTileManager } from '../terrain/TerrainTileManager';
import type { LODSelector } from '../lod/LODSelector';
import type { TilingScheme } from '../tiling/TilingScheme';
import type { CameraController } from '../camera/CameraController';
import { HEIGHT_SCALE } from '../constants';
import type { CoarserBorders } from '../terrain/TerrainTile';

/**
 * 매 프레임 Quadtree Traversal을 수행하여
 * 필요한 타일을 생성/유지하고 불필요한 타일을 제거한다.
 */
export class TerrainRenderer {
  private readonly scene: Scene;
  private readonly tiling: TilingScheme;
  private readonly lodSelector: LODSelector;
  private readonly tileManager: TerrainTileManager;
  private readonly camera: CameraController;
  private readonly bbCache = new Map<string, BoundingBox>();
  private lastVisibleKeys = new Set<string>();

  constructor(
    scene: Scene,
    tiling: TilingScheme,
    lodSelector: LODSelector,
    tileManager: TerrainTileManager,
    camera: CameraController
  ) {
    this.scene = scene;
    this.tiling = tiling;
    this.lodSelector = lodSelector;
    this.tileManager = tileManager;
    this.camera = camera;
  }

  /** 매 프레임 호출 */
  update(): void {
    const cameraPos = this.camera.position;
    const forwardVec = this.camera.target.subtract(cameraPos).normalize();

    // SSE projFactor: 화면 높이 / (2 × tan(fov / 2))
    const screenHeight = this.scene.getEngine().getRenderHeight();
    const projFactor = screenHeight / (2 * Math.tan(this.camera.camera.fov / 2));

    // 1. Frustum planes 계산 (scene.render() 전에도 올바른 matrix 보장)
    this.scene.updateTransformMatrix();
    const frustumPlanes = Frustum.GetPlanes(this.scene.getTransformMatrix());

    // 2. Quadtree traversal → visible tile set 수집
    const visibleKeys = new Set<string>();
    const visibleCoords: TileCoord[] = [];
    this.traverse(this.tiling.getRoot(), cameraPos, frustumPlanes, visibleKeys, visibleCoords, projFactor, forwardVec);

    // 2-1. LOD Consistency: 인접 타일 레벨 차이를 최대 1로 제한
    this.enforceConsistency(visibleKeys, visibleCoords);

    // 3. 새로 필요한 타일 생성
    for (const coord of visibleCoords) {
      const coarserBorders = this.computeCoarserBorders(coord, visibleKeys);
      this.tileManager.getOrCreate(coord, coarserBorders);
    }

    // 4. 더 이상 필요 없는 타일 제거
    const cachedKeys = this.tileManager.getCachedKeys();
    for (const key of cachedKeys) {
      if (!visibleKeys.has(key)) {
        this.tileManager.dispose(parseTileKey(key));
        this.bbCache.delete(key);
      }
    }

    // 5. visible 상태 업데이트
    this.tileManager.updateVisibility(visibleKeys);
    this.lastVisibleKeys = visibleKeys;
  }

  get visibleTileKeys(): ReadonlySet<string> {
    return this.lastVisibleKeys;
  }

  /**
   * 타일의 4방향 이웃이 1레벨 더 거친지(level-1) 판별
   * BVS는 coarser 방향에만 적용되어야 한다.
   */
  private computeCoarserBorders(coord: TileCoord, visibleKeys: Set<string>): CoarserBorders {
    const { tileX: tx, tileY: ty, level: lvl } = coord;
    const maxTiles = 2 ** lvl;

    const isCoarser = (nbTx: number, nbTy: number): boolean => {
      if (nbTx < 0 || nbTy < 0 || nbTx >= maxTiles || nbTy >= maxTiles) return false;
      if (visibleKeys.has(tileKey({ tileX: nbTx, tileY: nbTy, level: lvl }))) return false;
      if (lvl > 0) {
        return visibleKeys.has(tileKey({
          tileX: Math.floor(nbTx / 2),
          tileY: Math.floor(nbTy / 2),
          level: lvl - 1,
        }));
      }
      return false;
    };

    return {
      N: isCoarser(tx, ty - 1),
      S: isCoarser(tx, ty + 1),
      W: isCoarser(tx - 1, ty),
      E: isCoarser(tx + 1, ty),
    };
  }

  /**
   * LOD Consistency Enforcement
   *
   * 인접 타일의 LOD 레벨 차이가 2 이상인 경우 coarse 타일을 강제 분할하여
   * 인접 차이를 최대 1로 제한한다. BVS가 항상 올바르게 동작하도록 보장.
   */
  private enforceConsistency(visibleKeys: Set<string>, visibleCoords: TileCoord[]): void {
    const coordsByKey = new Map<string, TileCoord>();
    for (const coord of visibleCoords) coordsByKey.set(tileKey(coord), coord);

    let changed = true;
    let iterations = 0;
    while (changed && iterations++ < 20) {
      changed = false;
      for (const coord of [...visibleCoords]) {
        const maxTiles = 2 ** coord.level;
        const sameNeighbors: TileCoord[] = [
          { tileX: coord.tileX - 1, tileY: coord.tileY, level: coord.level },
          { tileX: coord.tileX + 1, tileY: coord.tileY, level: coord.level },
          { tileX: coord.tileX, tileY: coord.tileY - 1, level: coord.level },
          { tileX: coord.tileX, tileY: coord.tileY + 1, level: coord.level },
        ];

        for (const neighbor of sameNeighbors) {
          if (neighbor.tileX < 0 || neighbor.tileY < 0 || neighbor.tileX >= maxTiles || neighbor.tileY >= maxTiles) continue;
          if (coordsByKey.has(tileKey(neighbor))) continue; // 같은 레벨 이웃 존재 → OK

          // neighbor 위치를 담당하는 visible ancestor 탐색
          for (let ancestorLevel = coord.level - 1; ancestorLevel >= 0; ancestorLevel--) {
            const scale = 2 ** (coord.level - ancestorLevel);
            const ancestor: TileCoord = {
              tileX: Math.floor(neighbor.tileX / scale),
              tileY: Math.floor(neighbor.tileY / scale),
              level: ancestorLevel,
            };
            const ancestorKey = tileKey(ancestor);
            if (!coordsByKey.has(ancestorKey)) continue;

            if (coord.level - ancestorLevel > 1) {
              // ancestor 제거 후 4개 children 추가
              coordsByKey.delete(ancestorKey);
              visibleKeys.delete(ancestorKey);
              const idx = visibleCoords.findIndex(c => tileKey(c) === ancestorKey);
              if (idx !== -1) visibleCoords.splice(idx, 1);

              const childLevel = ancestorLevel + 1;
              for (let childX = 0; childX < 2; childX++) {
                for (let childY = 0; childY < 2; childY++) {
                  const child: TileCoord = {
                    tileX: ancestor.tileX * 2 + childX,
                    tileY: ancestor.tileY * 2 + childY,
                    level: childLevel,
                  };
                  const childKey = tileKey(child);
                  if (!coordsByKey.has(childKey)) {
                    coordsByKey.set(childKey, child);
                    visibleKeys.add(childKey);
                    visibleCoords.push(child);
                  }
                }
              }
              changed = true;
            }
            break;
          }
        }
      }
    }
  }

  /**
   * Quadtree 재귀 traversal
   *
   * - 현재 타일의 SSE가 충분하면 → visible set에 추가
   * - 더 세밀해야 하면 → 4개 자식 타일로 재귀
   * - 최대 레벨이면 → 강제로 visible set에 추가
   */
  private traverse(
    coord: TileCoord,
    cameraPos: Vector3,
    frustumPlanes: Plane[],
    visibleKeys: Set<string>,
    visibleCoords: TileCoord[],
    projFactor: number,
    forwardVec: Vector3,
  ): void {
    const bounds = this.tiling.tileBoundsToWorld(coord);

    const key = tileKey(coord);
    let boundingBox = this.bbCache.get(key);
    if (!boundingBox) {
      boundingBox = new BoundingBox(
        new Vector3(bounds.minX, 0, bounds.minZ),
        new Vector3(bounds.maxX, HEIGHT_SCALE, bounds.maxZ),
      );
      this.bbCache.set(key, boundingBox);
    }
    if (!boundingBox.isInFrustum(frustumPlanes)) return;

    const isSufficient =
      this.tiling.isMaxLevel(coord) ||
      this.lodSelector.isSufficientDetail(cameraPos, bounds, projFactor, forwardVec);

    if (isSufficient) {
      visibleKeys.add(tileKey(coord));
      visibleCoords.push(coord);
    } else {
      for (const child of this.tiling.getChildren(coord)) {
        this.traverse(child, cameraPos, frustumPlanes, visibleKeys, visibleCoords, projFactor, forwardVec);
      }
    }
  }
}
