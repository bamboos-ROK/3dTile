# 26 — 좀비 타일 수정 (Zombie Tile Fix)

## 문제 현상

카메라 이동 중 dispose 대상 타일이 가끔 화면에 남는 현상.
디버그 카메라로 메인 카메라 주변을 관찰하면 극히 일부 debug 타일이 제거되지 않고 잔존.

---

## 수정 1: Ghost Mesh (loading 중 dispose → 이후 mesh 생성)

### 원인

`TileManager.load()`에서 `tile` 변수는 클로저로 캡처됨.
`disposeTile()`로 캐시에서 제거해도, 비동기 Promise가 완료되면
`Object.assign(tile, { mesh: newMesh })`가 실행되어 mesh가 생성됨.
이 mesh는 캐시와 무관하게 scene에 존재하므로 `syncTiles()`가 영원히 dispose하지 못함.

### 수정 내용

**`Tile.ts`** — TileState에 `"disposed"` 추가
```typescript
export type TileState = "idle" | "loading" | "ready" | "error" | "disposed";
```

**`TileManager.ts`** — `disposeTile()`에 상태 마킹 추가
```typescript
tile.state = "disposed";  // cache.delete 전에 마킹
this.cache.delete(key);
```

**`TileManager.ts`** — `load()` then 핸들러에 guard 추가
```typescript
.then((data) => {
  if (tile.state === "disposed") {
    (data as { mesh?: { dispose(): void } }).mesh?.dispose();
    return;
  }
  Object.assign(tile, data);
  tile.state = "ready";
})
```

**`LODTraverser.ts`** — `loadWithFallback` catch에 guard 추가
```typescript
.catch(() => {
  if (!this.tileManager.hasTile(x, y, z)) return;  // dispose된 타일 중단
  ...
})
```

---

## 수정 2: 병렬 Fallback 체인으로 인한 Debug Mesh 누수

### 원인

카메라가 "이동 → 복귀"하는 타이밍에 병렬 fallback 체인이 생성됨.

```
Frame N:   타일 A → loadWithFallback(A) → CHAIN_1 시작 (async fetch 중)
Frame N+1: 카메라 이동 → disposeTile(A) → cache 제거
Frame N+2: 카메라 복귀 → loadWithFallback(A) → CHAIN_2 시작, getTile(A)로 캐시 재등록

[async] CHAIN_1 fetch 완료 → catch 발동
  → hasTile(A) = true  ← CHAIN_2가 캐시에 재등록했으므로
  → CHAIN_1 되살아남 → CHAIN_1 + CHAIN_2 동시에 타일 A를 추적
```

`tileManager.load()` 내부 dedup에 의해 두 체인이 **같은 Promise를 공유**.
Promise 실패 시 **두 catch가 동시 발동** → 두 체인이 root까지 내려가서
`else` 분기(debug mesh 생성)를 동시에 실행.

```
CHAIN_1 else: tile.mesh = debugMesh1, state = "ready"
CHAIN_2 else: tile.mesh = debugMesh2  ← debugMesh1 dispose 없이 덮어씀
```

`debugMesh1`은 scene에 남지만 tile.mesh 참조가 끊겨 `syncTiles()`가 dispose 불가 → 좀비.

### 수정 내용

**`LODTraverser.ts`** — `loadWithFallback` else 분기에 2줄 추가
```typescript
} else {
  const tile = this.tileManager.getTile(x, y, z);
  if (tile.state === "ready") return;  // 다른 체인이 이미 처리 → 중단
  tile.mesh?.dispose();                // 혹시 남은 mesh 선정리 (방어)
  tile.mesh = createDebugTileMesh(tile, bounds, this.scene);
  tile.state = "ready";
}
```

`tile.state === "ready"` 체크:
microtask 큐 순서상 CHAIN_1이 먼저 state="ready" 설정 →
CHAIN_2는 "ready" 확인 후 즉시 return → 두 번째 debug mesh 생성 차단.

`tile.mesh?.dispose()`:
state 체크를 통과하더라도 기존 mesh가 있으면 선정리 (방어적 코드).

---

## 수정된 파일 목록

| 파일 | 수정 내용 |
|------|-----------|
| `src/engine/tile/Tile.ts` | TileState에 `"disposed"` 추가 |
| `src/engine/tile/TileManager.ts` | disposeTile 마킹 + load then guard |
| `src/engine/tile/LODTraverser.ts` | catch hasTile guard + else 분기 2줄 추가 |
