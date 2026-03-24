import {
  TERRAIN_SIZE,
  GEO_LON_MIN,
  GEO_LON_MAX,
  GEO_LAT_MIN,
  GEO_LAT_MAX,
} from "../constants";

/**
 * World 좌표 → EPSG:4326 TMS z/x/y 타일 좌표 변환 (getTileBounds 역함수)
 *
 * clamp 없이 실제 좌표를 그대로 반환 — 범위 밖 타일은 호출부에서 skip 처리.
 */
export function worldToTileCoord(
  worldX: number,
  worldZ: number,
  z: number,
): [number, number] {
  const half = TERRAIN_SIZE / 2;
  const lonRange = GEO_LON_MAX - GEO_LON_MIN;
  const latRange = GEO_LAT_MAX - GEO_LAT_MIN;

  const lon = GEO_LON_MIN + ((worldX + half) / TERRAIN_SIZE) * lonRange;
  const lat = GEO_LAT_MIN + ((worldZ + half) / TERRAIN_SIZE) * latRange;

  const tilesX = Math.pow(2, z + 1);
  const tilesY = Math.pow(2, z);
  const x = Math.floor(((lon + 180) / 360) * tilesX);
  const y = Math.floor(((lat + 90) / 180) * tilesY);

  return [x, y];
}

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
 * EPSG:4326 TMS z/x/y → World 좌표 bounds 계산
 *
 * EPSG:4326 TMS 공식:
 *   tilesX = 2^(z+1), tilesY = 2^z
 *   lon = x / tilesX * 360 - 180
 *   lat = y / tilesY * 180 - 90  (y=0 = 남쪽)
 *
 * World 좌표: 루트 타일(GEO_ROOT) 지리 범위를 [-TERRAIN_SIZE/2, +TERRAIN_SIZE/2]에 매핑
 *   worldX ← 경도 (서→동)
 *   worldZ ← 위도 (남→북)
 */
export function getTileBounds(x: number, y: number, z: number): TileBounds {
  const tilesX = Math.pow(2, z + 1);
  const tilesY = Math.pow(2, z);

  const lonMin = (x / tilesX) * 360 - 180;
  const lonMax = ((x + 1) / tilesX) * 360 - 180;
  const latMin = (y / tilesY) * 180 - 90;
  const latMax = ((y + 1) / tilesY) * 180 - 90;

  const lonRange = GEO_LON_MAX - GEO_LON_MIN;
  const latRange = GEO_LAT_MAX - GEO_LAT_MIN;
  const half = TERRAIN_SIZE / 2;

  const minX = ((lonMin - GEO_LON_MIN) / lonRange) * TERRAIN_SIZE - half;
  const maxX = ((lonMax - GEO_LON_MIN) / lonRange) * TERRAIN_SIZE - half;
  const minZ = ((latMin - GEO_LAT_MIN) / latRange) * TERRAIN_SIZE - half;
  const maxZ = ((latMax - GEO_LAT_MIN) / latRange) * TERRAIN_SIZE - half;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    size: maxX - minX,
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
