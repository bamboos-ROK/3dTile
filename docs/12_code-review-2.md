# 12. 2차 코드 리뷰 리팩토링

## 목적

1차 리팩토링(docs/10) 이후 잔존하는 안티패턴을 제거한다.

---

## 변경 내역

### A. [High] Dead Field 제거 + BoundingBox 캐싱

`TerrainTile.boundingBox`는 `TerrainTileManager.getOrCreate`에서 값을 설정하지만
`TerrainRenderer.traverse`에서 전혀 읽지 않던 Dead Field.

- `TerrainTile.ts` — `boundingBox` 필드 제거
- `TerrainTileManager.ts` — `tile.boundingBox = new BoundingBox(...)` 제거
- `TerrainRenderer.ts` — `bbCache: Map<string, BoundingBox>` 추가
  - traverse 시 key로 캐시 조회 → 없을 때만 생성
  - 60fps 기준 초당 ~20,000회 할당 → 첫 방문 시 1회로 절감

### B. [Medium] parseTileKey() 유틸 함수 분리

`TerrainRenderer.ts` dispose 루프의 취약한 인라인 파싱 제거:

```ts
// 수정 전
const [tileX, tileY, level] = key.split('_').map(Number);

// 수정 후
const coord = parseTileKey(key);
```

- `TerrainTile.ts` — `parseTileKey(key: string): TileCoord` 추가 (tileKey() 포맷과 동기화)
- `TerrainRenderer.ts` — import 후 사용

### C. [Low] TileState.Loading 제거

`Loading → Active` 전환이 동기적으로 즉시 발생하여 실질적 의미 없음.

- `TerrainTile.ts` — `TileState.Loading` 제거
- `TerrainTileManager.ts` — `tile.state = TileState.Loading` 라인 제거, 바로 `TileState.Active`로 전환

### D. [Low] VERTEX_RESOLUTION → constants.ts 이동

```ts
// TerrainMeshBuilder.ts 내부 선언 제거
// constants.ts에 추가
export const VERTEX_RESOLUTION = 32;
```

- `constants.ts` — `VERTEX_RESOLUTION`, `PIXEL_WORLD_SIZE` 추가
- `TerrainMeshBuilder.ts` — 로컬 선언 제거, constants에서 import

### E. [Low] CameraController.dispose() beforeunload 호출

페이지 언로드 시 이벤트 리스너 누수 방지:

```ts
window.addEventListener('beforeunload', () => {
  cameraController.dispose();
  engine.dispose();
});
```

- `main.ts` — beforeunload 핸들러에 `cameraController.dispose()` 추가

---

## 수정 파일 목록

| 파일 | 변경 유형 |
|------|---------|
| `src/engine/constants.ts` | `VERTEX_RESOLUTION`, `PIXEL_WORLD_SIZE` 추가 |
| `src/engine/terrain/TerrainTile.ts` | `boundingBox` 필드 제거, `TileState.Loading` 제거, `parseTileKey()` 추가 |
| `src/engine/terrain/TerrainTileManager.ts` | `boundingBox` 할당 제거, `Loading` 상태 전환 제거 |
| `src/engine/terrain/TerrainMeshBuilder.ts` | `VERTEX_RESOLUTION` 로컬 선언 제거, constants import |
| `src/engine/renderer/TerrainRenderer.ts` | `bbCache` 도입, `parseTileKey()` 사용 |
| `src/main.ts` | `beforeunload`에 `cameraController.dispose()` 추가 |
