# 04 — LOD 기준점 버그 수정

## 배경

카메라 패닝 기능 추가 후, 화면 중심 지역의 지형이 멀리 있는 지역보다 LOD가 낮게(거칠게) 렌더링되는 이질감이 발생.

---

## 원인 분석

### LOD 거리 계산 구조

`TerrainRenderer.update()`에서 LOD 선택에 `camera.position`을 전달:

```typescript
const cameraPos = this.camera.position; // ← 공중에 있는 카메라 실제 위치
this.traverse(this.tiling.getRoot(), cameraPos, ...);
```

`LODSelector.selectLevel()`은 타일 경계와 `cameraPos` 사이의 XZ 거리를 계산:

```typescript
const LOD_THRESHOLDS = [400, 200, 100];
// distance > 400 → Level 0 (가장 낮은 세밀도)
// distance ≤ 100 → Level 3 (가장 높은 세밀도)
```

### ArcRotateCamera position vs target

`ArcRotateCamera`의 `position`은 target으로부터 radius만큼 떨어진 **공중 위치**:

```
position.XZ 오프셋 ≈ radius × sin(beta) = 800 × sin(30°) = 400 units
```

즉 초기 상태(radius=800, beta=30°)에서 `camera.position`은 `target`으로부터 XZ 기준 약 **400 units** 떨어진 곳에 있음.

### 역전 현상

| 지역 | camera.position 기준 거리 | 계산된 LOD Level |
| ---- | ------------------------ | ---------------- |
| 화면 중심 (target 근처) | ~400 units | **Level 0** (가장 낮음) |
| 카메라 바로 아래 (보이지 않는 뒤쪽) | ~0 units | **Level 3** (가장 높음) |

화면 중심이 가장 거칠게, 카메라 후방이 가장 세밀하게 렌더링되는 역전이 발생.

---

## 수정 내용

`camera.position` 대신 **`camera.target`** (화면 중심)을 LOD 기준점으로 사용.

### CameraController.ts — target getter 추가

```typescript
get target(): Vector3 {
  return this.camera.target;
}
```

### TerrainRenderer.ts — LOD 기준점 변경

```typescript
// 수정 전
const cameraPos = this.camera.position;

// 수정 후
const cameraPos = this.camera.target;
```

---

## 효과

- `camera.target`(화면 중심)에서 타일까지의 거리 = 0 → Level 3 (가장 세밀)
- 화면 가장자리 타일은 target에서 멀수록 LOD가 낮아짐 → 자연스러운 LOD 분포
- 방향키 패닝 시 LOD가 화면 중심을 따라 자연스럽게 이동

---

## 수정 파일

| 파일 | 변경 내용 |
| ---- | --------- |
| `src/engine/camera/CameraController.ts` | `target` getter 추가 |
| `src/engine/renderer/TerrainRenderer.ts` | `camera.position` → `camera.target` |
