# 10. 코드 리뷰 리팩토링

## 목적

전체 프로젝트 코드 리뷰를 통해 문서-코드 불일치, 안티패턴, 중복 코드, 불필요한 코드를 제거한다.

---

## 변경 내역

### A. 문서-코드 불일치 수정

| 항목 | 수정 전 | 수정 후 |
|------|---------|---------|
| `CLAUDE.md` 카메라 초기 위치 | `(0, 500, 0)` | `(-100, 800, 300)` |
| `CLAUDE.md` Inspector 호출 | `Inspector.Show(scene, {})` | `scene.debugLayer.show({ embedMode: true })` |
| `LocalGridTiling.ts` 주석 | Level 0~3만 나열 | Level 4 추가 |

### B. 매직 넘버 분산 해소 → `src/engine/constants.ts` 신규 생성

지형 핵심 파라미터 3개를 단일 파일로 통합:

```ts
export const TERRAIN_SIZE = 512;   // 지형 world 크기
export const HEIGHT_SCALE = 480;   // 높이맵 최대 높이
export const MAX_LOD_LEVEL = 4;    // Quadtree 최대 LOD 레벨
```

- `TerrainMeshBuilder.ts` — `HEIGHT_SCALE`, `TERRAIN_SIZE` 선언 제거, constants에서 import
- `TerrainTileManager.ts`, `TerrainRenderer.ts` — `HEIGHT_SCALE` import 경로 변경
- `LODSelector.ts` — 생성자 기본값 `480`, `4` → `HEIGHT_SCALE`, `MAX_LOD_LEVEL`
- `LocalGridTiling.ts` — 생성자 기본값 `512`, `4` → `TERRAIN_SIZE`, `MAX_LOD_LEVEL`
- `main.ts` — `new LocalGridTiling(4, 512)` → `new LocalGridTiling()`, `new LODSelector(4)` → `new LODSelector()`

### C. 의미없는 상수 제거

`CameraController.ts`의 `ZOOM_SPEED = 1.0` 제거.
`e.deltaY * 1.0`은 no-op이므로 `e.deltaY` 직접 사용.

### D. Inline import type 제거 (안티패턴)

`TerrainRenderer.ts` traverse 파라미터의 inline import:
```ts
// 수정 전
frustumPlanes: import('@babylonjs/core/Maths/math.plane').Plane[]
// 수정 후 (파일 상단에 import type 추가)
frustumPlanes: Plane[]
```

### E. 이중 Frustum Culling 제거

`traverse()`에서 frustum 밖 타일은 이미 `visibleKeys`에서 제외되므로
`updateVisibility()`의 중복 frustum 체크 제거.

- `TerrainTileManager.updateVisibility()` 시그니처: `(visibleKeys, frustumPlanes)` → `(visibleKeys)`
- 내부 `isInFrustum()` 체크 제거

### F. 불필요한 상태 변경 제거

`TerrainTileManager.dispose()`에서 `tile.state = TileState.Disposed` 제거.
`cache.delete()` 직후라 아무도 읽을 수 없는 dead code였음.

### G. 디버그 console.log 제거

- `TerrainMeshBuilder.loadHeightmap()` — R채널 통계(min/max/avg) 및 코너값 로그 3개 제거
- `TerrainTileManager` — Created/Disposed 로그 제거

### H. Material 생성 책임 이동

`buildTerrainMesh()` 내부에서 material 싱글턴을 생성하던 코드를 `main.ts`로 이동.
`buildTerrainMesh`는 `material: StandardMaterial` 파라미터를 받아 단순 할당만 수행.

```
수정 전: buildTerrainMesh(scene, coord, hm, minX, minZ, size)
수정 후: buildTerrainMesh(scene, coord, hm, minX, minZ, size, material)
```

---

## 수정 파일 목록

| 파일 | 변경 유형 |
|------|---------|
| `src/engine/constants.ts` | 신규 생성 |
| `src/engine/terrain/TerrainMeshBuilder.ts` | 상수 제거·import 교체, 디버그 로그 제거, material 파라미터 추가 |
| `src/engine/terrain/TerrainTileManager.ts` | 상수 import 교체, 디버그 로그 제거, TileState.Disposed 제거, material 파라미터 수용, updateVisibility 단순화 |
| `src/engine/renderer/TerrainRenderer.ts` | Plane import 정상화, HEIGHT_SCALE import 교체, updateVisibility 호출 단순화 |
| `src/engine/camera/CameraController.ts` | ZOOM_SPEED 제거 |
| `src/engine/lod/LODSelector.ts` | 생성자 기본값 상수 교체 |
| `src/engine/tiling/LocalGridTiling.ts` | 생성자 기본값 상수 교체, 주석 Level 4 추가 |
| `src/main.ts` | material 생성 로직 추가, 불필요 인수 제거 |
| `CLAUDE.md` | 카메라 초기 위치·Inspector 방식 수정 |
