# 20. 단일 책임 원칙(SRP) 리팩토링

## 개요

"한 파일은 하나의 메인 기능만 담당해야 한다"는 Clean Code 원칙 적용.
`TerrainMeshBuilder.ts`에 혼재된 책임들을 도메인 기반 폴더로 분리.

**디렉터리 전략**: `utils/` 같은 catch-all 폴더 대신,
프로젝트 기존 도메인 기반 폴더 구조(`terrain/`, `lod/`, `camera/` 등)와 일관성을 유지.

---

## 분리 1: HeightmapLoader

### 문제

`TerrainMeshBuilder.ts`의 책임은 "heightmap 데이터로 mesh 생성"이지만,
"heightmap을 어떻게 로드하느냐(Image API, Canvas 2D)"까지 담당하고 있었음.
I/O 로직과 지오메트리 연산은 다른 도메인.

### 변경

`HeightmapData` 인터페이스와 `loadHeightmap()` 함수를 신규 도메인 폴더로 이동.

**신규 파일**: `src/engine/heightmap/HeightmapLoader.ts`

```
src/engine/heightmap/
└── HeightmapLoader.ts   ← HeightmapData 인터페이스, loadHeightmap() 함수
```

**이후 의존 관계**:
- `TerrainMeshBuilder.ts` → `HeightmapLoader.ts` (HeightmapData import)
- `TerrainTileManager.ts` → `HeightmapLoader.ts` (HeightmapData import)
- `main.ts` → `HeightmapLoader.ts` (loadHeightmap import)

---

## 분리 2: CoarserBorders

### 문제

`CoarserBorders`는 타일 간 LOD 위상(topology) 정보 타입인데
`TerrainMeshBuilder.ts`에 정의되어 있었음.
결과적으로 `TerrainTileManager`, `TerrainRenderer` 모두 mesh 빌딩 파일을 거쳐 타입을 import 중
→ 논리적으로 무관한 의존성 발생.

### 변경

`CoarserBorders`를 타일 관련 타입들이 모여있는 `TerrainTile.ts`로 이동.

```typescript
// src/engine/terrain/TerrainTile.ts 에 추가
export interface CoarserBorders {
  N: boolean;
  S: boolean;
  W: boolean;
  E: boolean;
}
```

**이후 의존 관계**:
- `TerrainMeshBuilder.ts` → `TerrainTile.ts` (CoarserBorders import)
- `TerrainTileManager.ts` → `TerrainTile.ts` (CoarserBorders import, 기존 TerrainMeshBuilder 경유 제거)
- `TerrainRenderer.ts` → `TerrainTile.ts` (CoarserBorders import, 기존 TerrainMeshBuilder 경유 제거)

---

## 분리하지 않은 항목

| 항목 | 이유 |
|------|------|
| `tileKey()` / `parseTileKey()` | `TileCoord` 타입과 1:1 결합. 분리하면 역방향 의존 발생 |
| `TileBounds` | `TilingScheme` 인터페이스의 반환 타입. 인터페이스와 함께 있어야 응집도 유지 |
| `sampleHeight()` / `computeHeightmapNormal()` | `TerrainMeshBuilder` 내부 전용 헬퍼. 외부 노출 없음 |
| `computeCoarserBorders()` | `TerrainRenderer` private 메서드. 추출 시 테스트 없이 복잡도만 증가 |

---

## 최종 디렉터리 구조

```
src/engine/
├── heightmap/
│   └── HeightmapLoader.ts    ← HeightmapData, loadHeightmap() [신규]
├── terrain/
│   ├── TerrainTile.ts        ← TileCoord, TileState, TerrainTile, CoarserBorders
│   ├── TerrainTileManager.ts
│   └── TerrainMeshBuilder.ts ← 순수하게 mesh 생성 로직만
├── lod/LODSelector.ts
├── tiling/TilingScheme.ts + LocalGridTiling.ts
├── camera/CameraController.ts
├── renderer/TerrainRenderer.ts
├── debug/DebugCameraOverlay.ts
└── constants.ts
```

---

## 수정 파일

| 파일 | 변경 |
|------|------|
| `src/engine/heightmap/HeightmapLoader.ts` | **신규**: `HeightmapData`, `loadHeightmap()` |
| `src/engine/terrain/TerrainMeshBuilder.ts` | `HeightmapData`/`loadHeightmap`/`CoarserBorders` 제거, import 경로 수정 |
| `src/engine/terrain/TerrainTile.ts` | `CoarserBorders` 인터페이스 추가 |
| `src/engine/terrain/TerrainTileManager.ts` | import 경로 수정 |
| `src/engine/renderer/TerrainRenderer.ts` | import 경로 수정 |
| `src/main.ts` | `loadHeightmap` import 경로 수정 |
| `CLAUDE.md` | 디렉터리 구조 업데이트 |
