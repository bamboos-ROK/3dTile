# Tile LOD Terrain — 코드 설명 문서

> 발표용 | 작성일: 2026-03-18

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [전체 아키텍처](#2-전체-아키텍처)
3. [데이터 흐름](#3-데이터-흐름)
4. [핵심 모듈별 설명](#4-핵심-모듈별-설명)
5. [핵심 알고리즘 심층 설명](#5-핵심-알고리즘-심층-설명)
6. [주요 상수 & 설계 결정](#6-주요-상수--설계-결정)

---

## 1. 프로젝트 개요

**목적:** Heightmap PNG 이미지(256~2048px 등 임의 크기)를 읽어서 실시간으로 LOD(Level of Detail)가 적용되는 3D 지형을 렌더링하는 데모 시스템.

**기술 스택:**
- Babylon.js v7 (`@babylonjs/core`) — 3D 렌더링 엔진
- TypeScript + Vite — 개발 환경
- Canvas 2D API — Heightmap 픽셀 데이터 추출

**핵심 문제와 해결책:**

| 문제 | 해결책 |
|------|--------|
| 넓은 지형을 고정 해상도로 렌더링 → 성능 낭비 | **Quadtree LOD** — 카메라 거리에 따라 타일 세분화 |
| LOD 전환 경계에서 메시 균열(seam) 발생 | **T-junction 제거** — 경계 정점 보정 |
| 카메라 밖 타일도 처리 → 낭비 | **Frustum Culling** — 화면 안 타일만 처리 |

---

## 2. 전체 아키텍처

### 모듈 구조

```
src/
├── main.ts                          ← 엔진 부트스트랩 & 렌더 루프
└── engine/
    ├── camera/
    │   └── CameraController.ts      ← RTS 방식 ArcRotate 카메라
    ├── heightmap/
    │   └── HeightmapLoader.ts       ← PNG → 픽셀 배열 변환
    ├── tiling/
    │   ├── TilingScheme.ts          ← 타일링 추상 인터페이스
    │   └── LocalGridTiling.ts       ← Quadtree 좌표 계산
    ├── terrain/
    │   ├── TerrainTile.ts           ← 타일 데이터 구조 & 유틸
    │   ├── TerrainTileManager.ts    ← 타일 캐시 & 생명주기 관리
    │   └── TerrainMeshBuilder.ts    ← 32×32 메시 기하학 생성
    ├── lod/
    │   └── LODSelector.ts           ← SSE 기반 LOD 결정
    └── renderer/
        └── TerrainRenderer.ts       ← Quadtree 순회 & 렌더 관리
```

### 모듈 간 의존 관계

```
main.ts
  ├── CameraController
  ├── LocalGridTiling  ─────────────────────────────┐
  ├── LODSelector  ──────────────────────────┐       │
  ├── HeightmapLoader                        │       │
  ├── TerrainTileManager ───(uses)──▶ TerrainMeshBuilder
  └── TerrainRenderer ──(uses)──▶ LODSelector, LocalGridTiling, TerrainTileManager
```

---

## 3. 데이터 흐름

### 3-1. 초기화 (1회)

```
main()
  │
  ├─ Engine + Scene 생성
  ├─ 조명 추가 (HemisphericLight + DirectionalLight)
  ├─ CameraController 생성 (ArcRotateCamera, target=(217,0,-156), radius=500)
  ├─ LocalGridTiling 생성 (maxLevel=4, worldSize=512)
  ├─ LODSelector 생성 (pixelThreshold=150)
  │
  ├─ await loadHeightmap("/heightmap.png")
  │    └── Canvas 2D → getImageData() → HeightmapData{pixels, width, height}  (실제 크기 동적 반영)
  │
  ├─ StandardMaterial (Diffuse.exr 텍스처)
  ├─ TerrainTileManager 생성
  └─ TerrainRenderer 생성
```

### 3-2. 렌더 루프 (매 프레임)

```
engine.runRenderLoop()
  │
  ├─ renderer.update()
  │    │
  │    ├─ ① 카메라 정보 추출
  │    │     cameraPos, forwardVec, projFactor(SSE용)
  │    │
  │    ├─ ② Frustum planes 계산
  │    │     Babylon.js Frustum.GetPlanes(transformMatrix)
  │    │
  │    ├─ ③ Quadtree traversal (재귀)
  │    │     traverse(root) → visible tile set 수집
  │    │     - Frustum 밖 → 조기 종료
  │    │     - SSE 충분 → visible에 추가
  │    │     - SSE 부족 → 4개 자식 재귀
  │    │
  │    ├─ ④ enforceConsistency()
  │    │     인접 타일 LOD 차이 ≤ 1 보장
  │    │
  │    ├─ ⑤ 새 타일 생성
  │    │     getOrCreate() → buildTerrainMesh()
  │    │     (CoarserBorders 계산 → T-junction 제거 적용)
  │    │
  │    ├─ ⑥ 불필요 타일 dispose()
  │    │     캐시에 있지만 visible set에 없는 타일 제거
  │    │
  │    └─ ⑦ updateVisibility()
  │          visible 타일만 mesh.isVisible = true
  │
  └─ scene.render()
       visible mesh들 GPU 렌더링
```

---

## 4. 핵심 모듈별 설명

---

### 4-1. HeightmapLoader

**역할:** PNG 이미지를 Canvas 2D API로 읽어 픽셀 배열로 변환.

```typescript
// HeightmapLoader.ts
interface HeightmapData {
  pixels: Uint8ClampedArray;  // RGBA 바이트 배열
  width: number;              // 실제 이미지 너비 (256, 512, 2048 등)
  height: number;             // 실제 이미지 높이
}

async function loadHeightmap(url: string): Promise<HeightmapData> {
  // Image → Canvas → getImageData() → pixels
}
```

**높이값 계산 (TerrainMeshBuilder에서):**
```typescript
// idx = (y * width + x) * 4  ← RGBA 배열에서 R 채널 위치
height = pixels[idx] / 255 * HEIGHT_SCALE  // 0 ~ 255 units
```

**핵심 포인트:** R 채널만 사용 (흑백 이미지이므로 R=G=B).

**높이 샘플링:** Bilinear interpolation 적용 — 픽셀 좌표가 소수일 때 주변 4픽셀을 가중평균하여 부드러운 높이값 반환. Nearest-neighbor 대비 LOD 고레벨 타일에서 계단 현상 완화.

---

### 4-2. LocalGridTiling — Quadtree 좌표 계산

**역할:** 타일 좌표(TileCoord)를 World 좌표(TileBounds)로 변환하고 Quadtree 구조를 정의.

```typescript
// LocalGridTiling.ts
tileBoundsToWorld(coord: TileCoord): TileBounds {
  const tilesPerAxis = Math.pow(2, coord.level);  // Level 2 → 4×4 그리드
  const tileSize = this.worldSize / tilesPerAxis;  // 512 / 4 = 128 units

  const offset = this.worldSize / 2;  // 중심 원점 보정
  const minX = coord.tileX * tileSize - offset;   // [-256, 256] 범위
  const minZ = coord.tileY * tileSize - offset;
  // ...
}

getChildren(coord: TileCoord): TileCoord[] {
  // 한 타일 → 4개 자식 (NW, NE, SW, SE)
  return [
    { tileX: baseX,     tileY: baseY,     level: coord.level + 1 },
    { tileX: baseX + 1, tileY: baseY,     level: coord.level + 1 },
    { tileX: baseX,     tileY: baseY + 1, level: coord.level + 1 },
    { tileX: baseX + 1, tileY: baseY + 1, level: coord.level + 1 },
  ];
}
```

**LOD 레벨별 구조** (2048px heightmap 기준):

| Level | 타일 수 | 타일 크기 | Heightmap 샘플 영역 |
|-------|---------|----------|-------------------|
| 0     | 1       | 512×512  | 2048×2048 px      |
| 1     | 4       | 256×256  | 1024×1024 px      |
| 2     | 16      | 128×128  | 512×512 px        |
| 3     | 64      | 64×64    | 256×256 px        |
| 4     | 256     | 32×32    | 128×128 px        |

샘플 영역은 `hm.width / 2^level`로 동적 계산 → heightmap 크기에 무관하게 동작.

---

### 4-3. LODSelector — SSE 기반 LOD 결정

**역할:** 타일이 현재 카메라 위치에서 충분히 세밀한지 판단.

> **SSE(Screen Space Error):** "이 타일을 지금 해상도로 그리면 화면에서 몇 픽셀의 오차가 생기는가?"

```typescript
// LODSelector.ts
isSufficientDetail(cameraPos, bounds, projFactor, cameraForward): boolean {
  // 타일 중심까지 벡터
  const dx = bounds.centerX - cameraPos.x;
  const dz = bounds.centerZ - cameraPos.z;

  // Forward 방향 depth (카메라 뒤쪽 타일의 depth≈0 폭발 방지용 euclidean 보정)
  const depth = dot(tileCenter - cameraPos, cameraForward);
  const euclidean = sqrt(dx² + dy² + dz²);
  const effectiveDepth = max(depth, euclidean * 0.5);

  // 기하 오차: 타일 크기의 절반
  const geometricError = bounds.size / 2;

  // 화면 공간 오차 공식
  const screenError = (geometricError * projFactor) / effectiveDepth;

  // threshold(150px) 미만이면 "충분히 세밀함" → 세분화 불필요
  return screenError < this.pixelThreshold;
}
```

**projFactor 계산:**
```
projFactor = screenHeight / (2 × tan(fov / 2))
           = 화면 높이를 FOV와 연관짓는 투영 스케일
```

**판단 흐름:**
```
screenError 크다 (타일이 크거나 가깝다) → 세분화 필요
screenError 작다 (타일이 작거나 멀다)  → 이 레벨로 충분
```

---

### 4-4. TerrainMeshBuilder — 메시 기하학 생성

**역할:** TileCoord + HeightmapData → 실제 3D Mesh 생성.

**메시 구조:**
- **32×32 정점 격자** (31×31 셀 × 2 삼각형 = 1,922개 삼각형)

**정점 생성:**
```typescript
// TerrainMeshBuilder.ts
for (let row = 0; row < 32; row++) {
  for (let col = 0; col < 32; col++) {
    const wx = worldMinX + (col / 31) * worldTileSize;   // world X 좌표
    const wz = worldMinZ + (row / 31) * worldTileSize;   // world Z 좌표
    const hmX = hmStartX + (col / 31) * hmTileSize;      // heightmap 픽셀 X
    const hmY = hmStartY + (row / 31) * hmTileSize;      // heightmap 픽셀 Y
    const wy = borderSnapHeight(hmX, hmY, row, col);                       // T-junction 제거 적용 높이
    const [nx, ny, nz] = computeHeightmapNormal(hm, hmX, hmY, pixelWorldSize);  // 법선 (중앙차분)
    const u = (wz + 256) / 512;                          // 전역 UV
    const v = 1.0 - (wx + 256) / 512;
  }
}
```

**법선 계산 (중앙차분법):**
```typescript
// buildTerrainMesh 내부에서 동적 계산
const pixelWorldSize = TERRAIN_SIZE / hm.width;  // e.g. 512/2048 = 0.25

function computeHeightmapNormal(hm, hmX, hmY, pixelWorldSize) {
  // 항상 ~2 world units 간격으로 샘플링 → 해상도 무관하게 동일한 결과
  const normalStep = Math.max(1, Math.round(2.0 / pixelWorldSize));
  // 256px → step=1, 2048px → step=8
  const slopeX = (height(+normalStep) - height(-normalStep)) / (2 * normalStep * pixelWorldSize);
  const slopeZ = (height(+normalStep) - height(-normalStep)) / (2 * normalStep * pixelWorldSize);
  return normalize(-slopeX, 1.0, -slopeZ);
}
```

**핵심 설계:** 분모 `2 * normalStep * pixelWorldSize`는 항상 ~4 world units로 고정되어, heightmap 해상도와 무관하게 동일한 조명 결과를 보장한다.

---

### 4-5. TerrainTileManager — 타일 캐시 & 생명주기

**역할:** 타일 객체의 생성/재사용/삭제를 관리하는 캐시 레이어.

```typescript
// TerrainTileManager.ts
// 핵심 상태
cache: Map<string, TerrainTile>     // "tileX_tileY_level" → 타일
bordersCache: Map<string, string>   // 타일 키 → CoarserBorders 직렬화

getOrCreate(coord, coarserBorders): TerrainTile {
  const key = tileKey(coord);  // "2_3_2"
  const bordersKey = `${+N}${+S}${+W}${+E}`;  // "0101"

  // CoarserBorders가 바뀌면 메시 재생성 필요 (T-junction 제거 변경)
  if (bordersCache.get(key) !== bordersKey) {
    this.dispose(coord);
  }

  if (!cache.has(key)) {
    const tile = new TerrainTile(coord);
    tile.mesh = buildTerrainMesh(..., coarserBorders);
    tile.state = TileState.Active;
    tile.mesh.isVisible = false;  // Renderer가 나중에 켬
    cache.set(key, tile);
  }
  return cache.get(key)!;
}
```

**타일 생명주기:**
```
Created → Active → Visible → Active → Disposed
          (mesh)   (보임)   (안보임) (mesh 제거)
```

---

### 4-6. TerrainRenderer — Quadtree 순회 & 렌더 관리

**역할:** 매 프레임 Quadtree를 순회하여 필요한 타일 집합을 결정하고 렌더링 상태를 갱신.

**Quadtree Traversal:**
```typescript
// TerrainRenderer.ts
private traverse(coord, cameraPos, frustumPlanes, visibleKeys, ...) {
  // ① AABB Frustum Culling
  const boundingBox = this.getBoundingBox(coord);
  if (!boundingBox.isInFrustum(frustumPlanes)) return;  // 화면 밖 → 조기 종료

  // ② LOD 충분성 판단
  const isSufficient =
    this.tiling.isMaxLevel(coord) ||           // 최대 레벨 도달
    this.lodSelector.isSufficientDetail(...);  // SSE < threshold

  if (isSufficient) {
    visibleKeys.add(tileKey(coord));  // ✅ 이 타일을 그린다
  } else {
    for (const child of this.tiling.getChildren(coord)) {
      this.traverse(child, ...);      // 🔽 자식으로 내려간다
    }
  }
}
```

**핵심 설계:** AABB(Axis-Aligned Bounding Box)는 타일별로 캐시(`bbCache`)에 저장. 매 프레임 재생성 비용 없음.

---

### 4-7. CameraController — RTS 방식 카메라

**역할:** ArcRotateCamera를 래핑하여 RTS(실시간 전략) 방식 카메라 조작 구현.

```typescript
// CameraController.ts
updateMovement(deltaTime: number): void {
  const forwardInput = (W ? 1 : 0) - (S ? 1 : 0);
  const rightInput = (D ? 1 : 0) - (A ? 1 : 0);

  // alpha 각도에서 XZ 평면 forward 벡터 추출
  const forward = new Vector3(-cos(alpha), 0, -sin(alpha));
  const right = Vector3.Cross(Vector3.Up(), forward).normalize();

  // 이동량을 camera.target에 누적 (카메라 위치가 아닌 주시점 이동)
  camera.target.addInPlace(forward.scale(forwardSpeed * deltaTime));
  camera.target.addInPlace(right.scale(rightSpeed * deltaTime));
}
```

**카메라 제한값:**
- `lowerBetaLimit = π/8` → 지면 수직 방지
- `upperBetaLimit = π/2 - 0.05` → 지평선 아래 방지
- `lowerRadiusLimit = 50`, `upperRadiusLimit = 2000` → 줌 범위

---

## 5. 핵심 알고리즘 심층 설명

---

### 5-1. SSE(Screen Space Error) 기반 LOD

**개념:** 타일의 "화면 픽셀 오차"를 계산하여 세분화 필요성을 판단.

```
screenError = (geometricError × projFactor) / depth

geometricError = 타일 크기 / 2        ← 이 타일이 가질 수 있는 최대 기하 오차
projFactor     = H / (2×tan(fov/2))   ← 화면 해상도와 FOV를 반영한 투영 스케일
depth          = 타일까지의 거리       ← 멀수록 작은 오차
```

**직관:** 같은 크기의 타일이라도 가까이 있으면 화면에 크게 보이므로 더 세밀하게, 멀리 있으면 작게 보이므로 거칠게.

```
[카메라]──────────────────────[타일A: 가깝다]  → screenError 크다 → 세분화
[카메라]──────────────────────────────────────[타일B: 멀다]  → screenError 작다 → 이 LOD 유지
```

---

### 5-2. T-junction 제거 — Seam 제거

**문제:** 인접 타일의 LOD 레벨이 다를 때 경계 정점 위치가 불일치 → 메시 균열(seam).

```
LOD2 타일          LOD1 타일 (2배 거친)
●─●─●─●─●         ●─────────●
│ │ │ │ │
●─●─●─●─●    ↔    (정점 없음)
│ │ │ │ │
●─●─●─●─●         ●─────────●
```

**T-junction:** LOD2 경계에 있는 "홀수번째" 정점은 LOD1 쪽에 대응하는 정점이 없음 → T-junction.

**해결책:** T-junction 정점의 높이를 양 옆 Even 정점의 선형 보간값으로 교체.

```typescript
// TerrainMeshBuilder.ts
function borderSnapHeight(hmX, hmY, row, col) {
  // coarser 방향 경계에 있는 T-junction인지 판별
  const isTJ_col = onCoarserNS && (col + tileX) % 2 !== 0;
  const isTJ_row = onCoarserWE && (row + tileY) % 2 !== 0;

  if (isTJ_col) {
    // X 방향 양 옆 평균으로 높이 교체
    return (sampleHeight(hmX - step, hmY) + sampleHeight(hmX + step, hmY)) / 2;
  }
  // ...
}
```

**결과:** 경계 정점이 부모 타일 정점 사이의 선형보간값으로 일치 → 균열 없음.

> **참고 — Skirt Geometry (제거됨):** T-junction 제거 도입 전에는 타일 4변에 아래로 내려가는 수직 폴리곤(스커트)을 추가하여 틈을 가리는 방식을 병행했다. T-junction 제거만으로 seam이 완전히 해결됨을 확인한 뒤 제거했다.

---

### 5-3. enforceConsistency — LOD 일관성 보장

**문제:** Quadtree traversal 결과 인접 타일이 2레벨 이상 차이나면 T-junction 제거 계산이 올바르지 않음.

```
나쁜 예시:
LOD4 타일 │ LOD2 타일
(세밀)    │ (거친)
          ↑ 레벨 차이 = 2 → T-junction 제거 실패
```

**해결책:** traversal 후 인접 타일 레벨 차이 > 1인 경우 coarse 타일을 강제 분할.

```typescript
// TerrainRenderer.ts
private enforceConsistency(visibleKeys, visibleCoords): void {
  let changed = true;
  while (changed && iterations++ < 20) {  // 최대 20회 반복
    changed = false;
    for (const coord of visibleCoords) {
      for (const neighbor of [상, 하, 좌, 우]) {
        // 이웃이 없으면 → ancestor 탐색
        // ancestor와 레벨 차이 > 1이면 → ancestor를 4개 자식으로 분할
        if (coord.level - ancestor.level > 1) {
          split(ancestor);  // ancestor 제거 + 4 children 추가
          changed = true;
        }
      }
    }
  }
}
```

**결과:** 모든 인접 타일의 레벨 차이 ≤ 1 보장 → T-junction 제거 항상 올바르게 동작.

---

### 5-5. Frustum Culling

**개념:** 카메라 시야 범위(Frustum) 밖의 타일은 traverse 단계에서 조기 종료.

```typescript
// TerrainRenderer.ts
const frustumPlanes = Frustum.GetPlanes(scene.getTransformMatrix());

// 각 타일에 AABB 생성 (캐시)
const bb = new BoundingBox(
  new Vector3(bounds.minX, 0, bounds.minZ),
  new Vector3(bounds.maxX, HEIGHT_SCALE, bounds.maxZ)
);

if (!bb.isInFrustum(frustumPlanes)) return;  // 화면 밖 → 이하 생략
```

**최적화 포인트:** AABB를 `bbCache`에 저장하여 매 프레임 재생성 방지.

---

## 6. 주요 상수 & 설계 결정

### 상수 (constants.ts)

| 상수 | 값 | 의미 |
|------|-----|------|
| `MAX_LOD_LEVEL` | 4 | Quadtree 최대 깊이 |
| `TERRAIN_SIZE` | 512 | 지형 총 크기 (world units) |
| `HEIGHT_SCALE` | 255 | 높이 최댓값 (world units) |
| `VERTEX_RESOLUTION` | 32 | 타일당 정점 해상도 (32×32) |

`pixelWorldSize`는 상수가 아닌 런타임 계산값: `TERRAIN_SIZE / hm.width` (256px→2.0, 2048px→0.25)

### 좌표계

```
World 좌표: X축(동서), Y축(상하), Z축(남북)
Terrain 범위: X = [-256, 256], Z = [-256, 256], Y = [0, 255]
Heightmap 원점: 좌상단 (0,0)
World 원점: Terrain 중심
```

### 전역 UV

타일 경계에서 텍스처가 끊기지 않도록 UV를 전역 좌표 기준으로 계산:
```typescript
u = (wz + TERRAIN_SIZE / 2) / TERRAIN_SIZE   // [0, 1]
v = 1.0 - (wx + TERRAIN_SIZE / 2) / TERRAIN_SIZE
```

### 타일 키 형식

```typescript
// TerrainTile.ts
tileKey({ tileX: 2, tileY: 3, level: 2 }) → "2_3_2"
// Map 키, 캐시 조회, 디버그 출력 등 전역 식별자로 사용
```

---

## 요약

이 프로젝트는 **세 가지 핵심 아이디어**의 조합으로 동작한다:

1. **SSE Quadtree LOD** — 카메라 거리와 화면 픽셀 오차를 기준으로 지형을 적응적으로 세분화
2. **T-junction 제거** — 서로 다른 LOD 레벨 타일 경계의 T-junction 정점을 보간값으로 교체하여 균열 제거
3. **Frustum Culling + 타일 캐시** — 화면 밖 연산 제거와 메시 재사용으로 성능 최적화

```
카메라 이동
    ↓
Quadtree traversal (SSE + Frustum)
    ↓
enforceConsistency (LOD 차이 ≤ 1)
    ↓
buildTerrainMesh (T-junction 제거)
    ↓
GPU 렌더링
```
