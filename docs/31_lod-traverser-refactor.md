# LODTraverser 리팩토링

## 배경

기존 `LODTraverser.syncTiles()`가 LOD 결정 + 타일 로딩을 한 함수에서 모두 처리하여 다음 문제가 있었다.

- obsolete 요청이 취소되지 않고 계속 실행됨
- FIFO 구조로 가까운 타일이 먼 타일에 block됨
- visible set 제외 시 즉시 dispose → 카메라 이동 시 반복 재생성
- 단일 threshold(PIXEL_THRESHOLD=150)로 LOD thrashing 발생
- 카메라 뒤쪽 타일도 traversal 대상에 포함

## 변경 파일

| 파일 | 변경 내용 |
| --- | --- |
| `src/engine/constants.ts` | PIXEL_THRESHOLD 제거, SPLIT_THRESHOLD/MERGE_THRESHOLD 추가 |
| `src/engine/tile/Tile.ts` | TileState에 `"queued"`, `"cached"` 추가, `lastUsed` 필드 추가 |
| `src/engine/tile/TileLoadQueue.ts` | 신규 — priority queue, drain, starvation 방지; cacheTileFn 콜백, stale → cached 보존 (Step 4) |
| `src/engine/tile/TileManager.ts` | sync(), cacheTile(), readyTile(), _evict(), LRU 추가; setEnabled 제거 — Visibility 단일화 (Step 4) |
| `src/engine/tile/LODTraverser.ts` | Frustum Cull, Hysteresis, applyVisibility, sync() 연동; Hysteresis 수식 수정, applyVisibility 재작성 (Step 4) |
| `src/main.ts` | TileManager 생성자에 cameraPosProvider 전달 |

## Step 1: Frustum Cull + LOD Hysteresis

### constants.ts

```ts
export const SPLIT_THRESHOLD = 150;  // 새로 split할 때 기준
export const MERGE_THRESHOLD = 100;  // 이미 split된 것을 merge할 때 기준
```

### LODTraverser — Frustum Cull

카메라 뒤쪽 타일을 early return으로 제외한다.

```ts
const toTile = new Vector3(bounds.centerX - cameraPos.x, 0, bounds.centerZ - cameraPos.z);
const dist = toTile.length();
if (dist > bounds.size * 1.5 && Vector3.Dot(toTile.normalizeToNew(), forward) < -0.3) return;
```

### LODTraverser — Hysteresis

`prevVisibleKeys`를 기록하여 이미 leaf인 타일은 높은 threshold, split 중인 타일은 낮은 threshold를 적용한다.

```ts
// isCurrentlyVisible=true(leaf였음): SPLIT_THRESHOLD 초과해야 새로 split
// isCurrentlyVisible=false(split이었음): MERGE_THRESHOLD 초과해야 split 유지
const threshold = isCurrentlyVisible ? SPLIT_THRESHOLD : MERGE_THRESHOLD;
```

## Step 2: Tile Lifecycle + LRU Cache + Parent Fallback

### TileState 확장

```ts
type TileState = "idle" | "queued" | "loading" | "ready" | "cached" | "error" | "disposed";
```

- `"queued"`: 중복 enqueue 방지 — idle/error만 enqueue 진입 허용
- `"cached"`: mesh 유지, setEnabled(false) — 재진입 시 재로드 없이 복원

### TileManager — LRU Cache (CACHE_LIMIT = 64)

```ts
cacheTile(x, y, z)  // state="cached", lastUsed 갱신, filter-before-push LRU (setEnabled 없음 → applyVisibility 담당)
readyTile(x, y, z)  // state="ready", LRU 갱신 (setEnabled 없음)
_evict()            // lruOrder 가장 오래된 항목 실제 dispose
```

### Parent Fallback

child가 loading/queued 상태일 때 parent mesh를 visible로 유지한다.
desiredTiles는 변경하지 않고 setEnabled만 조작한다.
sync() 이후 `applyVisibility()`에서 처리한다.

## Step 3: 로직 분리 + Load Queue

### TileLoadQueue (신규)

```ts
class TileLoadQueue {
  constructor(private cameraPosProvider: () => Vector3) {}
  enqueue(x, y, z): void   // idle/error만 진입
  remove(key): void         // queue에서만 제거 (loading은 soft ignore)
  drain(loaderFn): void     // 매 프레임 호출
}
```

**Priority 공식**: `dist - z * 50` (가까울수록, 깊을수록 우선)

**drain() 핵심 설계**:

- `isDraining` 플래그로 재진입 차단
- MAX_QUEUE_SIZE=100 초과 시 `reduce`로 worst 탐색 (pop() 금지)
- 매 drain마다 sort → dequeue (starvation 방지: 4번마다 1번 oldest 선택)
- `running++` 전 state 검증 (running 음수 방지)
- `finally: Promise.resolve().then(() => drain())` — microtask tick

**Stale 처리** (Step 3 초기 설계 → Step 4에서 수정):

```ts
// Step 3 초기 — 즉시 dispose (Bug 4 원인)
if (!this.isDesired(key)) {
  data.mesh?.dispose();
  tile.state = "idle";
  return;
}
// Step 4 수정 — mesh 보존, LRU eviction 위임
if (!this.isDesired(key)) {
  Object.assign(tile, data);
  this.cacheTileFn(x, y, z);  // state="cached", LRU 등록
  return;
}
```

### TileManager.sync()

```ts
sync(desiredTiles, loaderFn): void {
  this.currentDesiredTiles = desiredTiles;
  // 1. cached → readyTile() (cache hit, 재로드 없이 복원)
  // 2. queued 중 미desired → remove + idle
  // 3. ready 중 미desired → cacheTile()
  // 4. loadQueue.drain()
}
```

### LODTraverser.update()

```ts
update(camera): void {
  // traverse → visibleKeys → desiredTiles
  this.tileManager.sync(desiredTiles, this.loaderFn);
  this.applyVisibility(visibleKeys);  // sync() 이후 visibility 처리
  this.prevVisibleKeys = visibleKeys;
}
```

## Step 4: 타일 깜빡임 버그픽스

Step 1~3 구현 이후 카메라 이동 시 타일 깜빡임 발생. 원인은 두 레이어:

### Bug 1 — Hysteresis 수식 반전 (`shouldSplit()`)

`isCurrentlyVisible = prevVisibleKeys.has(key)` — 이전 프레임에서 leaf였는지 여부.
수식이 반전되어 hysteresis가 진동 억제가 아닌 진동 증폭으로 작동했다.

```ts
// Before: 진동 증폭
const threshold = isCurrentlyVisible ? MERGE_THRESHOLD : SPLIT_THRESHOLD;
// After: 안정화
const threshold = isCurrentlyVisible ? SPLIT_THRESHOLD : MERGE_THRESHOLD;
```

### Bug 2 — applyParentFallback 실행 순서

```text
Before: applyParentFallback() → sync()
        sync() 내 cacheTile()이 parent.setEnabled(false) 호출 → fallback 매 프레임 무효화

After:  sync() → applyVisibility()
        sync() 후 visibility 결정 → fallback 정상 동작
```

### Bug 3 — Visibility 단일화

setEnabled 호출이 TileManager.cacheTile/readyTile과 LODTraverser.applyParentFallback에 분산되어
ghost parent 등 예외 케이스가 수작업 Pass 추가로 누적됐다.

**수정**: TileManager에서 setEnabled 완전 제거 → `applyVisibility()`가 유일한 setEnabled 호출자.

```text
TileManager  → state · data · LRU 전담 (setEnabled 없음)
applyVisibility() → 매 프레임 전체 visibility 결정
  Pass 1+2: visibleKeys 기준 enable + parent fallback
  Pass 3:   cached + enabled 타일 비활성화 (ghost · stale 정리)
```

### Bug 4 — Stale Discard → Cached 보존

```text
Before: load 완료 → !isDesired → dispose + idle
        카메라 복귀 시 재fetch → flickering + 성능 저하

After:  load 완료 → !isDesired → cached (mesh 보존)
        카메라 복귀 시 cache hit → 재fetch 없음
```

TileLoadQueue 생성자에 `cacheTileFn: (x, y, z) => void` 콜백 추가.

---

## 핵심 설계 결정

| 항목 | 결정 |
| --- | --- |
| stale 처리 | cached 보존 — LRU eviction 위임 (Step 4에서 변경) |
| currentDesiredTiles | TileManager 내부 — isDesired() 기준점 |
| enqueue 진입 | idle/error만 허용 |
| drain() 재진입 | isDraining 플래그 |
| drain() 재호출 | Promise.resolve().then() — microtask |
| cameraPos stale | cameraPosProvider 주입 |
| LRU 중복 방지 | filter-before-push |
| Parent Fallback 순서 | sync() 이후 applyVisibility() |
| setEnabled 호출자 | LODTraverser.applyVisibility() 단독 (Step 4에서 단일화) |
