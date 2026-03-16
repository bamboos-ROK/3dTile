import type { TileCoord } from '../terrain/TerrainTile';
import type { TilingScheme, TileBounds } from './TilingScheme';

/**
 * Local Grid Tiling
 *
 * 정규화된 [0,1] 공간을 Quadtree로 분할하여
 * world 공간(512 × 512 units)으로 변환한다.
 *
 * Level 0: 1 tile  (512 × 512)
 * Level 1: 4 tiles (256 × 256)
 * Level 2: 16 tiles (128 × 128)
 * Level 3: 64 tiles (64 × 64)
 */
export class LocalGridTiling implements TilingScheme {
  readonly maxLevel: number;
  readonly worldSize: number;

  constructor(maxLevel = 4, worldSize = 512) {
    this.maxLevel = maxLevel;
    this.worldSize = worldSize;
  }

  getRoot(): TileCoord {
    return { tileX: 0, tileY: 0, level: 0 };
  }

  tileBoundsToWorld(coord: TileCoord): TileBounds {
    const tilesPerAxis = Math.pow(2, coord.level);
    const tileSize = this.worldSize / tilesPerAxis;

    // world 원점을 terrain 중심으로 설정 ([-256, 256])
    const offset = this.worldSize / 2;
    const minX = coord.tileX * tileSize - offset;
    const minZ = coord.tileY * tileSize - offset;
    const maxX = minX + tileSize;
    const maxZ = minZ + tileSize;

    return {
      minX,
      minZ,
      maxX,
      maxZ,
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      size: tileSize,
    };
  }

  getChildren(coord: TileCoord): TileCoord[] {
    const childLevel = coord.level + 1;
    const baseX = coord.tileX * 2;
    const baseY = coord.tileY * 2;
    return [
      { tileX: baseX, tileY: baseY, level: childLevel },
      { tileX: baseX + 1, tileY: baseY, level: childLevel },
      { tileX: baseX, tileY: baseY + 1, level: childLevel },
      { tileX: baseX + 1, tileY: baseY + 1, level: childLevel },
    ];
  }

  isMaxLevel(coord: TileCoord): boolean {
    return coord.level >= this.maxLevel;
  }
}
