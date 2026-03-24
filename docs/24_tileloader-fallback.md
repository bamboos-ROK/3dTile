# 24. TileLoader 분리 및 디버그 타일 폴백 구조

## 배경

`LODTraverser.syncTiles()`는 새 타일이 필요할 때마다 무조건 `createDebugTileMesh()`를 호출하고 있었다.
실제 타일 로더와 디버그 시각화 로직이 뒤섞인 구조로, 나중에 실제 heightmap 기반 메시를 붙이기 어려웠다.

## 목표

traverse 로직과 디버그 타일 생성을 분리하여:
- 실제 타일 로더를 먼저 시도
- 로드 실패 시에만 디버그 메시를 폴백으로 생성

## 변경 내용

### 1. `LODTraverser.ts` — TileLoaderFn + 생성자 파라미터 추가

```typescript
type TileLoaderFn = (
  x: number,
  y: number,
  z: number,
) => Promise<Partial<Pick<Tile, "dem" | "texture" | "mesh">>>;

export class LODTraverser {
  constructor(
    private tileManager: TileManager,
    private scene: Scene,
    private tileLoader: TileLoaderFn,  // ← 추가
  ) {}
}
```

### 2. `LODTraverser.ts` — syncTiles() 변경

기존: 새 타일 발견 시 무조건 디버그 메시 생성

```typescript
const tile = this.tileManager.getTile(x, y, z);
const bounds = getTileBounds(x, y, z);
tile.mesh = createDebugTileMesh(tile, bounds, this.scene);
tile.state = "ready";
```

변경 후: 실제 로더 시도 → 실패 시 디버그 메시 폴백

```typescript
const bounds = getTileBounds(x, y, z);
this.tileManager
  .load(x, y, z, () => this.tileLoader(x, y, z))
  .catch(() => {
    const tile = this.tileManager.getTile(x, y, z);
    tile.mesh = createDebugTileMesh(tile, bounds, this.scene);
    tile.state = "ready";
  });
```

### 3. `TileManager.ts` — load() 에러 re-throw

기존 `.catch()`가 에러를 삼켜버려 호출자의 `.catch()`가 실행되지 않는 버그 수정:

```typescript
// 기존
.catch(() => {
  tile.state = "error";
})

// 수정
.catch((e: unknown) => {
  tile.state = "error";
  throw e;  // 호출자의 .catch()로 에러 전파
})
```

### 4. `main.ts` — placeholder TileLoader 전달

현재 실제 로더 미구현 → 항상 reject하는 placeholder 전달.
실제 로더가 구현되면 이 부분만 교체하면 된다.

```typescript
const tileLoader = (_x: number, _y: number, _z: number) =>
  Promise.reject(new Error("tile loader not implemented"));

const traverser = new LODTraverser(tileManager, scene, tileLoader);
```

## 데이터 흐름

```
syncTiles(visibleKeys)
  └─ 새 타일 발견
      └─ tileManager.load(x, y, z, () => tileLoader(x, y, z))
          ├─ 성공 → tile.state = "ready", tile.mesh = 실제 mesh
          └─ 실패 → catch
                └─ tile.mesh = createDebugTileMesh(...)  ← 디버그 폴백
                └─ tile.state = "ready"
```

## 버그: TileManager.load() 에러 삼킴

### 증상
디버그 타일이 화면에 표시되지 않음.

### 원인
`TileManager.load()` 내부 `.catch()`가 에러를 잡고 `state = "error"`만 설정한 뒤
에러를 re-throw하지 않아, 반환된 Promise가 항상 resolve 상태가 됨.
→ `LODTraverser`의 `.catch()` 콜백이 실행되지 않음.

### 수정
`TileManager.load()` `.catch()` 에서 `throw e` 추가.

## 향후 확장

`main.ts`의 `tileLoader`를 HeightmapLoader 기반 실제 구현으로 교체하면,
성공 시 실제 heightmap 메시가 표시되고 디버그 타일은 더 이상 생성되지 않는다.
