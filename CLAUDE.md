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
        ├── tiling/
        │   ├── TilingScheme.ts    ← interface
        │   └── LocalGridTiling.ts
        ├── terrain/
        │   ├── TerrainTile.ts     ← TileCoord, TileState, TerrainTile
        │   ├── TerrainTileManager.ts
        │   └── TerrainMeshBuilder.ts
        ├── lod/LODSelector.ts
        └── renderer/TerrainRenderer.ts
```

## 핵심 아키텍처 결정

### LOD 레벨 (4단계)

| Level | 타일 수 | Heightmap 샘플 영역 |
|-------|---------|---------------------|
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
- 높이 계산: `height = pixelValue / 255 * heightScale` (heightScale = 480)

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

`UniversalCamera` 기반. 초기 위치 `(0, 500, 0)` — 지형 정중앙 위에서 내려다보는 시점.

| 입력 | 동작 |
|------|------|
| W / ↑ | 앞으로 이동 |
| S / ↓ | 뒤로 이동 |
| A / ← | 왼쪽으로 이동 |
| D / → | 오른쪽으로 이동 |
| 마우스 클릭+드래그 | 시선 방향 변경 |
| 마우스 휠 위 | 카메라 고도 감소 (줌인) |
| 마우스 휠 아래 | 카메라 고도 증가 (줌아웃) |

- 이동 속도: `camera.speed = 5`
- 휠 고도 최솟값: Y = 20
- `attachControl(canvas, true)` — Babylon.js 기본 입력 사용 (줌/궤도 없음)

### Babylon Inspector

- **상시 활성화** — 연습용 데모이므로 항상 켜둠
- `Inspector.Show(scene, {})` main.ts에서 호출

### Heightmap 전제

- `public/heightmap.png`는 **반드시 존재**한다고 가정
- 폴백(절차적 생성 등) 없음

### Wireframe

- 기본값: **solid**
- Inspector에서 필요 시 전환

## 코드 컨벤션

- 모든 엔진 클래스는 `src/engine/` 하위에 위치
- TileCoord key 형식: `"tileX_tileY_level"` (캐시 Map key)
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

| 번호 | 파일 | 설명 |
| --- | --- | --- |
| 00 | `00_PRD.md` | 최초 PRD (원본) |
| 01 | `01_tile-lod-terrain-plan.md` | 1차 구현 계획 |
| 02 | `02_debug-history.md` | 초기 버그 디버깅 히스토리 |
| 03 | `03_visual-quality-plan.md` | 지형 시각 품질 개선 계획 (조명·머티리얼·버텍스 컬러) |
| 04 | `04_lod-camera-bugfix.md` | LOD 기준점 버그 수정 (camera.position → camera.target) |
| 05 | `05_wheel-lod-bugfix.md` | 휠 고도 조절 기능 추가 + LOD 버그 2개 수정 (maxLevel 4, traverse frustum culling) |
| 06 | `06_diffuse-texture.md` | Diffuse.exr 텍스처 적용 및 UV 방향 수정 (global UV, 버텍스 컬러 제거) |

새 계획 수립 시 `NN_제목.md` 형식으로 추가.
