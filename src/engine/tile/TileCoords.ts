import { TERRAIN_SIZE } from "../constants";

export type TileBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  size: number;
  // Y축: 현재 Phase에서는 y=0 평면 기준 (DEM 연동 전)
};

/**
 * z/x/y → World 좌표 bounds 계산
 *
 * - tile y: 아래 방향 증가 (서버 타일 표준)
 * - Babylon Z축: 위 방향 증가 → 음수 반전 적용
 * - 중앙 원점: worldX = x * tileSize - TERRAIN_SIZE/2
 *              worldZ = -y * tileSize + TERRAIN_SIZE/2
 */
export function getTileBounds(x: number, y: number, z: number): TileBounds {
  const tileSize = TERRAIN_SIZE / Math.pow(2, z);
  const offset = TERRAIN_SIZE / 2;

  const minX = x * tileSize - offset;
  const maxX = minX + tileSize;

  // tile y 증가 → world Z 감소
  const maxZ = -y * tileSize + offset;
  const minZ = maxZ - tileSize;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size: tileSize,
  };
}

/**
 * 자식 타일 좌표 반환 (쿼드트리 분할)
 * (x, y, z) → 4개 자식 at z+1
 */
export function getChildCoords(
  x: number,
  y: number,
  z: number,
): [number, number, number][] {
  return [
    [2 * x, 2 * y, z + 1],
    [2 * x + 1, 2 * y, z + 1],
    [2 * x, 2 * y + 1, z + 1],
    [2 * x + 1, 2 * y + 1, z + 1],
  ];
}
