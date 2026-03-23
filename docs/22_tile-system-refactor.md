# 22. Tile System 리팩토링 + LOD 순회 구현

## 개요

기존 `LocalGridTiling` 기반의 고정 좌표계를 서버 표준 z/x/y 타일 좌표계로 전면 교체.
기존 코드는 `src/engine/legacy/`에 격리 보존. 새 tile system 위에 SSE 기반 LOD 순회 구현.

---

## 배경 및 동기

기존 시스템의 타일 좌표는 `tileX_tileY_level` 형식의 로컬 그리드였다.
이를 웹 맵 표준인 `z/x/y` (zoom/column/row) 체계로 변경한 이유:

- 서버 타일 API와의 연동 가능성 확보
- Quadtree 구조와 자연스럽게 대응 (`getChildCoords`)
- 국제 표준 (TMS, XYZ 타일 스킴)과 호환

기존 코드는 LOD, Heightmap mesh, Frustum culling 등이 완성되어 있어
참고 로직으로 활용하기 위해 삭제 대신 `legacy/` 격리를 선택했다.

---

## 새 Tile System 구조

```
src/engine/tile/
  ├── Tile.ts            — 타일 도메인 타입
  ├── TileManager.ts     — 캐시 + 비동기 로딩
  ├── TileCoords.ts      — z/x/y → world 좌표 변환
  ├── TileLoader.ts      — DEM/Texture 로더 인터페이스 (구현 예정)
  ├── DebugTileMesh.ts   — z레벨 색상 debug ground plane
  └── LODTraverser.ts    — SSE 기반 quadtree 순회
```

---

## 핵심 타입 및 API

### Tile.ts

```ts
type TileState = "idle" | "loading" | "ready" | "error";

type Tile = {
  x: number;
  y: number;
  z: number;
  state: TileState;
  dem?: Float32Array;
  texture?: unknown;
  mesh?: Mesh;
};

function tileKey(x, y, z): string  // "z/x/y"
```

### TileCoords.ts

```ts
// z/x/y → world 좌표 bounds
// tileSize = TERRAIN_SIZE / 2^z
// worldX = x * tileSize - TERRAIN_SIZE/2
// worldZ = -y * tileSize + TERRAIN_SIZE/2  (tile y 아래 방향 → Babylon Z 음수 방향)
function getTileBounds(x, y, z): TileBounds

// 4개 자식 좌표 반환
function getChildCoords(x, y, z): [number, number, number][]
// → [2x, 2y, z+1], [2x+1, 2y, z+1], [2x, 2y+1, z+1], [2x+1, 2y+1, z+1]
```

### TileManager.ts

```ts
class TileManager {
  getTile(x, y, z): CachedTile       // 없으면 idle 상태로 생성
  hasTile(x, y, z): boolean
  load(x, y, z, loader): Promise<void> // inflight 중복 방지
  disposeTile(x, y, z): void
  getAllTiles(): CachedTile[]
}
```

---

## DebugTileMesh

LOD 알고리즘 검증을 위한 시각화 도구. 실제 heightmap 연동 없이 z레벨을 색상으로 구분.

| z레벨 | 색상 |
|-------|------|
| 0     | 빨강 |
| 1     | 초록 |
| 2     | 파랑 |
| 3     | 노랑 |
| 4     | 마젠타 |
| 5+    | 청록 (modulo) |

구현 특징:
- `MeshBuilder.CreateGround` (flat plane, XZ)
- `alpha = 0.5` → 반투명 (여러 레벨 겹쳐 보임)
- `disableDepthWrite = true` → 반투명 레이어 간 depth 차단 방지
- `backFaceCulling = false` → 아래에서 봐도 보임
- `EPSILON * tile.z` y offset → z-fighting 방지
- material cache (`Map<number, StandardMaterial>`) → z레벨당 1개 재사용

```ts
createDebugTileMesh(tile, bounds, scene): Mesh
disposeDebugTileMesh(tile): void
disposeDebugMaterialCache(): void
```

---

## LODTraverser — SSE 기반 LOD 순회

### 알고리즘 (legacy LODSelector.ts에서 계승)

```
screenError = (geometricError × projFactor) / effectiveDepth

geometricError = bounds.size / 2
forward = normalize(camera.target - camera.position)
depth = dot(tileCenter - cameraPos, forward)        // forward 방향 투영 거리
effectiveDepth = max(depth, euclidean * 0.5, 1)     // 발밑 타일 폭발 방지
projFactor = screenHeight / (2 × tan(fov / 2))
```

`screenError > PIXEL_THRESHOLD(150)` → 분할, 아니면 현재 레벨로 렌더.

### 핵심 설계 결정

- **camera forward 투영 거리** 사용 (euclidean 거리 아님):
  카메라 바로 아래 타일이 항상 최고 레벨로 분할되는 문제 방지.
  `effectiveDepth = max(depth, euclidean * 0.5)` 로 보정.

- **매 프레임 전체 순회** (diff 기반 syncTiles):
  이전 프레임 visible set과 비교하여 추가/제거 타일만 mesh 생성/dispose.

```ts
class LODTraverser {
  update(camera: ArcRotateCamera): void  // render loop에서 매 프레임 호출
}
```

### main.ts 연동

```ts
const traverser = new LODTraverser(tileManager, scene);

engine.runRenderLoop(() => {
  traverser.update(camera.camera);  // CameraController.camera → ArcRotateCamera
  scene.render();
});
```

---

## 좌표계 규약

| 항목 | 값 |
|------|----|
| World 크기 | 512 × 512 units |
| 원점 | 지형 중심 (0, 0, 0) |
| tile y 방향 | 아래 증가 (서버 표준) |
| Babylon Z 방향 | tile y와 반대 (음수 반전) |
| 최대 LOD 레벨 | 4 (타일 수 256개) |
| SSE 임계값 | 150 px |

---

## Legacy 보존 위치

`src/engine/legacy/` — 기존 구현 전체 보존 (참고용, 빌드에 미포함)

| 파일 | 역할 |
|------|------|
| `lod/LODSelector.ts` | SSE 계산 (현 LODTraverser의 원형) |
| `terrain/TerrainMeshBuilder.ts` | Heightmap → mesh (향후 연동 대상) |
| `terrain/TerrainTileManager.ts` | 타일 라이프사이클 |
| `renderer/TerrainRenderer.ts` | Quadtree + Frustum culling |
| `tiling/LocalGridTiling.ts` | 구 좌표계 |

---

## 현재 미구현 항목 (향후 Phase)

- `TileLoader.ts` 구현 — 실제 DEM/텍스처 로드
- Heightmap 기반 TerrainMeshBuilder 연동
- Frustum culling (LODTraverser에 추가 예정)
- LOD 인접 타일 consistency enforcement (T-junction 방지)
