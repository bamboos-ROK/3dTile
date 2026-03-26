// Web Mercator 유효 위도 범위 (±90°에서 tan/cos 발산)
export const MERCATOR_LAT_LIMIT = 85.051129;

/** lat(도) + nSat → Web Mercator Y tile fraction */
export function latToMercatorYFrac(lat: number, nSat: number): number {
  const clamped = Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat));
  const latRad = (clamped * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * nSat
  );
}

/** EPSG:4326 TMS terrain tile (z, x, y) → 위경도 경계 */
export function terrainTileBounds(
  z: number,
  x: number,
  y: number,
): { lonMin: number; lonMax: number; latMin: number; latMax: number } {
  const n = Math.pow(2, z);
  return {
    lonMin: (x / (2 * n)) * 360 - 180,
    lonMax: ((x + 1) / (2 * n)) * 360 - 180,
    latMin: (y / n) * 180 - 90,
    latMax: ((y + 1) / n) * 180 - 90,
  };
}

/**
 * Terrain tile (EPSG:4326 TMS) → Satellite tile range (Web Mercator XYZ) 변환
 *
 * terrain:  tilesX = 2^(z+1), tilesY = 2^z  (Y=0=남쪽, 선형 위도)
 * satellite: tilesXY = 2^z                   (Y=0=북쪽, Mercator 비선형 위도)
 *
 * @example
 * getSatelliteTileRange(9, 873, 362, 12)
 * // xMin≈3492, xMax≈3496, yMin≈1585, yMax≈1592  (중심: x=3494, y=1589)
 */
export function getSatelliteTileRange(
  terrainZ: number,
  terrainX: number,
  terrainY: number,
  satZ: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const { lonMin, lonMax, latMin, latMax } = terrainTileBounds(terrainZ, terrainX, terrainY);
  const nSat = Math.pow(2, satZ);

  // min 경계: floor (경계점 포함이 맞음)
  const lonToSatXMin = (lon: number): number =>
    Math.floor(((lon + 180) / 360) * nSat);

  // max 경계: ceil - 1 (경계점이 정확히 타일 경계에 걸릴 때 한 칸 초과 방지)
  const lonToSatXMax = (lon: number): number =>
    Math.ceil(((lon + 180) / 360) * nSat) - 1;

  // Y축 방향 주의: latMax(북쪽) → yMin (작은 Y), latMin(남쪽) → yMax (큰 Y)
  const xMin = lonToSatXMin(lonMin);
  const xMax = lonToSatXMax(lonMax);
  const yMin = Math.floor(latToMercatorYFrac(latMax, nSat)); // 북쪽 경계 → floor OK
  const yMax = Math.ceil(latToMercatorYFrac(latMin, nSat)) - 1; // 남쪽 경계 → ceil-1

  // 범위 역전 방지 (FP 오차 극단 케이스)
  return {
    xMin: Math.min(xMin, xMax),
    xMax: Math.max(xMin, xMax),
    yMin: Math.min(yMin, yMax),
    yMax: Math.max(yMin, yMax),
  };
}
