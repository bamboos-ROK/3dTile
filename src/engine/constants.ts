/** 지형 world 크기 (units). heightmap 256px × 2 = 512 */
export const TERRAIN_SIZE = 512;

/** 높이맵 최대 높이 (units). pixelValue / 255 × HEIGHT_SCALE */
export const HEIGHT_SCALE = 480;

/** Quadtree 최대 LOD 레벨 */
export const MAX_LOD_LEVEL = 4;

/** 타일당 버텍스 해상도 (32×32 vertices, 31×31 cells) */
export const VERTEX_RESOLUTION = 32;

/** heightmap 1픽셀 = 2 world units (256px × 2 = 512) */
export const PIXEL_WORLD_SIZE = TERRAIN_SIZE / 256;
