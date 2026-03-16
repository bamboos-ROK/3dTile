# 05 — 휠 고도 조절 + LOD 버그 수정

## 배경

이번 세션에서 세 가지 작업을 수행했다.

1. 마우스 휠로 카메라 고도를 조절하는 기능 추가
2. `LOD_THRESHOLDS` 마지막 항목이 실제로 사용되지 않는 버그 수정
3. Quadtree traversal 단계에서 Frustum culling이 누락된 버그 수정

---

## 1. 마우스 휠 고도 조절

### 배경

기존 카메라는 W/S/A/D 키와 마우스 드래그만 지원했다. 지형 뷰어로서 휠로 카메라 높이를 조절하면 LOD 전환 효과를 직관적으로 확인할 수 있다.

### 초기 구현 및 수정

처음에는 휠로 카메라가 바라보는 방향으로 전진/후퇴하도록 구현했다. 그러나 이는 W/S 키와 동일한 동작이라 차별성이 없었다.

→ **Y축 고도만 변경**하는 방식으로 수정:

```
휠 위 → camera.position.y 감소 (줌인, 지형에 가까워짐)
휠 아래 → camera.position.y 증가 (줌아웃, 지형에서 멀어짐)
```

### 수정 내용 — `CameraController.ts`

```typescript
private static readonly ZOOM_SPEED = 1.0;
private static readonly MIN_HEIGHT = 20;

this.wheelHandler = (e: WheelEvent) => {
  e.preventDefault();
  const delta = e.deltaY * CameraController.ZOOM_SPEED;
  const nextY = this.camera.position.y + delta;
  if (nextY >= CameraController.MIN_HEIGHT) {
    this.camera.position.y = nextY;
  }
};
canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
```

- `MIN_HEIGHT = 20`: 지형 내부로 진입 방지
- `passive: false` + `preventDefault()`: 페이지 스크롤 방지
- `dispose()` 메서드 추가: 이벤트 리스너 정리

---

## 2. LOD_THRESHOLDS[3] = 50 미사용 버그

### 원인 분석

```typescript
const LOD_THRESHOLDS = [400, 200, 100, 50]; // 4개 항목

for (let level = 0; level < this.maxLevel; level++) { // maxLevel=3 → 인덱스 0,1,2만 순회
  if (distance > LOD_THRESHOLDS[level]) return level;
}
return this.maxLevel;
```

`maxLevel = 3`이면 루프가 인덱스 0, 1, 2만 접근한다. `LOD_THRESHOLDS[3] = 50`은 체크되지 않아 CLAUDE.md 스펙에 정의된 Level 4(256 타일)가 실제로 활성화되지 않는 문제가 있었다.

| 거리 범위 | 수정 전 반환 레벨 | 수정 후 반환 레벨 |
|-----------|-----------------|-----------------|
| > 400     | 0               | 0               |
| 200 ~ 400 | 1               | 1               |
| 100 ~ 200 | 2               | 2               |
| 50 ~ 100  | 3 (maxLevel)    | 3               |
| ≤ 50      | 3 (maxLevel)    | 4 (maxLevel)    |

### 수정 내용

**`LODSelector.ts`**:
- 생성자 기본값: `maxLevel = 3` → `maxLevel = 4`
- 루프 조건: `level < this.maxLevel` → `level < LOD_THRESHOLDS.length`

**`LocalGridTiling.ts`**:
- 생성자 기본값: `maxLevel = 3` → `maxLevel = 4`

### 효과

카메라가 거리 50 이하로 접근하면 Level 4 타일(16×16 world unit, 256개)로 세분화된다. Heightmap 1픽셀 = 1 버텍스 샘플로 최고 해상도 렌더링.

---

## 3. Traverse 단계 Frustum Culling 미적용 버그

### 원인 분석

기존 구조:

```
traverse() → 모든 타일 LOD 계산 → mesh 생성
→ updateVisibility() → 시야 밖 타일 isVisible = false
```

`traverse()`가 카메라 뒤쪽, 시야 밖 타일에도 LOD 계산을 수행하고 mesh를 생성했다. Frustum culling은 `updateVisibility()`에서만 적용되어, 이미 생성된 invisible mesh를 뒤늦게 숨기는 구조였다.

### 수정 내용 — `TerrainRenderer.ts`

`traverse()` 진입부에 AABB → Frustum 체크 추가:

```typescript
private traverse(
  coord: TileCoord,
  cameraPos: Vector3,
  frustumPlanes: Plane[],
  visibleKeys: Set<string>,
  visibleCoords: TileCoord[]
): void {
  const bounds = this.tiling.tileBoundsToWorld(coord);

  // Frustum 밖이면 skip → mesh 생성 안 함
  const bb = new BoundingBox(
    new Vector3(bounds.minX, 0, bounds.minZ),
    new Vector3(bounds.maxX, 480, bounds.maxZ)
  );
  if (!bb.isInFrustum(frustumPlanes)) return;

  // 기존 LOD 로직 ...
}
```

수정된 구조:

```
traverse() → frustum 체크 → 시야 안 타일만 LOD 계산 → mesh 생성
```

### 효과

- 카메라 뒤쪽 및 시야 밖 타일의 mesh가 생성되지 않음
- 카메라를 회전하면 새 시야 방향의 타일만 생성되고 이전 방향 타일은 dispose됨
- 불필요한 GPU 메모리 사용 감소

---

## 수정 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `src/engine/camera/CameraController.ts` | 휠 고도 조절 이벤트 추가, dispose() 추가 |
| `src/engine/lod/LODSelector.ts` | maxLevel 기본값 4, 루프 조건 수정 |
| `src/engine/tiling/LocalGridTiling.ts` | maxLevel 기본값 4 |
| `src/engine/renderer/TerrainRenderer.ts` | traverse에 frustumPlanes 전달 + frustum check 추가 |
