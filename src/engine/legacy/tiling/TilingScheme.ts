import type { TileCoord } from '../terrain/TerrainTile';

/** 타일 좌표를 world 공간으로 변환하는 결과 */
export interface TileBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  size: number;
}

/** 타일링 방식 추상화 인터페이스 */
export interface TilingScheme {
  readonly maxLevel: number;
  readonly worldSize: number;

  /** 루트 타일 좌표 반환 */
  getRoot(): TileCoord;

  /** 타일의 world 좌표 경계 반환 */
  tileBoundsToWorld(coord: TileCoord): TileBounds;

  /** 타일의 4개 자식 좌표 반환 */
  getChildren(coord: TileCoord): TileCoord[];

  /** 최대 레벨 여부 */
  isMaxLevel(coord: TileCoord): boolean;
}
