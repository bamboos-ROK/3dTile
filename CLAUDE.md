# CLAUDE.md — Tile LOD Terrain 프로젝트

## 프로젝트 목적

Heightmap 기반 **Tile + LOD 지형 렌더링 시스템** 구현.
지도 엔진의 핵심 구조(Tile System, LOD, Tile Streaming, Frustum Culling)를 학습/검증하는 데모 프로젝트.

## 기술 스택

- **Babylon.js** (`@babylonjs/core` v7)
- **TypeScript** + **Vite**
- 개발 서버: `npm run dev` (포트 3000)

## 디렉토리 구조

```
Tile/
├── CLAUDE.md
├── docs/                          ← 계획 문서 아카이브 (번호 순)
├── public/
│   └── heightmap.png              ← 256×256 흑백 PNG
└── src/
    ├── main.ts
    └── engine/
        ├── camera/CameraController.ts
        ├── heightmap/
        │   └── HeightmapLoader.ts ← HeightmapData, loadHeightmap
        ├── tiling/
        │   ├── TilingScheme.ts    ← interface, TileBounds
        │   └── LocalGridTiling.ts
        ├── terrain/
        │   ├── TerrainTile.ts     ← TileCoord, TileState, TerrainTile, CoarserBorders
        │   ├── TerrainTileManager.ts
        │   └── TerrainMeshBuilder.ts
        ├── lod/LODSelector.ts
        └── renderer/TerrainRenderer.ts
```

## 핵심 아키텍처 결정

### LOD 레벨 (4단계)

| Level | 타일 수 | Heightmap 샘플 영역 |
| ----- | ------- | ------------------- |
| 0     | 1       | 256×256 px          |
| 1     | 4       | 128×128 px          |
| 2     | 16      | 64×64 px            |
| 3     | 64      | 32×32 px            |
| 4     | 256     | 16×16 px            |

- LOD 전환 임계값: Level 0→1: 400, 1→2: 200, 2→3: 100, 3→4: 50 (camera distance)

### Heightmap 스펙

- 해상도: 256×256 px, 흑백 PNG
- 위치: `public/heightmap.png`
- 로드 방식: Canvas 2D API (`getImageData`)
- 높이 계산: `height = pixelValue / 255 * heightScale` (heightScale = 255)

### Tile 스펙

- Mesh 해상도: 32×32 vertices (31×31 cells × 2 triangles)
- Bounding Box: AABB
- Tile 공간: Local Grid (정규화 좌표 [0,1] → world 좌표)

### World 좌표 스펙

- Terrain 크기: **512 × 512 units** (world space)
- heightmap 1px = 2 world units (256px × 2 = 512)

### Frustum Culling

Babylon.js 내장 API 사용:

- `Frustum.GetPlanes(transformMatrix)`
- `BoundingBox.IsInFrustum(frustumPlanes)`

### Tile Lifecycle

```
Created → Loading → Active ↔ Visible → Disposed
```

### Camera 조작

`UniversalCamera` 기반. 초기 위치 `(-100, 800, 300)` — 지형 바깥에서 비스듬히 내려다보는 시점.

| 입력               | 동작                      |
| ------------------ | ------------------------- |
| W / ↑              | 앞으로 이동               |
| S / ↓              | 뒤로 이동                 |
| A / ←              | 왼쪽으로 이동             |
| D / →              | 오른쪽으로 이동           |
| 마우스 클릭+드래그 | 시선 방향 변경            |
| 마우스 휠 위       | 카메라 고도 감소 (줌인)   |
| 마우스 휠 아래     | 카메라 고도 증가 (줌아웃) |

- 이동 속도: `camera.speed = 5`
- 휠 고도 최솟값: Y = 20
- `attachControl(canvas, true)` — Babylon.js 기본 입력 사용 (줌/궤도 없음)

### Babylon Inspector

- **상시 활성화** — 연습용 데모이므로 항상 켜둠
- `scene.debugLayer.show({ embedMode: true })` main.ts에서 호출

### Heightmap 전제

- `public/heightmap.png`는 **반드시 존재**한다고 가정
- 폴백(절차적 생성 등) 없음

### Wireframe

- 기본값: **solid**
- Inspector에서 필요 시 전환

## 코드 컨벤션

- 모든 엔진 클래스는 `src/engine/` 하위에 위치
- TileCoord key 형식: `"z/x/y"` (캐시 Map key, 서버 표준)
- 클래스명: PascalCase, 파일명: PascalCase.ts
- Babylon.js import: `@babylonjs/core`에서 named import

## 개발 명령어

```bash
npm run dev      # 개발 서버 실행 (http://localhost:3000)
npm run build    # 프로덕션 빌드
```

## 현재 구현 상태

> 세션 재개 시 이 체크리스트를 기준으로 다음 Step을 파악한다.
> Step 완료 시 Claude가 즉시 업데이트한다.

- [x] Step 1 — 프로젝트 셋업 (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `git init`)
- [x] Step 2 — 공통 타입 정의 (`TerrainTile.ts`)
- [x] Step 3 — TilingScheme + LocalGridTiling
- [x] Step 4 — TerrainMeshBuilder (heightmap → mesh)
- [x] Step 5 — LODSelector
- [x] Step 6 — CameraController
- [x] Step 7 — TerrainTileManager
- [x] Step 8 — TerrainRenderer (Quadtree Traversal)
- [x] Step 9 — main.ts 진입점 + npm install + 동작 확인
- [x] Step 10 — 타일 seam 수정 (Heightmap 법선 + Skirt geometry)
- [x] Step 11 — 디버그 카메라 (DebugCameraOverlay: F키 전환, LOD 색상 시각화)
- [x] Step 12 — Tile System 리팩토링 (z/x/y 좌표계, TileManager, TileCoords, 기존 코드 legacy/ 격리)
- [x] Step 13 — LODTraverser (SSE 기반 quadtree 순회, debug ground plane 연동)

---

## 세션 연속성 규칙

새 세션이 시작되면 Claude는 아래 순서로 상태를 파악한 뒤 작업을 재개한다.

### 1. 현재 구현 상태 파악

```bash
# 어떤 파일이 존재하는지 확인
ls -R src/
```

- `src/` 파일 목록을 확인하여 이미 구현된 파일을 파악한다.
- 구현 계획은 `docs/` 폴더의 가장 최신 번호 문서를 읽는다.

### 2. 구현 진행 기준

`docs/` 최신 계획 문서의 **구현 단계(Step)**를 기준으로 삼는다.

- 파일이 존재하면 → 해당 Step 완료로 간주
- 파일이 없으면 → 해당 Step부터 재개

### 3. 구현 재개 방식

- 사용자에게 현재 상태를 간략히 보고한 뒤 바로 다음 Step을 진행한다.
- 불필요한 재질문 없이 계획 문서 기준으로 자율 판단하여 진행한다.

### 4. 새 계획 수립 시

- 새 `docs/NN_제목.md`를 추가한다.
- CLAUDE.md의 **문서 아카이브 규칙** 표도 업데이트한다.

---

## 문서 아카이브 규칙

`docs/` 폴더에 생성 순서대로 번호를 붙여 저장한다.

| 번호 | 파일                          | 설명                                                                                                                        |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 00   | `00_PRD.md`                   | 최초 PRD (원본)                                                                                                             |
| 01   | `01_tile-lod-terrain-plan.md` | 1차 구현 계획                                                                                                               |
| 02   | `02_debug-history.md`         | 초기 버그 디버깅 히스토리                                                                                                   |
| 03   | `03_visual-quality-plan.md`   | 지형 시각 품질 개선 계획 (조명·머티리얼·버텍스 컬러)                                                                        |
| 04   | `04_lod-camera-bugfix.md`     | LOD 기준점 버그 수정 (camera.position → camera.target)                                                                      |
| 05   | `05_wheel-lod-bugfix.md`      | 휠 고도 조절 기능 추가 + LOD 버그 2개 수정 (maxLevel 4, traverse frustum culling)                                           |
| 06   | `06_diffuse-texture.md`       | Diffuse.exr 텍스처 적용 및 UV 방향 수정 (global UV, 버텍스 컬러 제거)                                                       |
| 07   | `07_rts-camera.md`            | RTS 카메라 구현 (XZ 수평 이동 분리, 휠 고도 전용)                                                                           |
| 08   | `08_uv-offset-bugfix.md`      | UV 오프셋 버그 수정 (중앙 원점 좌표계에서 텍스처 2×2 분할 문제)                                                             |
| 09   | `09_tile-seam-fix.md`         | 타일 경계 seam 수정 (Heightmap 법선 + Skirt geometry, Known Issues 포함)                                                    |
| 10   | `10_refactor-code-review.md`  | 코드 리뷰 리팩토링 (안티패턴 제거, constants.ts 분리, material 책임 이동 등)                                                |
| 11   | `11_lod-sse.md`               | SSE 기반 LOD 구현 및 기준점 실험 히스토리 (camera.position + pixelThreshold=150 확정)                                       |
| 12   | `12_code-review-2.md`         | 2차 코드 리뷰 (Dead Field 제거, BoundingBox 캐싱, parseTileKey 분리, TileState.Loading 제거)                                |
| 13   | `13_prd-comparison.md`        | PRD vs 현재 구현 비교 분석 (충족 현황, 주요 차이점, 향후 개선 가능성)                                                       |
| 14   | `14_arc-rotate-camera.md`     | ArcRotateCamera 리팩토링 (UniversalCamera → ArcRotateCamera, radius 줌, beta/radius 제한값)                                 |
| 15   | `15_debug-camera.md`          | 디버그 카메라 구현 (F키 전환, LOD 레벨 색상 오버레이)                                                                       |
| 16   | `16_lod-depth-projection.md`  | LOD 거리 계산 개선 (AABB 최근접점 → camera forward depth 투영)                                                              |
| 17   | `17_lod-seam-fix.md`          | LOD 경계 균열 수정 (enforceConsistency + BVS 방향별 조건부 적용, CoarserBorders)                                            |
| 18   | `18_debug-camera-bugfix.md`   | 디버그 카메라 버그픽스 (LOD 색상 미적용, 카메라 이중입력/detach 누락/target 드리프트 수정)                                  |
| 19   | `19_code-review-3.md`         | 3차 코드 리뷰 버그픽스 (updateVisibility P0, parseTileKey 검증, enforceConsistency 반복 제한, bbCache 정리, 매직 넘버 주석) |
| 20   | `20_srp-refactor.md`          | 단일 책임 원칙 리팩토링 (HeightmapLoader 도메인 분리, CoarserBorders TerrainTile로 이동)                                    |
| 21   | `21_code-explanation.md`      | 발표용 코드 설명 문서 (아키텍처, 데이터 흐름, 핵심 알고리즘 설명)                                                           |
| 22   | `22_tile-system-refactor.md`  | Tile System 리팩토링 (z/x/y 좌표계, TileManager, DebugTileMesh, LODTraverser SSE 순회)                                      |
| 23   | `23_debug-camera-second.md`   | 디버그용 두 번째 카메라 추가 (debug 인자, 키 분기: 메인=방향키, 디버그=WASD)                                                |
| 24   | `24_tileloader-fallback.md`   | TileLoader 분리 및 디버그 타일 폴백 구조 (LODTraverser tileLoader 파라미터, 실패 시 디버그 메시 폴백, TileManager re-throw 버그 수정) |
| 25   | `25_quantized-mesh-loader.md` | Quantized-Mesh TileLoader 구현 및 디버깅 (URL 패턴, EPSG:4326 TMS 좌표계, HWM decode, alignment padding 버그, winding 반전 수정, debug/real 타일 시각 구분) |

새 계획 수립 시 `NN_제목.md` 형식으로 추가.
