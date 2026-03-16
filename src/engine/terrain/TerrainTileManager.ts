import { BoundingBox } from '@babylonjs/core/Culling/boundingBox';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TerrainTile, TileState, tileKey } from './TerrainTile';
import type { TileCoord } from './TerrainTile';
import type { HeightmapData } from './TerrainMeshBuilder';
import { buildTerrainMesh } from './TerrainMeshBuilder';
import { HEIGHT_SCALE } from '../constants';
import type { TilingScheme } from '../tiling/TilingScheme';

export class TerrainTileManager {
  private readonly cache = new Map<string, TerrainTile>();
  private readonly scene: Scene;
  private readonly tiling: TilingScheme;
  private readonly heightmap: HeightmapData;
  private readonly material: StandardMaterial;

  constructor(scene: Scene, tiling: TilingScheme, heightmap: HeightmapData, material: StandardMaterial) {
    this.scene = scene;
    this.tiling = tiling;
    this.heightmap = heightmap;
    this.material = material;
  }

  /** 타일 캐시에서 가져오거나 새로 생성하여 Active 상태로 만든다 */
  getOrCreate(coord: TileCoord): TerrainTile {
    const key = tileKey(coord);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const tile = new TerrainTile(coord);
    tile.state = TileState.Loading;
    this.cache.set(key, tile);

    const bounds = this.tiling.tileBoundsToWorld(coord);
    const mesh = buildTerrainMesh(
      this.scene,
      coord,
      this.heightmap,
      bounds.minX,
      bounds.minZ,
      bounds.size,
      this.material,
    );

    // AABB bounding box 설정
    tile.boundingBox = new BoundingBox(
      new Vector3(bounds.minX, 0, bounds.minZ),
      new Vector3(bounds.maxX, HEIGHT_SCALE, bounds.maxZ),
    );

    tile.mesh = mesh;
    tile.mesh.isVisible = false;
    tile.state = TileState.Active;

    return tile;
  }

  /** 타일 제거 */
  dispose(coord: TileCoord): void {
    const key = tileKey(coord);
    const tile = this.cache.get(key);
    if (!tile) return;

    tile.mesh?.dispose();
    this.cache.delete(key);
  }

  /** 현재 visible set 기준으로 가시성 업데이트 */
  updateVisibility(visibleKeys: Set<string>): void {
    for (const [key, tile] of this.cache) {
      if (!visibleKeys.has(key)) continue;
      if (!tile.mesh) continue;
      tile.mesh.isVisible = true;
      tile.state = TileState.Visible;
    }
  }

  /** 현재 캐시된 모든 타일 키 반환 */
  getCachedKeys(): Set<string> {
    return new Set(this.cache.keys());
  }

  get tileCount(): number {
    return this.cache.size;
  }
}
