# 30. 위성 텍스처 Fetch 성능 개선

## 배경

위성 텍스처 로딩 시 다음 3가지 문제가 있었음:

1. **요청 폭발**: `SAT_Z_OFFSET=3` → terrain 타일 1개당 최대 8×8=64개 위성 타일 fetch. 20개 타일 표시 시 최대 1280 요청 발생
2. **스테일 요청 blocking**: `TileFetchQueue`가 FIFO에 취소 없음 → 카메라 이동 시 사라진 타일의 요청이 새 타일을 막음
3. **Promise.all blocking**: 64개가 모두 올 때까지 아무것도 렌더링 안 됨

## 변경 사항

### 1. `src/engine/constants.ts`

`SAT_Z_OFFSET` 고정값으로 변경 (수식 연결 제거):

```typescript
// 변경 전
export const SAT_Z_OFFSET = SAT_Z_MAX - MAX_LOD_LEVEL; // = 3

// 변경 후 (최초 2로 변경, 이후 실험적으로 0으로 조정)
export const SAT_Z_OFFSET = 0;
```

> 현재 `SAT_Z_OFFSET = 0` — 개발 중 성능 실험용. 실제 품질에 맞게 조정 필요.

### 2. `src/engine/tile/TileFetchQueue.ts` — AbortSignal 지원

```typescript
interface QueueItem {
  fn: () => Promise<Response>;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;   // 추가
}
```

`fetch(url, init?, signal?)` — 취소 처리 3단계:
- **enqueue 전**: `signal.aborted`면 즉시 reject
- **큐 대기 중**: `abort` 이벤트 → queue에서 splice 후 reject
- **실행 중**: `fetch(url, { signal })`으로 전달 → 네트워크 요청도 abort

`drain()` 진입점에서도 abort 체크 (이벤트와 race condition 방어).

> blobCache 공유 자원 보호: `fetchSatTile` 내 blobCache fetch 자체에는 signal 전달 안 함. `createImageBitmap` 직전에만 체크.

### 3. `src/engine/tile/SatelliteTextureBuilder.ts`

**취소 지원**:
- `inflightControllers: Map<string, AbortController>` 추가
- `_getOrBuildComposite`: 신규 빌드 시 `AbortController` 생성, 완료/에러 시 자동 정리
- `cancelComposite(x, y, z)`: inflight만 취소, **compositeCache는 유지** (재방문 시 재사용)
  - abort + cache delete를 같이 하면 카메라가 돌아올 때 전체 re-fetch 발생하므로 분리

**Progressive Rendering**:
- `buildCompositeTexture`에 `onPartial?: (tex: DynamicTexture) => void` 추가
- `_buildComposite` 내부: `Promise.all` → 개별 Promise로 변경, 타일 도착 즉시 canvas에 그림
- 첫 번째 타일 도착 시 **1회만** (flag 제어) partial texture 콜백 → GPU texture churn 방지
- partial은 **crop 없이** 전송 (crop 좌표는 전체 canvas 기준 → 일부만 있으면 영역 틀어짐)
- `await Promise.all(tilePromises)` 후 `_cropCanvas`로 final bitmap 반환
- `_cropCanvas` private 메서드로 추출 (final에서만 사용)

### 4. `src/engine/tile/QuantizedMeshTileLoader.ts`

**tile 단위 generation 카운터**:
```typescript
private readonly _tileGen = new Map<string, number>();
```
- `load()` 시작 시 해당 tile key의 generation 증가 후 캡처
- loader-wide 카운터를 쓰면 서로 다른 타일이 서로를 invalidate하므로 **tile 단위** 필수

**`applyTexture` 헬퍼** (partial/final 공통):
```typescript
const applyTexture = (tex: DynamicTexture) => {
  if (mesh.isDisposed() || myGen !== this._tileGen.get(tileKey)) {
    tex.dispose(); return;
  }
  // satMaterial 생성 또는 texture 교체
  oldTex?.dispose(); // partial texture 메모리 해제
};
```

**`onDispose` 연동**:
```typescript
const onDispose = () => {
  // material/texture 정리
  this.textureBuilder!.cancelComposite(x, y, z); // inflight 취소
};
```

## 취소 흐름

```
카메라 이동 → LODTraverser.syncTiles()
  → TileManager.disposeTile()
    → tile.onDispose()
      → SatelliteTextureBuilder.cancelComposite(x, y, z)
        → AbortController.abort()
          → [큐 대기 중] TileFetchQueue: queue.splice → reject
          → [실행 중 fetch] signal으로 자동 중단
        → compositeCache 유지 (LRU 관리)
```

## 설계 결정 & 트레이드오프

| 항목 | 결정 | 이유 |
|------|------|------|
| abort 시 cache delete | ❌ 하지 않음 | 재방문 시 re-fetch 방지 |
| partial crop | ❌ 하지 않음 | 일부 타일만 있으면 crop 영역 틀어짐 |
| partial 전송 횟수 | 1회 (flag) | GPU texture churn 방지 |
| generation 단위 | tile 단위 Map | loader-wide 사용 시 타일 간 invalidation 발생 |
| blobCache signal | ❌ 전달 안 함 | 공유 캐시 오염 방지 |

## 알려진 한계

- partial texture는 UV가 약간 틀어짐 (crop 없음) — final로 교체되면 정상
- `SAT_Z_OFFSET = 0`은 성능 실험용. 위성 이미지 품질 저하 있음
- compositeCache LRU eviction 빈도 이슈는 미해결 (향후 "recently visible 우선 유지" 개선 가능)
