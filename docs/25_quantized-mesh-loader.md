# 25 — Quantized-Mesh TileLoader 구현 및 디버깅 히스토리

## 개요

로컬 Cesium 지형 서버(`http://192.168.0.201:28845`)에서 quantized-mesh 1.0 바이너리 타일을 fetch하여 Babylon.js Mesh로 변환하는 실제 TileLoader를 구현.

기존 placeholder TileLoader를 대체하며, 파싱 버그를 단계적으로 발견·수정하는 과정을 포함.

---

## 신규 파일

### `src/engine/tile/QuantizedMeshParser.ts`

Cesium quantized-mesh 1.0 바이너리 포맷 파서.

**포맷 구조:**
```
Header (88 bytes)
  Offset  0: centerX/Y/Z (f64 × 3)
  Offset 24: minimumHeight (f32)
  Offset 28: maximumHeight (f32)
  Offset 32: boundingSphere (f64 × 4)
  Offset 64: horizonOcclusionPoint (f64 × 3)

vertexCount (u32, at offset 88)
u[vertexCount]      (u16, zig-zag delta encoded)
v[vertexCount]      (u16, zig-zag delta encoded)
height[vertexCount] (u16, zig-zag delta encoded)
triangleCount (u32) ← padding 없이 바로 시작 (서버 구현 특성)
indices[triangleCount * 3] (u16 if vertexCount ≤ 65536, else u32)
```

**핵심 디코딩:**
- **Zig-zag delta**: `zigzagDecode(n) = (n>>1)^(-(n&1))`, 각 버퍼를 누적합으로 절대값 복원
- **HWM (High Watermark) decode**: 인덱스 배열에 적용
  ```
  highest = 0
  for each code: decoded = highest - code; if code==0: highest++
  ```
- **정규화**: `u[i] = val / 32767`, `v[i] = val / 32767`, `height[i] = val / 32767`

### `src/engine/tile/QuantizedMeshTileLoader.ts`

서버 fetch + Mesh 생성 클래스.

**URL 패턴:** `/terrain/{z}/{x}/{y}.terrain`

**좌표 매핑:**
```
worldX = minX + u[i] * size          (서→동)
worldY = (minHeight + height[i] * (maxHeight - minHeight)) * heightScale
worldZ = minZ + v[i] * size          (남→북)
```

**Material:** z레벨별 색상 (Green→Blue→Yellow→Magenta→Red 순환), solid 렌더링.
실패 시 throw → LODTraverser의 DebugTileMesh 폴백으로 처리됨.

---

## 수정된 파일

### `src/engine/constants.ts`

```typescript
export const MAX_LOD_LEVEL = 15;      // 4 → 15 (서버 최대 z)
export const GEO_ROOT_Z = 9;
export const GEO_ROOT_X = 873;
export const GEO_ROOT_Y = 362;
export const GEO_LON_MIN / GEO_LON_MAX / GEO_LAT_MIN / GEO_LAT_MAX  // 루트 타일 지리 범위
```

루트 타일(z=9, x=873, y=362) = 한국 특정 지역, 약 35km × 40km.

### `src/engine/tile/TileCoords.ts` — getTileBounds 교체

로컬 그리드 좌표계 → **EPSG:4326 TMS** 지리 좌표 기반으로 완전 교체.

```typescript
// EPSG:4326 TMS: tilesX = 2^(z+1), tilesY = 2^z
// 루트 타일 지리 범위를 [-256, +256] world 좌표로 매핑
```

### `src/engine/tile/TileManager.ts`

loader 반환 타입 확장: `mesh` 포함 가능하도록 수정.
```typescript
// 기존
loader: () => Promise<Omit<Tile, "x"|"y"|"z"|"state"|"mesh">>
// 변경
loader: () => Promise<Partial<Omit<Tile, "x"|"y"|"z"|"state">>>
```

### `src/engine/tile/LODTraverser.ts`

루트 타일 변경: `(0,0,0)` → `(GEO_ROOT_X, GEO_ROOT_Y, GEO_ROOT_Z)`

### `src/engine/tile/DebugTileMesh.ts`

Material을 wireframe-only로 변경 (기존: 반투명 solid).
```typescript
// 변경 전
mat.alpha = 0.5; mat.backFaceCulling = false; mat.disableDepthWrite = true;
// 변경 후
mat.wireframe = true;
```

---

## 디버깅 히스토리 (발견 순)

### Bug 1 — URL 경로 불일치

- **증상:** 모든 타일 fetch 404
- **원인:** `/${z}/${x}/${y}.terrain` → 서버는 `/terrain/{z}/{x}/{y}.terrain` 요청
- **수정:** URL prefix `/terrain` 추가

### Bug 2 — 좌표계 불일치 (핵심)

- **증상:** 서버에 없는 타일 요청 (z=0/x=0/y=0 등)
- **원인:** 기존 로컬 그리드(z=0=전체 지형)와 EPSG:4326 TMS(한국=z=9/x=873/y=362)가 완전히 다른 좌표계
- **수정:** TileCoords.getTileBounds → TMS 지리 좌표 기반 교체, LODTraverser 루트 변경

### Bug 3 — triangleCount = 0 (핵심 파싱 버그)

- **증상:** Wireframe에서 삼각형 구조 안 보임 (DebugTileMesh 폴백이 보이던 것), normals 전부 0
- **원인 추적:**
  1. normals=0 → degenerate triangle 의심
  2. HWM decode 누락 의심 → 추가했으나 여전히 0
  3. `triangleCount` 로그 → 0
  4. raw bytes 확인 → 서버가 4-byte alignment padding 없이 vertex 데이터 직후에 triangleCount 배치
  - `Math.ceil(710/4)*4 = 712` → bytes [0,0,0,0] = 0 읽음
  - `710` 직접 읽기 → bytes [41,1,0,0] = **297** ✓
- **수정:** `indexDataStart = Math.ceil(vertexDataEnd/4)*4` → `indexDataStart = vertexDataEnd`

### Bug 4 — Solid 면 투명 (normals 방향 반전)

- **증상:** Wireframe은 보이나 Solid 면이 투명
- **원인:** Bug 3 수정 전(triangleCount=0)에 추가한 winding order flip이 유효한 triangle에 적용되면서 normals를 아래(-Y)로 반전 → backface culling
- **수정:** winding order flip 루프 제거

### Bug 5 — height 전부 0 (z=9 서버 특성)

- **증상:** 모든 vertex Y=0, flat 지형
- **원인 추적:** minHeight=0, maxHeight=476.16이지만 hRaw가 전부 0
  - buffer 범위는 정상 (hEnd=710 < bufferSize=2759)
  - u/v는 정상 데이터 존재
  - **결론:** 서버가 z=9(coarse LOD)에서 height를 0으로 인코딩 — 실제 elevation 데이터는 고해상도 z=10+ 자식 타일에 존재
- **수정 없음:** 서버 측 동작, z=9는 flat tile이 정상

---

## 시각 구분 전략

| 타일 타입 | 스타일 | 의미 |
|---|---|---|
| 실제 서버 타일 | solid + z-level color | 데이터 있음 |
| debug 폴백 타일 | wireframe + z-level color | 데이터 없음 (폴백) |

---

## Known Issues

- **z=9 height=0**: 루트 타일은 flat. zoom in → z=10+ 자식 타일에서 실제 고도 데이터 확인 필요
- **heightScale=0.01**: meters → world 단위 변환. 실제 지형 가시성에 따라 조정 가능
- edge indices, extensions(octVertexNormals 등) 미파싱 — 현재 구현에서 불필요
