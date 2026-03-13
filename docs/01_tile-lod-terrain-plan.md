# Tile + LOD 기반 지형 렌더링 시스템 구현 계획

## Context

PRD 기반으로 Babylon.js + TypeScript를 사용한 Heightmap 기반 Tile LOD 지형 렌더링 엔진을 처음부터 구현한다.
지도 엔진의 핵심 구조(Tile System, LOD, Tile Streaming, Frustum Culling)를 학습하고 검증하는 것이 목적이다.

**사용자 선택:**
- 빌드 도구: Vite + TypeScript
- Heightmap: 256×256 PNG 이미지 파일 (assets에 포함)
- LOD 레벨: 4단계 (Level 0~3, 최대 64 tiles = 8×8)

---

## 프로젝트 구조

```
Tile/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   └── heightmap.png          ← 256×256 흑백 PNG (grayscale)
└── src/
    ├── main.ts                ← 진입점, Scene 초기화
    └── engine/
        ├── camera/
        │   └── CameraController.ts
        ├── tiling/
        │   ├── TilingScheme.ts       ← interface
        │   └── LocalGridTiling.ts    ← 구현체
        ├── terrain/
        │   ├── TerrainTile.ts
        │   ├── TerrainTileManager.ts
        │   └── TerrainMeshBuilder.ts
        ├── lod/
        │   └── LODSelector.ts
        └── renderer/
            └── TerrainRenderer.ts
```

---

## 핵심 설계 결정

### LOD 레벨 스펙

| Level | 타일 수 | 타일당 heightmap 샘플 영역 |
|-------|---------|--------------------------|
| 0     | 1       | 256×256 px               |
| 1     | 4       | 128×128 px               |
| 2     | 16      | 64×64 px                 |
| 3     | 64      | 32×32 px                 |

- 각 타일 mesh: 32×32 vertices (PRD 명세)
- LOD 전환 기준 (camera distance 임계값): Level 0→1: 400, 1→2: 200, 2→3: 100 (조정 가능)

### Heightmap UV 샘플링

- 타일 (tileX, tileY, level)의 heightmap 샘플 영역:
  - `tileSize = 256 / 2^level`
  - 시작점: `(tileX * tileSize, tileY * tileSize)`
- Bounding Box: AABB (Babylon.js BoundingBox 활용)

### World 좌표 스펙

- Terrain 크기: **512 × 512 units** (world space)
- heightmap 1px = 2 world units (256px × 2 = 512)

### Babylon Inspector

- **상시 활성화** (연습용 데모이므로 항상 켜둠)

### Heightmap 전제

- `public/heightmap.png`는 **반드시 존재**한다고 가정, 폴백 없음

### Wireframe

- 기본값: **solid** (Inspector에서 필요 시 전환)

### Frustum Culling

- Babylon.js 내장 `Frustum.GetPlanes()` + `BoundingBox.IsInFrustum()` 사용

---

## 구현 단계 (Step-by-Step)

### Step 1 — 프로젝트 셋업

파일 생성:
- `package.json`: vite, typescript, @babylonjs/core 의존성
- `vite.config.ts`
- `tsconfig.json`
- `index.html`: `<canvas id="renderCanvas">`

### Step 2 — 공통 타입 정의

파일: `src/engine/terrain/TerrainTile.ts`

```typescript
export interface TileCoord {
  tileX: number;
  tileY: number;
  level: number;
}

export enum TileState {
  Created = 'Created',
  Loading = 'Loading',
  Active = 'Active',
  Visible = 'Visible',
  Disposed = 'Disposed',
}

export class TerrainTile {
  coord: TileCoord;
  state: TileState;
  mesh: Mesh | null;
  boundingBox: BoundingBox | null;
}
```

### Step 3 — TilingScheme

파일: `src/engine/tiling/TilingScheme.ts`, `LocalGridTiling.ts`

- `TilingScheme` 인터페이스: `tileBoundsToWorld(coord)`, `getChildren(coord)`, `getRoot()`
- `LocalGridTiling` 구현: 정규화된 [0,1] 공간 → world 공간 변환

### Step 4 — TerrainMeshBuilder

파일: `src/engine/terrain/TerrainMeshBuilder.ts`

- heightmap PNG 로드 (Canvas 2D API로 픽셀값 추출)
- `buildMesh(scene, coord, heightmapData, heightScale)`:
  - 32×32 vertices 생성
  - 타일 UV 영역에서 픽셀값 샘플링
  - height = pixelValue / 255 * heightScale
  - triangle indices 생성 (31×31 cells × 2 triangles)
  - Babylon.js `VertexData` 적용

### Step 5 — LODSelector

파일: `src/engine/lod/LODSelector.ts`

```typescript
selectLevel(cameraPos: Vector3, tileBounds: BoundingBox): number
```

- tile 중심까지의 camera distance 계산
- 임계값 기반으로 LOD level 반환 (0~3)
- geometric error 개념 적용 (distance / tileSize)

### Step 6 — CameraController

파일: `src/engine/camera/CameraController.ts`

- `ArcRotateCamera` 래핑
- 카메라 이동 이벤트 시 콜백 호출 (TerrainRenderer에 알림)

### Step 7 — TerrainTileManager

파일: `src/engine/terrain/TerrainTileManager.ts`

- 타일 캐시: `Map<string, TerrainTile>` (key: `"tileX_tileY_level"`)
- `getOrCreate(coord)`: 캐시에 없으면 생성 → Loading → mesh build → Active
- `dispose(coord)`: mesh dispose, 캐시에서 제거
- `updateVisibility(frustumPlanes)`: 각 Active 타일 frustum check → Visible/Active 전환

### Step 8 — TerrainRenderer (Quadtree Traversal)

파일: `src/engine/renderer/TerrainRenderer.ts`

매 프레임 실행:

1. Camera frustum planes 계산
2. Quadtree traversal (재귀):
   - root tile(level=0)부터 시작
   - LODSelector로 현재 level이 적절한지 판단
   - 적절하면 → 해당 tile을 visible set에 추가
   - 더 세밀해야 하면 → 4개 자식 tile로 재귀
3. visible set과 현재 active tiles 비교
4. 새로 필요한 tiles → getOrCreate
5. 더 이상 필요 없는 tiles → dispose
6. Frustum culling으로 visible/active 상태 업데이트

### Step 9 — main.ts 진입점

- Babylon.js Engine, Scene 생성
- `CameraController`, `TerrainRenderer` 초기화
- `engine.runRenderLoop()` 실행

---

## Heightmap 이미지 준비

- 256×256 흑백 PNG를 `public/heightmap.png`에 배치
- 간단한 산/계곡 형태 (Photoshop, GIMP, 또는 온라인 생성기 사용 가능)
- heightScale: 50 (기본값, 조정 가능)

---

## 검증 방법

### 단계별 확인

1. Vite dev server 실행 → canvas에 Babylon.js scene 표시 확인
2. Heightmap 로드 → flat이 아닌 terrain mesh가 보이는지 확인
3. 카메라 이동 → LOD 전환 확인 (Babylon Inspector에서 mesh 수 변화)
4. Tile 생성/소멸 → console.log로 tile lifecycle 추적

### Babylon Inspector 활용

- `Inspector.Show(scene, {})` 추가
- Mesh 탭에서 tile mesh 수, bounding volume, LOD 레벨 확인

### 성능 체크

- Frame rate 확인 (목표: 60fps)
- 동시 active tile 수 모니터링

---

## 구현 순서 우선순위

1. 셋업 + basic scene (Step 1, main.ts)
2. TerrainMeshBuilder (heightmap → single mesh)
3. TilingScheme + TerrainTile 타입
4. LODSelector + TerrainTileManager
5. TerrainRenderer (Quadtree traversal)
6. CameraController 연동
