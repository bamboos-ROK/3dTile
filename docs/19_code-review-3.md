# 19. 3차 코드 리뷰 버그픽스

## 개요

코드 리뷰를 통해 발견된 버그·안전성 결함·메모리 누수를 수정.

---

## Bug 1: updateVisibility — 화면 밖 타일 미숨김 (P0)

### 증상

카메라를 이동해도 화면 밖으로 나간 타일이 계속 렌더링됨.

### 원인

`TerrainTileManager.updateVisibility()`가 visible 타일에만 `isVisible = true`를 설정하고,
화면 밖 타일에 대해 `isVisible = false` 처리를 누락.

```typescript
// 수정 전 — visible 타일만 처리
for (const [key, tile] of this.cache) {
  if (!visibleKeys.has(key)) continue; // 화면 밖 타일은 그냥 통과
  tile.mesh.isVisible = true;
}
```

### 수정

```typescript
// 수정 후 — 모든 캐시 타일에 대해 visible/invisible 갱신
for (const [key, tile] of this.cache) {
  if (!tile.mesh) continue;
  const visible = visibleKeys.has(key);
  tile.mesh.isVisible = visible;
  tile.state = visible ? TileState.Visible : TileState.Active;
}
```

---

## Fix 2: parseTileKey — 잘못된 key 형식 silent fail 방지

`parseTileKey()`에 유효성 검사 추가. 형식 오류 시 즉시 에러 throw.

```typescript
export function parseTileKey(key: string): TileCoord {
  const parts = key.split('_');
  if (parts.length !== 3) throw new Error(`Invalid tile key format: ${key}`);
  const [tileX, tileY, level] = parts.map(Number);
  if (isNaN(tileX) || isNaN(tileY) || isNaN(level)) throw new Error(`Invalid tile key values: ${key}`);
  return { tileX, tileY, level };
}
```

---

## Fix 3: enforceConsistency — 무한루프 방지

`while (changed)` 루프에 최대 반복 횟수(20회) 제한 추가.
이론적으로 pathological한 LOD 배치에서 루프가 종료되지 않을 수 있었음.

```typescript
let changed = true;
let iterations = 0;
while (changed && iterations++ < 20) {
```

---

## Fix 4: bbCache — dispose 시 캐시 정리

`TerrainRenderer`의 `bbCache`(`Map<string, BoundingBox>`)가 타일 dispose 후에도 항목을 유지해
장기 세션에서 메모리가 계속 증가하는 문제 수정.
타일 dispose와 동시에 bbCache에서도 제거.

```typescript
for (const key of cachedKeys) {
  if (!visibleKeys.has(key)) {
    this.tileManager.dispose(parseTileKey(key));
    this.bbCache.delete(key); // 추가
  }
}
```

---

## Fix 5: 매직 넘버 주석 추가

| 위치 | 매직 넘버 | 추가된 주석 |
|------|-----------|------------|
| `LODSelector.ts:46` | `1.2` | Babylon.js 기본 near plane(~1.0)보다 약간 큰 값으로, near clip 직전 타일 처리 안정화용 |
| `TerrainMeshBuilder.ts:182` | `+ 2` | 부동소수점 오차와 수직 절벽에서 skirt가 짧아질 경우를 대비한 최소 여유값 |

---

## 수정 파일

| 파일 | 변경 |
|------|------|
| `src/engine/terrain/TerrainTileManager.ts` | `updateVisibility()` — 모든 타일 visible 상태 갱신 |
| `src/engine/terrain/TerrainTile.ts` | `parseTileKey()` — 유효성 검사 추가 |
| `src/engine/renderer/TerrainRenderer.ts` | `enforceConsistency()` 반복 제한, `bbCache` dispose 연동 |
| `src/engine/lod/LODSelector.ts` | `1.2` 매직 넘버 주석 |
| `src/engine/terrain/TerrainMeshBuilder.ts` | `+ 2` 매직 넘버 주석 |
