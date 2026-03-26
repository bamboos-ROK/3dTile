# 29. 위성 이미지 텍스처 시스템

## 개요

Terrain tile(EPSG:4326 TMS)에 Web Mercator XYZ 위성 이미지를 합성하여 `DynamicTexture`로 적용하는 시스템.
두 좌표계의 차이(Y 방향, 위도 비선형성)를 처리하는 것이 핵심 과제다.

---

## 좌표계 비교

| 항목 | Terrain (EPSG:4326 TMS) | Satellite (Web Mercator XYZ) |
|------|------------------------|------------------------------|
| 타일 수 (z레벨) | tilesX = 2^(z+1), tilesY = 2^z | tilesXY = 2^z |
| Y=0 위치 | 남쪽 (South) | 북쪽 (North) |
| 위도 매핑 | 선형 | Mercator 비선형 |
| 서버 URL 패턴 | `/terrain/{z}/{x}/{y}.terrain` | `/maps-satellite/{z}/{x}/{y}.jpg` |

---

## 파일 구성

### `src/engine/tile/SatelliteProjection.ts`

좌표 변환 유틸리티 함수 모음.

| 함수 | 역할 |
|------|------|
| `latToMercatorYFrac(lat, nSat)` | 위도(도) → Web Mercator Y tile fraction |
| `terrainTileBounds(z, x, y)` | terrain tile → 위경도 경계 (lonMin/Max, latMin/Max) |
| `getSatelliteTileRange(terrainZ, terrainX, terrainY, satZ)` | terrain tile 범위를 커버하는 위성 타일 인덱스 범위 반환 |

**핵심: `getSatelliteTileRange`의 경계 처리**

```
xMin = floor(lonMin → sat X)   // 경계점 포함
xMax = ceil(lonMax → sat X) - 1 // 경계점이 정확히 타일 경계에 걸릴 때 초과 방지
yMin = floor(latToMercator(latMax))  // 북쪽(작은 Y) → floor
yMax = ceil(latToMercator(latMin)) - 1 // 남쪽(큰 Y) → ceil-1
```

### `src/engine/tile/SatelliteTextureBuilder.ts`

terrain tile 1개 → `DynamicTexture` 빌드.

**처리 흐름:**

```
1. getSatelliteTileRange()로 필요한 위성 타일 범위 계산
2. 범위 내 모든 위성 타일을 병렬 fetch (blobCache로 중복 방지)
3. OffscreenCanvas에 타일 격자 합성
   - drawImage(bmp, dx, dy, SAT_TILE_PIXEL_SIZE, SAT_TILE_PIXEL_SIZE)
     ← 서버 이미지 실제 크기와 무관하게 고정 크기로 리사이즈
4. terrain tile의 지리적 경계(lon/lat → Mercator pixel)로 crop
5. DynamicTexture 생성 및 반환
```

**Blob 캐시 (`blobCache: Map<string, Promise<Blob>>`):**

- `Promise<Blob>`을 영속 캐시 → 한 번 fetch하면 재요청 없음
- 호출마다 `createImageBitmap(blob)`으로 독립 `ImageBitmap` 생성
  → 여러 terrain tile이 같은 위성 타일을 공유해도 `bmp.close()` 충돌 없음

---

## Crop 로직 상세

OffscreenCanvas는 위성 타일 격자 전체를 포함(terrain 경계 밖까지 포함).
UV(u[i]/v[i])는 terrain tile 지리 경계 기준 0~1이므로, 텍스처도 정확히 terrain 경계만큼 잘라야 함.

```
cropX0 = ((lonMin + 180) / 360 * nSat - xMin) * SAT_TILE_PIXEL_SIZE  // 서쪽 경계 픽셀
cropX1 = ((lonMax + 180) / 360 * nSat - xMin) * SAT_TILE_PIXEL_SIZE  // 동쪽 경계 픽셀
cropY0 = (latToMercatorYFrac(latMax, nSat) - yMin) * SAT_TILE_PIXEL_SIZE  // 북쪽 경계 픽셀
cropY1 = (latToMercatorYFrac(latMin, nSat) - yMin) * SAT_TILE_PIXEL_SIZE  // 남쪽 경계 픽셀

tex.getContext().drawImage(canvas, -cropX0, -cropY0)
// canvas를 (-cropX0, -cropY0) 오프셋으로 그리면 cropX0,cropY0 지점이 텍스처 (0,0)에 오게 됨
```

X축(경도): 선형 변환
Y축(위도): `latToMercatorYFrac()`로 Mercator 비선형 변환 적용

---

## UV 방향 정합

```
terrain mesh UV:
  u[i]: west=0, east=1
  v[i]: south=0, north=1

DynamicTexture canvas:
  (0, 0) = 북쪽 (cropY0)
  (0, cropH) = 남쪽 (cropY1)

WebGL 업로드 시 Y 플립 없음(DynamicTexture 기본):
  canvas top(Y=0, north) → texture V=1 → 메시 north vertex(v=1) ✓
  canvas bottom(Y=cropH, south) → texture V=0 → 메시 south vertex(v=0) ✓
```

---

## 관련 상수 (`src/engine/constants.ts`)

| 상수 | 값 | 설명 |
|------|----|------|
| `SAT_Z_MIN` | 12 | 위성 타일 최소 z레벨 (terrain z가 낮아도 12로 클램프) |
| `SAT_Z_MAX` | 18 | 위성 타일 최대 z레벨 |
| `SAT_TILE_PIXEL_SIZE` | 256 | composite canvas 내 위성 타일 1개당 픽셀 크기 |

---

## 발견·수정된 버그

| 버그 | 원인 | 수정 |
|------|------|------|
| 타일 경계에서 위성이미지 불연속 | composite 텍스처가 위성 격자 전체를 포함하여 UV와 불일치 | terrain 지리 경계로 crop |
| 동일 URL 중복 fetch | `fetchCache`가 완료 즉시 삭제(`finally`) | `blobCache`로 교체, 삭제 제거 |
| 위성 타일이 절반 위치에서 겹침 | `drawImage(bmp, dx, dy)` — 원본 크기(512px) 그대로 출력 | 5인수 형태로 `SAT_TILE_PIXEL_SIZE` 명시 |
