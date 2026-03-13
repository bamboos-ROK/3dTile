import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Scene } from '@babylonjs/core/scene';
import type { TileCoord } from '../terrain/TerrainTile';
import { tileKey } from '../terrain/TerrainTile';
import type { TerrainTileManager } from '../terrain/TerrainTileManager';
import type { LODSelector } from '../lod/LODSelector';
import type { TilingScheme } from '../tiling/TilingScheme';
import type { CameraController } from '../camera/CameraController';

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

    // 1. Frustum planes 계산 (scene.render() 전에도 올바른 matrix 보장)
    this.scene.updateTransformMatrix();
    const frustumPlanes = Frustum.GetPlanes(this.scene.getTransformMatrix());

    // 2. Quadtree traversal → visible tile set 수집
    const visibleKeys = new Set<string>();
    const visibleCoords: TileCoord[] = [];
    this.traverse(this.tiling.getRoot(), cameraPos, visibleKeys, visibleCoords);

    // 3. 새로 필요한 타일 생성
    for (const coord of visibleCoords) {
      this.tileManager.getOrCreate(coord);
    }

    // 4. 더 이상 필요 없는 타일 제거
    const cachedKeys = this.tileManager.getCachedKeys();
    for (const key of cachedKeys) {
      if (!visibleKeys.has(key)) {
        const [tileX, tileY, level] = key.split('_').map(Number);
        this.tileManager.dispose({ tileX, tileY, level });
      }
    }

    // 5. Frustum culling으로 visible/active 상태 업데이트
    this.tileManager.updateVisibility(visibleKeys, frustumPlanes);
  }

  /**
   * Quadtree 재귀 traversal
   *
   * - 현재 타일의 LOD가 충분하면 → visible set에 추가
   * - 더 세밀해야 하면 → 4개 자식 타일로 재귀
   * - 최대 레벨이면 → 강제로 visible set에 추가
   */
  private traverse(
    coord: TileCoord,
    cameraPos: import('@babylonjs/core/Maths/math.vector').Vector3,
    visibleKeys: Set<string>,
    visibleCoords: TileCoord[]
  ): void {
    const bounds = this.tiling.tileBoundsToWorld(coord);

    const isSufficient =
      this.tiling.isMaxLevel(coord) ||
      this.lodSelector.isSufficientDetail(coord.level, cameraPos, bounds);

    if (isSufficient) {
      visibleKeys.add(tileKey(coord));
      visibleCoords.push(coord);
    } else {
      for (const child of this.tiling.getChildren(coord)) {
        this.traverse(child, cameraPos, visibleKeys, visibleCoords);
      }
    }
  }
}
