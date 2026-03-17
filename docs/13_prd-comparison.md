# PRD vs 현재 구현 비교 분석

## 개요

`docs/00_PRD.md`에 정의된 요구사항과 현재 구현 코드를 비교하여
차이점, 의도적 개선, 미구현 항목, 향후 개선 가능성을 정리한다.

---

## 1. PRD 충족 현황

| PRD 요구사항 | 현재 구현 | 상태 |
|------------|---------|------|
| Tile System (LocalGridTiling + Quadtree) | 완전 구현 | ✅ 충족 |
| Terrain Mesh (32×32 vertices, Grid) | 완전 구현 | ✅ 충족 |
| LOD Selection (camera distance 기반) | SSE 기반으로 고도화 | ⬆️ 개선됨 |
| Tile Streaming (Dynamic Generation) | 완전 구현 | ✅ 충족 |
| Frustum Culling | Babylon.js 내장 API 사용 | ✅ 충족 |
| Demo 규모 (16×16 tiles max) | Level 4 = 256 tiles (16×16) | ✅ 충족 |
| Babylon Inspector 상시 활성화 | 완전 구현 | ✅ 충족 |
| Tile Lifecycle (Loading 상태 포함) | Loading 상태 제거됨 | ⚠️ 간소화 |
| `TerrainTile.boundingVolume` 속성 | `TerrainRenderer.bbCache`로 이동 | ⚠️ 구조 변경 |
| ArcRotateCamera | UniversalCamera + RTS 스타일 | ❌ 의도적 변경 |
| WebMercatorTiling (future) | 미구현 | — 계획만 존재 |

---

## 2. PRD 대비 주요 차이점

### 2-1. 카메라 타입 변경 (의도적)

- **PRD**: `ArcRotateCamera` — 특정 지점을 중심으로 궤도(orbit) 회전
- **현재**: `UniversalCamera` + RTS 스타일
  - WASD: XZ 평면 수평 이동
  - 마우스 드래그: 시선 방향 변경
  - 마우스 휠: Y 고도 조절 (min=20)
- **변경 이유**: 지형 전체를 자유롭게 이동하며 확인하는 RTS 카메라가 더 실용적

### 2-2. LOD 알고리즘 고도화 (의도적 개선)

- **PRD**: Camera distance 고정 임계값 (`if distance < threshold → higher LOD`)
- **현재**: SSE (Screen-Space Error) 기반
  ```
  screenError = (geometricError × projFactor) / distance
  geometricError = bounds.size / 2
  projFactor = screenHeight / (2 × tan(fov / 2))
  ```
  - pixelThreshold = 200
  - FOV, 화면 해상도, 카메라 거리를 모두 반영
- **변경 이유**: 거리 기반은 화면 픽셀 크기를 반영하지 못함 → SSE가 시각적으로 더 정확하고 CesiumJS 등 실제 엔진과 동일한 방식

### 2-3. TileState.Loading 제거 (간소화)

- **PRD**: Created → **Loading** → Active → Visible → Disposed
- **현재**: Created → Active → Visible → Disposed
- **변경 이유**: Heightmap이 초기화 시 메모리에 전체 로드되어 있어, mesh 생성이 동기적으로 즉시 실행됨 → Loading 상태 불필요
- **잠재적 문제**: 타일 다수 생성 시 프레임 단위 동기 작업으로 프레임 드롭 가능성

### 2-4. TerrainTile.boundingVolume 위치 변경

- **PRD**: `TerrainTile` 클래스의 속성으로 정의
- **현재**: `TerrainRenderer.bbCache: Map<string, BoundingBox>`에 캐싱
- **변경 이유**: 2차 코드 리뷰에서 BoundingBox 재계산 회피 최적화 시 Renderer로 이동
- **영향**: `TerrainTile` 클래스가 순수 데이터 구조(coord, state, mesh)에 가까워짐

---

## 3. PRD 범위를 초과하여 추가된 구현

| 기능 | 파일 | 설명 |
|-----|------|------|
| Skirt Geometry | `TerrainMeshBuilder.ts` | 타일 경계 seam 제거 (4변 수직 메시) |
| Heightmap 법선 계산 | `TerrainMeshBuilder.ts` | 중앙차분법으로 smooth shading |
| Diffuse.exr 텍스처 | `main.ts` | 지형 시각 품질 향상 |
| Global UV 좌표계 | `TerrainMeshBuilder.ts` | 타일 간 텍스처 연속성 유지 |
| `constants.ts` 분리 | `engine/constants.ts` | 전역 상수 중앙 관리 |
| `parseTileKey()` | `TerrainTile.ts` | tileKey 역변환 유틸리티 |

---

## 4. 향후 개선 가능성

### 4-1. PRD에서 언급된 미구현 확장 항목

| 항목 | 난이도 | 설명 |
|-----|-------|------|
| `WebMercatorTiling` | 중 | `TilingScheme` 두 번째 구현체, 실제 지도 좌표계 지원 |
| Imagery Tile | 중 | 위성/도로 이미지 오버레이 레이어 |
| 3D Tiles | 고 | 3D 객체 배치 (CesiumJS 스타일) |

### 4-2. 현재 구현의 기술적 개선점

| 항목 | 문제 | 개선 방향 |
|-----|------|---------|
| 비동기 메시 생성 | 매 프레임 동기 생성으로 프레임 드롭 가능 | Web Worker + `requestIdleCallback` + Loading 상태 복원 |
| Tile Priority Queue | 카메라 거리와 무관한 생성 순서 | 거리 기반 우선순위 큐로 카메라 근처 타일 우선 로딩 |
| LRU 캐시 | 타일 수 무제한 증가 가능 | Max tile 수 제한 + LRU로 오래된 타일 자동 제거 |
| Draw Call 최적화 | 타일마다 별도 Mesh → draw call 다수 | Mesh merging 또는 Instanced mesh |
| Frustum plane 재계산 | 매 프레임 `updateTransformMatrix()` 호출 | 카메라 변경 시에만 갱신 |

---

## 5. 결론

**PRD의 핵심 목표(Tile + LOD + Streaming 엔진 구조 이해)는 완전히 달성됨.**

| 분류 | 내용 |
|-----|------|
| 개선 | LOD 알고리즘이 distance 기반 → SSE 기반으로 고도화 |
| 간소화 | Loading 상태 제거 (동기 방식에서는 불필요) |
| 변경 | ArcRotateCamera → RTS 카메라 (더 실용적인 조작) |
| 추가 | Skirt geometry, Heightmap 법선, 텍스처 (시각 품질 향상) |
| 미구현 | WebMercatorTiling, Imagery/3D Tiles (PRD "향후 확장" 항목) |

가장 실질적인 다음 단계는 **비동기 메시 생성(Loading 상태 복원)** 으로,
카메라 이동 시 발생할 수 있는 프레임 드롭을 방지하는 것이 핵심 개선점이다.
