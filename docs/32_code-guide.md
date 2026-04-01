# 코드 가이드 — Tile LOD Terrain 렌더러

> 이 문서는 코드 리딩 목적으로 작성된 참조 문서입니다.
> 구현 결정 이유, 핵심 알고리즘, 디버깅 진입점을 중심으로 설명합니다.

---

## 0. 용어 사전 (Glossary)

코드를 읽다가 막히는 전문 용어 정리.

- **SSE** (Screen Space Error): 타일이 화면에서 차지하는 픽셀 오차. `(geometricError × projFactor) / effectiveDepth`로 계산. 이 값이 임계값을 초과하면 타일을 쪼갬(split).
- **HWM** (Horizon Occlusion Point): Cesium quantized-mesh 스펙의 인덱스 인코딩 방식. "highest watermark" 알고리즘으로 인덱스를 delta-encode함. 파싱 시 역산이 필요함.
- **Quantized-Mesh 1.0**: Cesium이 설계한 지형 타일 바이너리 포맷. 정점 좌표를 16-bit 정수(0~32767)로 양자화하고 zig-zag delta encoding으로 압축함.
- **EPSG:4326 TMS**: 지형 서버가 사용하는 좌표계. `tilesX = 2^(z+1)`, `tilesY = 2^z`. Y=0이 **남쪽**. 위도가 선형으로 분포함.
- **Web Mercator XYZ**: 위성 이미지 서버(슬리피맵)가 사용하는 좌표계. `tilesXY = 2^z`. Y=0이 **북쪽**. 위도가 비선형(Mercator 투영) 분포함.
- **Skirt Geometry**: LOD 경계에서 생기는 틈새(seam)를 가리기 위해 타일 가장자리 정점에서 아래로 늘어뜨리는 "치마" 형태의 추가 지오메트리.
- **Hysteresis**: split/merge 판정에 다른 임계값을 사용하는 기법. 타일이 이미 leaf이면 높은 기준(SPLIT_THRESHOLD=150)으로 판정해 불필요한 split을 줄이고, 이전에 split된 상태면 낮은 기준(MERGE_THRESHOLD=100)으로 판정해 빠른 merge를 방지함. thrashing(반복 split/merge) 제거가 목적.
- **Starvation**: 우선순위 큐에서 낮은 우선순위 항목이 영원히 처리되지 않는 현상. 이 코드에서는 4번마다 1번 대기 시간 기준으로 선택해 방지함.
- **Soft-ignore**: 타일이 loading 중에 desired 목록에서 제외되었을 때 abort 대신 `cached` 상태로 전환하는 패턴. 카메라가 돌아왔을 때 cache hit으로 재fetch 없이 복원 가능.
- **Desired tiles**: 현재 프레임에서 LODTraverser가 보여줘야 한다고 결정한 타일 집합. 매 프레임 재계산됨.
- **Generation counter**: 같은 타일 키에 대한 재생성 시 이전 lifecycle의 stale texture를 차단하기 위한 정수 카운터.
- **LRU** (Least Recently Used): 캐시 교체 정책. 가장 오래전에 사용된 항목부터 제거함.
- **Partial texture**: 위성 타일 전체가 도착하기 전에 첫 번째 타일이 도착하자마자 임시로 표시하는 텍스처. crop 없는 상태라 UV가 약간 틀어지지만 빠른 시각 피드백을 제공함.
- **OffscreenCanvas**: 메인 쓰레드 DOM과 독립적으로 동작하는 캔버스. 위성 타일 합성에 사용.

---

## 1. 전체 구조

### 1-1. 모듈/컴포넌트 구조

```
src/
├── main.ts                           # 진입점 — Scene, 조명, 카메라, TileManager, LODTraverser 초기화
├── engine/
│   ├── constants.ts                  # 전역 상수 (LOD 임계값, 좌표, 위성 설정 등)
│   ├── camera/
│   │   └── CameraController.ts       # ArcRotateCamera + WASD/화살표 XZ 이동
│   └── tile/                         # 핵심 타일 시스템
│       ├── Tile.ts                   # TileState 타입, Tile 타입, tileKey() 함수
│       ├── TileCoords.ts             # 좌표 변환 (World ↔ TMS z/x/y, 쿼드트리 관계)
│       ├── LODTraverser.ts           # LOD 순회 — Frustum cull, SSE 판정, visibility 적용
│       ├── TileManager.ts            # 타일 캐시, LRU eviction, desired 동기화
│       ├── TerrainLoadQueue.ts       # 로드 큐 — 우선순위 정렬, 동시 제한, starvation 방지
│       ├── SatelliteFetchQueue.ts    # HTTP fetch 동시성 제한 (maxConcurrent=6)
│       ├── QuantizedMeshTileLoader.ts# 지형 타일 로더 — fetch, parse, buildMesh, sat texture
│       ├── QuantizedMeshParser.ts    # Cesium quantized-mesh 1.0 바이너리 파싱
│       ├── SatelliteTextureBuilder.ts# 위성 타일 합성, crop, 이중 캐시
│       ├── SatelliteProjection.ts    # EPSG:4326 TMS ↔ Web Mercator XYZ 변환
│       └── DebugTileMesh.ts          # 로드 실패 시 디버그 대체 메시 (와이어프레임)
```

### 1-2. 의존성 다이어그램

```
main.ts (진입점)
├── CameraController          (독립)
├── TileManager
│   └── TerrainLoadQueue
│       └── TileCoords (getTileBounds)
├── LODTraverser
│   ├── TileManager
│   ├── TileCoords (getTileBounds, getChildCoords, getParentCoord, worldToTileCoord)
│   └── DebugTileMesh         (DEBUG=true 시 fallback)
└── QuantizedMeshTileLoader
    ├── QuantizedMeshParser
    ├── TileCoords (getTileBounds)
    └── SatelliteTextureBuilder
        ├── SatelliteProjection
        └── SatelliteFetchQueue

constants.ts ← 모든 파일이 import
```

### 1-3. 프레임당 데이터 흐름

매 프레임 `engine.runRenderLoop()`에서:

```
traverser.update(camera)
    │
    ├── worldToTileCoord(camera.position)      # 카메라 위치 → 루트 타일 좌표
    │
    ├── traverse() × 9  (3×3 루트 타일 그리드)  # 재귀 quadtree 순회
    │   ├── Frustum cull               → skip
    │   ├── shouldSplit() = SSE > threshold?
    │   │   ├── YES → getChildCoords() → 재귀
    │   │   └── NO  → visibleKeys.add(key)
    │   └── ...
    │
    ├── tileManager.sync(desiredTiles, loaderFn)
    │   ├── [desired-ready]    → skip
    │   ├── [desired-cached]   → readyTile() (캐시 복원)
    │   ├── [desired-idle]     → loadQueue.enqueue()
    │   ├── [non-desired-queued] → remove (state=idle)
    │   ├── [non-desired-ready]  → cacheTile() (LRU 이동)
    │   └── loadQueue.drain()
    │       ├── 우선순위 정렬 (dist - z*50)
    │       └── execute() × MAX_CONCURRENT(4)
    │           └── loaderFn(x, y, z)
    │               ├── fetch terrain binary
    │               ├── parseQuantizedMesh()
    │               ├── buildMesh()  (positions + skirt + normals + UVs)
    │               └── SatelliteTextureBuilder.buildCompositeTexture()
    │                   ├── getSatelliteTileRange()
    │                   ├── SatelliteFetchQueue.fetch() × N위성타일
    │                   ├── OffscreenCanvas 합성
    │                   ├── onPartial callback (첫 타일 도착 시)
    │                   └── _cropCanvas() → DynamicTexture
    │
    └── applyVisibility(visibleKeys)            # setEnabled()의 유일한 호출자
        ├── Pass 1+2: visible → enable, loading → parent fallback
        └── Pass 3: cached-but-enabled → disable
```

---

## 2. 파일별 역할 / 기능

### `main.ts`
- **역할**: Babylon.js 엔진 초기화, 조명/카메라 설정, 메인 렌더 루프.
- **주요 내용**:
  - 메인 카메라(`camera`)와 디버그 카메라(`debugCamera`) 두 개 생성.
  - `F` 키로 두 카메라 전환 (메인 = 화살표 이동, 디버그 = WASD 이동).
  - `LODTraverser.update(camera.camera)`를 렌더 루프에서 매 프레임 호출.
  - Babylon Inspector 항상 활성화 (`scene.debugLayer.show`).
- **주의사항**: `BASE_URL`과 `SAT_BASE_URL`이 하드코딩된 로컬 서버 주소임. 서버 위치가 바뀌면 여기서 변경.

---

### `constants.ts`
- **역할**: 프로젝트 전역 상수 단일 파일 관리.
- **주요 상수**:
  - `GEO_ROOT_Z=9`, `GEO_ROOT_X=873`, `GEO_ROOT_Y=362` — 렌더링할 지역의 루트 타일 좌표 (서버 layer.json 기준).
  - `GEO_LON_MIN/MAX`, `GEO_LAT_MIN/MAX` — 루트 타일의 실제 위경도 범위 (계산값).
  - `DEBUG=true` — false로 바꾸면 디버그 메시 fallback 비활성화, 타일 로드 실패 시 에러 throw.
- **주의사항**: `GEO_ROOT_X/Y`를 바꾸면 렌더 지역이 달라짐. 서버가 다른 지역을 서빙하면 이 값과 함께 `SPLIT_THRESHOLD`도 조정이 필요할 수 있음.

---

### `Tile.ts`
- **역할**: 타일 데이터 타입과 상태 정의. 의존성 없는 순수 타입 파일.
- **주요 내용**:
  - `TileState`: `idle | queued | loading | ready | cached | error | disposed`
  - `Tile` 타입: `x, y, z, state, mesh?, onDispose?, lastUsed?`
  - `tileKey(x, y, z)`: `"z/x/y"` 형식 문자열 반환 (Map 키로 사용).

---

### `TileCoords.ts`
- **역할**: 좌표 변환 수학 전담.
- **주요 함수**:
  - `getTileBounds(x, y, z)` → `TileBounds`: TMS z/x/y → world 좌표 AABB 변환
  - `worldToTileCoord(worldX, worldZ, z)` → `[x, y]`: 카메라 위치를 타일 좌표로 변환 (루트 타일 탐색용)
  - `getParentCoord(x, y, z)` → 부모 좌표: x>>1, y>>1, z-1
  - `getChildCoords(x, y, z)` → 자식 4개: 2x, 2x+1, 2y, 2y+1
- **설계 패턴**: clamp 없음. 범위 밖 타일은 호출부(LODTraverser)에서 skip.

---

### `LODTraverser.ts`
- **역할**: 매 프레임 LOD 트리 순회 — split 판정 + visibility 결정.
- **주요 메서드**:
  - `update(camera)`: 메인 진입점. 3×3 루트 그리드에서 시작해 traverse 후 sync, visibility.
  - `traverse(...)`: 재귀 quadtree 순회. Frustum cull → shouldSplit → 자식 재귀 or leaf 등록.
  - `shouldSplit(...)`: SSE 계산 + Hysteresis 임계값 비교.
  - `applyVisibility(...)`: `setEnabled()`의 **유일한** 호출자. 3 pass 처리.
- **설계 패턴**: `setEnabled()`를 이 클래스에서만 호출함. TileManager는 state/data 관리만.
- **주의사항**: `prevVisibleKeys`가 Hysteresis의 핵심 상태임. 이 값이 없으면 매 프레임 동일한 threshold 적용.

---

### `TileManager.ts`
- **역할**: 타일 생명주기 상태 머신 + LRU 캐시 관리.
- **상태 머신 전이**:

```
idle ──enqueue──→ queued ──execute──→ loading ──success──→ ready
 ↑                                       │                   │
 └─────────────────────────────────────── ┘                   │
           (soft-ignore: isDesired=false → cached)            │
                                                              ↓
 disposed ←──_evict()── cached ←──────────────────────── (undesired)
```

- **주요 메서드**:
  - `sync(desiredTiles, loaderFn)`: 매 프레임 호출. desired 목록 기준으로 상태 동기화 + `drain()`.
  - `cacheTile(x, y, z)`: ready → cached. LRU 추가. 한도 초과 시 `_evict()`.
  - `readyTile(x, y, z)`: cached → ready. 카메라 재방문 시 re-fetch 없이 복원.
  - `_evict()`: LRU 가장 오래된 항목 `dispose()` + cache에서 제거.
- **주의사항**: `CACHE_LIMIT=64`는 동시에 메모리에 유지할 타일 최대 개수. GPU 메모리 부족 시 줄임.

---

### `TerrainLoadQueue.ts`
- **역할**: 로드 요청 우선순위 정렬 + 동시 실행 제한.
- **우선순위 공식**:
  ```
  priority = dist - z * LEVEL_WEIGHT(50)
  ```
  값이 작을수록 먼저 처리됨. 즉, 가까울수록(dist 작음) 우선, z레벨이 높을수록(세밀한 타일) 우선.
- **Starvation 방지**: 4번(`STARVATION_SLOT`)마다 1번은 우선순위 무시하고 가장 오래 대기한 항목 선택.
- **Soft-ignore**: `execute()` 완료 시 `isDesired(key)`가 false이면 state를 cached로 전환 (abort X).
- **주의사항**: `isDraining` 플래그로 재진입을 막음. 이게 없으면 `execute().finally()`에서 `drain()` 재귀 호출 시 race condition 발생.

---

### `SatelliteFetchQueue.ts`
- **역할**: HTTP fetch 동시 요청 제한 (기본 `maxConcurrent=6`).
- **주요 내용**:
  - `fetch(url, init?, signal?)`: 큐에 추가, 슬롯 있으면 즉시 실행.
  - AbortSignal 지원: 큐에 있는 동안 abort되면 큐에서 제거 + reject.
- **설계 패턴**: `blobCache`는 signal 없이 공유 — abort 오염 방지. signal 체크는 blob 이후 `createImageBitmap` 직전에 함.

---

### `QuantizedMeshTileLoader.ts`
- **역할**: 지형 타일 로드 + 메시 빌드 + 위성 텍스처 연결.
- **`load(x, y, z)`** 흐름:
  1. `fetchCache`로 fetch dedup (동일 URL 동시 요청 방지).
  2. `parseQuantizedMesh(buffer)` 호출.
  3. `buildMesh()` → Babylon.js Mesh 생성.
  4. `textureBuilder.buildCompositeTexture()` 비동기 시작 (결과 기다리지 않음).
  5. 즉시 `{ mesh, onDispose }` 반환.
- **`buildMesh()`** 흐름:
  1. positions: `u[i]`, `v[i]` → world XZ 좌표, `height[i]` → world Y 좌표.
  2. main UVs: u[i], v[i] 그대로 (0~1).
  3. Skirt geometry 생성 (아래 섹션 참조).
  4. 법선: main은 `ComputeNormals()`, skirt는 `(0,-1,0)` 고정.
  5. `VertexData.applyToMesh()`.
- **Generation counter**: `_tileGen` Map. 같은 타일 키가 dispose 후 재생성될 때 이전 `applyTexture` 콜백이 stale texture를 적용하는 것을 막음.
- **설계 패턴**: `onDispose` 콜백으로 texture lifecycle 타일 단위로 관리.

---

### `QuantizedMeshParser.ts`
- **역할**: Cesium quantized-mesh 1.0 바이너리 포맷 파싱.
- **포맷 구조**:
  ```
  [0~87]   Header (88 bytes)
             Offset 24: minHeight (f32)
             Offset 28: maxHeight (f32)
  [88~91]  vertexCount (u32)
  [92~]    u[vertexCount]      (u16, zig-zag delta encoded)
           v[vertexCount]      (u16, zig-zag delta encoded)
           height[vertexCount] (u16, zig-zag delta encoded)
           triangleCount (u32)
           indices[triangleCount * 3] (u16 or u32)
  ```
- **zig-zag delta 디코딩**: `decoded = (n >> 1) ^ (-(n & 1))`, 이후 누적합으로 절댓값 복원.
- **HWM 디코딩**: `indices[i] = highest - indices[i]; if (indices[i] == 0) highest++` — Cesium quantized-mesh spec 인덱스 인코딩 역산.
- **주의사항**: 이 서버는 4-byte 정렬 패딩이 없음. 표준 스펙과 다를 수 있으므로 `indexDataStart = vertexDataEnd` (패딩 없음).

---

### `SatelliteTextureBuilder.ts`
- **역할**: 위성 타일 fetch → OffscreenCanvas 합성 → terrain 범위에 crop → `DynamicTexture` 반환.
- **캐시 계층**:
  1. `blobCache` (URL → `Promise<Blob>`): 동일 URL fetch dedup. 최대 300개.
  2. `compositeCache` (z/x/y → `ImageBitmap`): crop 완료된 최종 이미지. 최대 100개.
  3. `inflightCache` (z/x/y → `Promise`): 진행 중인 합성 dedup.
- **`buildCompositeTexture(x, y, z, onPartial?)`** 흐름:
  1. `compositeCache` hit → 즉시 반환.
  2. `inflightCache` hit → 기존 Promise 공유.
  3. 신규 → `_buildComposite()` 시작.
  4. `_buildComposite()`: 위성 타일 fetch → `OffscreenCanvas`에 그림 → 첫 타일 도착 시 `onPartial` 콜백 → `_cropCanvas()`.
- **`cancelComposite(x, y, z)`**: `AbortController.abort()` 호출. compositeCache는 유지 (재방문 시 재사용).
- **주의사항**: `blobCache`의 AbortSignal은 없음 — 다른 composite와 공유하는 캐시이므로 한 composite의 abort가 blob 캐시를 오염시키지 않도록.

---

### `SatelliteProjection.ts`
- **역할**: Terrain TMS 좌표계 ↔ Satellite Web Mercator XYZ 좌표계 변환.
- **핵심 차이**:
  - Terrain (EPSG:4326 TMS): `tilesX=2^(z+1)`, `tilesY=2^z`, Y=0=남쪽, 위도 선형.
  - Satellite (Web Mercator XYZ): `tilesXY=2^z`, Y=0=북쪽, 위도 비선형(Mercator).
- **주요 함수**:
  - `latToMercatorYFrac(lat, nSat)`: 위도 → Web Mercator Y tile fraction.
  - `terrainTileBounds(z, x, y)`: terrain 타일 → 위경도 경계.
  - `getSatelliteTileRange(terrainZ, terrainX, terrainY, satZ)`: terrain 타일 → 커버하는 satellite 타일 범위 `{xMin, xMax, yMin, yMax}`.
- **Y축 방향 주의**: `latMax(북쪽) → yMin`, `latMin(남쪽) → yMax`. Mercator Y는 북쪽일수록 작음.

---

### `DebugTileMesh.ts`
- **역할**: 타일 데이터가 없을 때 bounds 영역을 시각화하는 와이어프레임 ground plane.
- **색상**: z 레벨별로 다른 색상 (Green → Blue → Yellow → Magenta → Red → 순환).
- **`EPSILON = 0.001`**: 같은 y=0 평면의 타일들이 z-fighting 없이 구분되도록 z레벨 × epsilon으로 미세 높이 차이를 둠.
- **`disposeDebugMaterialCache()`**: 앱 종료 시 `main.ts`에서 호출. material 메모리 정리.

---

### `CameraController.ts`
- **역할**: `ArcRotateCamera` 래퍼. WASD/화살표 키로 XZ 수평 이동 추가.
- **키 분기**: `debug=true` 이면 WASD, `debug=false`이면 화살표.
- **이동 계산**: `camera.alpha`에서 forward 벡터 직접 계산 (`-cos(alpha), 0, -sin(alpha)`). target을 이동시켜 카메라 전체를 XZ 이동.
- **주의사항**: `ArcRotateCameraKeyboardMoveInput` 제거 — Babylon 내장 키보드 이동과 충돌 방지.

---

## 3. 핵심 로직

### 3-1. 로딩 흐름

#### Tile State Machine

```
              ┌──────────────────────────────────────────┐
              ↓                                          │
idle ─ enqueue() ─→ queued ─ execute() ─→ loading ─────────────→ ready
              ↑                               │               │
              │                               │               │ (isDesired=false)
              │                               ↓               ↓
              │                             error           cached ──→ (LRU) ──→ disposed
              │                                               │
              └───────────── readyTile() ───────────────────┘
                           (re-visit hit)
```

**상태 의미**:
- `idle`: 캐시에 존재하지만 아무 작업도 없음.
- `queued`: 로드 큐에 대기 중. `TerrainLoadQueue.queue`에 있음.
- `loading`: fetch + buildMesh 진행 중. abort 없음 (soft-ignore 대상).
- `ready`: 메시 준비 완료. `applyVisibility()`에서 enable 가능.
- `cached`: 메시는 있지만 현재 desired 아님. disabled. LRU 관리 대상.
- `error`: fetch 실패. 다음 sync에서 idle 상태와 동일하게 enqueue 재시도.
- `disposed`: LRU eviction으로 메시 dispose됨. cache Map에서 제거됨.

#### 우선순위 큐

```
priority = dist(카메라 ↔ 타일 중심) - z * 50
```

값이 **작을수록** 먼저 처리됨:
- `dist` 작음 = 카메라에 가까움 → 우선.
- `z * 50` 크면 priority가 낮아짐 → 세밀한(높은 z) 타일이 우선.

`MAX_CONCURRENT=4`로 동시 실행 제한. `STARVATION_SLOT=4`번마다 1번은 가장 오래 대기한 항목 강제 처리.

---

### 3-2. 렌더링 흐름

#### Frustum Culling (LODTraverser.ts:102~112)

Babylon의 Frustum API 대신 간이 구현:
```javascript
dist = 타일 중심까지 거리 (XZ 평면)
toTile = 카메라 → 타일 중심 벡터
if (dist > bounds.size * 1.5 && dot(toTile.normalize(), forward) < -0.3)
  → skip
```

"타일 크기의 1.5배보다 멀고, 카메라 진행 방향의 반대쪽(-30°보다 더 뒤쪽)"이면 skip. 완전한 frustum cull은 아니지만 성능상 충분.

#### SSE 계산 (LODTraverser.ts:129~153)

```javascript
effectiveDepth = max(
  depth,              // forward 투영 깊이 (소실점 방향)
  euclidean * 0.5,    // 옆에 있는 타일도 어느 정도 처리 (0으로 나누기 방지)
  1                   // 최솟값
)
geometricError = bounds.size / 2
projFactor = screenHeight / (2 * tan(fov / 2))   // 화면 픽셀 밀도
screenError = (geometricError * projFactor) / effectiveDepth
```

#### Hysteresis (LODTraverser.ts:150~153)

```javascript
const threshold = isCurrentlyVisible ? SPLIT_THRESHOLD : MERGE_THRESHOLD;
// isCurrentlyVisible = 지난 프레임에 이 타일이 leaf였는가?
// - true (지난 프레임 leaf) → 높은 기준(150) → 잘 쪼개지 않음 → 안정
// - false (지난 프레임 split됨) → 낮은 기준(100) → split 유지 → 안정
```

#### Visibility 적용 (LODTraverser.ts:160~196)

3 pass로 처리:
1. **Pass 1+2**: visibleKeys 순회. `ready`이면 enable. `loading/queued`이면 부모 타일로 fallback (부모가 ready/cached이면 임시 enable).
2. **Pass 3**: 전체 캐시 순회. `cached`인데 enabled 상태 → 이번 프레임 parent fallback에 포함되지 않았으면 disable.

**왜 LODTraverser만 setEnabled를 호출하는가?** TileManager는 state/data 관리만 담당하고 visibility 판단은 LODTraverser가 가져야 한다는 단일 책임 원칙. 여러 곳에서 setEnabled를 호출하면 visible 상태 추적이 어려워짐.

#### Skirt Geometry (QuantizedMeshTileLoader.ts:155~244)

LOD 경계에서 인접 타일이 다른 해상도를 가질 때 정점 위치 차이로 틈새(seam)가 생김. 해결책으로 각 타일 가장자리에서 아래로 `skirtDepth`만큼 정점을 내려뜨린 "치마" 폴리곤을 추가함.

```
skirtDepth = max(
  (maxHeight - minHeight) * heightScale * 0.3,  // 높이 범위의 30%
  heightScale * 0.1,                             // 최소 보장
  bounds.size * 0.05                             // 타일 크기의 5%
)
```

와인딩 순서 (WebGL CCW = front):
- North, West: `flip=false` → `(a, b, sb)` CCW
- South, East: `flip=true` → `(a, sa, sb)` (CW로 반전)

---

### 3-3. 위성 텍스처 흐름

#### 좌표계 변환 필요 이유

지형 서버 = **EPSG:4326 TMS** (경위도 선형 격자)
위성 서버 = **Web Mercator XYZ** (Mercator 투영, Google/OSM 방식)

두 좌표계는 다음이 다름:
1. **Y 방향**: TMS는 Y=0이 남쪽, XYZ는 Y=0이 북쪽.
2. **위도 분포**: TMS는 선형, XYZ는 Mercator 비선형.
3. **X 타일 수**: TMS는 `2^(z+1)`, XYZ는 `2^z`.

따라서 terrain 타일 경계(위경도)를 satellite 타일 범위로 변환할 때 두 공식을 따로 적용해야 함.

#### 합성 + Crop 흐름

```
terrain tile (z, x, y)
  │
  ├── getSatelliteTileRange() → {xMin, xMax, yMin, yMax} @ satZ
  │
  ├── OffscreenCanvas (W = cols*256, H = rows*256)
  │   └── for each (sx, sy) in range:
  │       fetch → drawImage(dx, dy)  (Y=0=north 그대로)
  │
  ├── onPartial callback (첫 타일 도착 시 1회)
  │
  └── _cropCanvas()
      ├── terrain 타일의 위경도 경계 → canvas 픽셀 좌표 변환
      │   cropX0 = (lonMin → sat XYZ fraction - xMin) * 256
      │   cropY0 = (latMax → Mercator Y fraction - yMin) * 256  ← north
      │   cropY1 = (latMin → Mercator Y fraction - yMin) * 256  ← south
      ├── OffscreenCanvas.drawImage(-cropX0, -cropY0) 로 crop
      └── createImageBitmap → DynamicTexture
```

**UV 정합**: terrain mesh UV는 u=0=서, v=0=남, v=1=북. DynamicTexture는 WebGL로 로딩 시 Y 자동 플립됨 → OffscreenCanvas의 Y=0=north가 상쇄되어 올바르게 정합됨.

---

## 4. 구현 의도

### 위성 좌표계 분리가 왜 필요한가
EPSG:4326은 지리학적 좌표계(위경도를 동일 간격으로 격자화)이고, Web Mercator는 Mercator 투영으로 비선형임. 같은 z레벨이라도 타일 배치, Y방향, 타일 수가 다르므로 변환 로직을 하나의 파일(`SatelliteProjection.ts`)에 명시적으로 분리함.

### SPLIT=150, MERGE=100 선택 이유
- 경험적 튜닝값. 서버 지형 해상도, 카메라 FOV, TERRAIN_SIZE에 따라 달라짐.
- 두 값의 차이(50)가 Hysteresis 범위임. 차이가 너무 작으면 thrashing 발생, 너무 크면 전환이 느림.

### Soft-ignore 패턴 선택 이유
loading 중인 타일을 abort하면 구현이 복잡해지고 서버 연결 낭비가 발생함. 대신 완료 후 `cached`로 전환해 두면, 카메라가 돌아왔을 때 재fetch 없이 cache hit으로 바로 표시 가능. 메모리는 LRU가 관리.

### 부모 타일 fallback (현재 코드에 남아있는 로직)
`applyVisibility()`의 Pass 2에서 자식이 loading 중일 때 부모 타일을 임시 표시함. 이는 "화면에 구멍이 생기는 것"을 방지하는 minimal fallback. 과거에는 로딩 체인 전체를 타고 올라가는 재귀 fallback이 있었으나 복잡도 대비 효과가 없어 제거됨 (doc 27 참조). 현재는 직계 부모 1단계만.

### visibility를 LODTraverser에서만 관리하는 이유
TileManager가 `setEnabled`를 호출하면 "어떤 타일이 화면에 보이는가"라는 상태가 두 곳에 분산됨. LODTraverser만 visible 상태를 추적하고(`prevVisibleKeys`) 결정하도록 단일화하면 디버깅이 쉬움.

### skirt 법선을 (0,-1,0)으로 고정하는 이유
skirt는 "화면에서 안 보여야 하는" 가림용 폴리곤. 조명 영향을 최소화해서 terrain과 시각적으로 구분되지 않게 하려면 아래를 향하는 고정 법선이 유리함. terrain 법선 계산에 skirt 정점이 영향을 미치지 않도록 별도 계산함.

---

## 5. 핵심 상수 & 임계값 참조표

> 동작을 조정할 때 바꿔야 하는 값들. 모두 `src/engine/constants.ts`에 있음.
> TileManager/TerrainLoadQueue 내부 상수는 해당 파일에서 직접 확인.

**`constants.ts`**

- `SPLIT_THRESHOLD` = `150` — 타일을 쪼갤 SSE 임계값. 높이면 덜 쪼개짐 (성능↑, 화질↓)
- `MERGE_THRESHOLD` = `100` — 쪼갠 타일을 합칠 SSE 임계값. SPLIT과의 차이(50)가 Hysteresis 폭
- `MAX_LOD_LEVEL` = `15` — 최대 LOD 레벨 (서버 최대 z)
- `GEO_ROOT_Z` = `9` — 렌더링 시작 루트 z레벨
- `GEO_ROOT_X/Y` = `873/362` — 렌더링할 지역의 루트 타일 좌표
- `DEBUG` = `true` — false 시 debug 메시 fallback 비활성화
- `SAT_Z_MIN` = `12` — 위성 타일 최소 z레벨
- `SAT_Z_MAX` = `18` — 위성 타일 최대 z레벨
- `SAT_Z_OFFSET` = `0` — 위성 타일을 terrain보다 N레벨 더 세밀하게 요청 (1이면 4배 픽셀)
- `TERRAIN_SIZE` = `512` — world 좌표 지형 크기 (units)
- `HEIGHT_SCALE` = `320` — 고도 m → world units 변환 계수

**`TileManager.ts`**

- `CACHE_LIMIT` = `64` — LRU 캐시 최대 타일 수

**`TerrainLoadQueue.ts`**

- `MAX_CONCURRENT` = `4` — 동시 타일 로드 수
- `MAX_QUEUE_SIZE` = `100` — 로드 큐 최대 항목 수 (초과 시 worst 제거)
- `LEVEL_WEIGHT` = `50` — 우선순위 공식의 z레벨 가중치

**`SatelliteTextureBuilder.ts`**

- `MAX_BLOB_CACHE` = `300` — 위성 blob 캐시 최대 항목 수
- `MAX_COMPOSITE_CACHE` = `100` — 합성 이미지 캐시 최대 항목 수

**`SatelliteFetchQueue.ts`**

- `maxConcurrent` = `6` — HTTP fetch 동시 요청 수

---

## 6. 디버깅 & 상태 확인

### 6-1. DebugTileMesh 사용법

`constants.ts`의 `DEBUG=true` 상태에서:
- 지형 서버 응답 실패 시 → 와이어프레임 colored ground plane으로 폴백.
- z레벨별로 색상이 다름 (Green=9, Blue=10, Yellow=11, ...).
- 어떤 z레벨의 타일이 어디에 배치되는지 시각적으로 확인 가능.

위성 이미지 debug overlay (SatelliteTextureBuilder.ts):
- `DEBUG=true`이면 각 위성 타일 경계에 빨간 테두리와 `[Sat] z/x/y` 레이블이 그려짐.
- crop된 최종 텍스처에는 초록 `[Terr] z x y` 레이블이 중앙에 표시됨.

비활성화: `constants.ts`에서 `DEBUG=false` 로 변경.

### 6-2. Babylon Inspector 활용

앱 실행 시 Inspector가 자동 활성화됨. 주요 활용:
- **Scene tree**: 타일 메시 이름 `tile_z/x/y`, 디버그 메시 `debug_z/x/y` 확인.
- **Material**: LOD 레벨별 색상 확인 (위성 텍스처 없을 때).
- **Rendering**: Wireframe 모드 전환으로 메시 구조 확인.

### 6-3. 브라우저 콘솔 로그

`TerrainLoadQueue`와 `TileManager`에서 상태 전이마다 로그 출력:
```
[Tile] enqueue 9/873/362
[Tile] start loading 9/873/362
[Tile] ready 9/873/362
[Tile] discard (stale → cached) 10/1747/724
```

"discard" 로그가 많으면 카메라가 빠르게 이동해 타일이 완료 전에 desired에서 벗어나는 것. 정상 동작임.

### 6-4. 문제 유형별 체크포인트

**타일이 전혀 안 보임**
1. `constants.ts`의 `GEO_ROOT_Z/X/Y`가 서버 데이터와 일치하는지 확인.
2. 브라우저 Network 탭에서 terrain fetch URL이 올바른지, 서버가 응답하는지 확인.
3. `DEBUG=true`이면 DebugTileMesh라도 보여야 함 — 아무것도 없으면 LODTraverser `traverse()` 단계에서 모두 cull되는 것.

**타일 일부가 비어 있음 (검은 틈새)**
1. Skirt geometry 문제. `QuantizedMeshTileLoader.ts`의 `skirtDepth` 계산 확인.
2. LOD 레벨 차이가 너무 심한 경우 skirt가 충분히 깊지 않을 수 있음 — `bounds.size * 0.05` 계수 조정.

**위성 이미지가 안 붙음**
1. Network 탭에서 satellite fetch URL 확인 (`/maps-satellite/z/x/y.jpg`).
2. `SatelliteProjection.ts`의 `getSatelliteTileRange()` 계산 결과 확인 — 위성 범위가 너무 큰 경우 많은 타일 fetch로 지연.
3. `SAT_Z_OFFSET`을 0으로 설정해도 위성이 안 나오면 서버 문제.

**LOD 전환이 너무 자주 일어남 (flickering)**
1. `SPLIT_THRESHOLD`와 `MERGE_THRESHOLD`의 차이를 늘림 (현재 50 → 70~100).
2. `effectiveDepth`의 `euclidean * 0.5` 계수를 올려서 옆면 타일의 SSE를 낮춤.

**메모리 사용량이 계속 증가**
1. `CACHE_LIMIT` 확인 (기본 64). 줄이면 더 공격적으로 evict.
2. `MAX_BLOB_CACHE`와 `MAX_COMPOSITE_CACHE` 확인 — 위성 이미지 캐시가 큰 경우.
3. Inspector에서 `tile_*` 메시 수를 확인.

**카메라 이동이 안 됨**
- F키로 현재 활성 카메라 확인 (메인 = 화살표, 디버그 = WASD).
- `canvas`에 포커스가 있는지 확인 (Inspector 클릭 후 이동 안 될 수 있음 — canvas 클릭 후 재시도).
