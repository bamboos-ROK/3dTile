/** 지형 world 크기 (units) */
export const TERRAIN_SIZE = 512;

/** Quadtree 최대 LOD 레벨 (서버 최대 z=15) */
export const MAX_LOD_LEVEL = 15;

// ─── 지리 좌표 루트 (EPSG:4326 TMS) ───────────────────────────────────────────
/** 렌더링 루트 z레벨 — 서버 layer.json 기준 최소 단일 타일 (z=9) */
export const GEO_ROOT_Z = 9;

/** GEO_LON/LAT 범위 계산용 내부 참조 (export 불필요) */
const GEO_ROOT_X = 873;
const GEO_ROOT_Y = 362;

/** 루트 타일 지리 범위 (경도/위도, degrees) */
export const GEO_LON_MIN =
  (GEO_ROOT_X / Math.pow(2, GEO_ROOT_Z + 1)) * 360 - 180;
export const GEO_LON_MAX =
  ((GEO_ROOT_X + 1) / Math.pow(2, GEO_ROOT_Z + 1)) * 360 - 180;
export const GEO_LAT_MIN = (GEO_ROOT_Y / Math.pow(2, GEO_ROOT_Z)) * 180 - 90;
export const GEO_LAT_MAX =
  ((GEO_ROOT_Y + 1) / Math.pow(2, GEO_ROOT_Z)) * 180 - 90;

// ─── 위성 이미지 설정 ────────────────────────────────────────────────────────
export const SAT_Z_MIN = 12;
export const SAT_Z_MAX = 18;
export const SAT_TILE_PIXEL_SIZE = 256;

/** 위성 타일이 지형 타일보다 높은 해상도를 사용하도록 하는 오프셋 (타일 수: 최대 4×4=16) */
export const SAT_Z_OFFSET = 0;

/** 디버그 모드: true이면 위성 오버레이·DebugTileMesh 폴백 활성화 */
export const DEBUG = true;

// ─── LOD 전환 임계값 (Hysteresis) ────────────────────────────────────────────
/** 새로 split할 때 기준 (높을수록 더 자주 쪼개짐) */
export const SPLIT_THRESHOLD = 150;
/** 이미 split된 것을 merge할 때 기준 — thrashing 방지 */
export const MERGE_THRESHOLD = 100;
