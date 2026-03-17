# 16 — LOD 거리 계산 개선: camera forward depth 투영

## 배경

`11_lod-sse.md`에서 구현된 SSE 기반 LOD 시스템은 거리 계산에 **AABB 최근접점까지의 유클리드 거리**를 사용했다.

```
screenError = (geometricError * projFactor) / distance
```

여기서 `distance`는 카메라 위치에서 타일 AABB 내의 가장 가까운 점까지의 3D 거리였다.

### 문제점

유클리드 거리는 카메라의 **시야 방향을 무시**한다. 카메라 측면 또는 대각선 방향에 있는 타일은 화면 중앙에 있는 타일과 거리가 같아도 실제 화면 상의 픽셀 크기가 다른데, 유클리드 거리를 쓰면 이를 구분할 수 없다.

결과적으로:
- 화면 가장자리의 타일이 실제보다 **가깝다고 판단**되어 불필요하게 세분화됨
- 카메라 FOV 변화에 따른 LOD 전환이 비직관적으로 동작함

---

## 변경 내용

### 핵심 아이디어

SSE(Screen-Space Error)의 본래 의미는 **카메라 앞으로의 투영 거리(depth)**를 기준으로 해야 한다.

```
depth = dot(tileCenter - cameraPos, cameraForward)
```

이 값은 타일 중심이 카메라 near plane 기준으로 얼마나 멀리 있는지를 나타내며, 화면 공간의 픽셀 크기 추정에 적합하다.

---

### LODSelector.ts 변경

**이전** (AABB 최근접점 유클리드 거리):
```ts
isSufficientDetail(cameraPos: Vector3, bounds: TileBounds, projFactor: number): boolean {
  const clampedX = Math.max(bounds.minX, Math.min(cameraPos.x, bounds.maxX));
  const clampedZ = Math.max(bounds.minZ, Math.min(cameraPos.z, bounds.maxZ));
  const dx = clampedX - cameraPos.x;
  const dy = HEIGHT_SCALE / 2 - cameraPos.y;
  const dz = clampedZ - cameraPos.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance < 1e-6) return false; // 카메라가 타일 내부
  const screenError = (geometricError * projFactor) / distance;
  return screenError < pixelThreshold;
}
```

**현재** (camera forward 투영 depth):
```ts
isSufficientDetail(cameraPos: Vector3, bounds: TileBounds, projFactor: number, cameraForward: Vector3): boolean {
  // depth = dot(tileCenter - cameraPos, cameraForward)
  const dx = bounds.centerX - cameraPos.x;
  const dy = HEIGHT_SCALE / 2 - cameraPos.y;
  const dz = bounds.centerZ - cameraPos.z;
  const depth = dx * cameraForward.x + dy * cameraForward.y + dz * cameraForward.z;

  if (depth < 1.0) return false; // 카메라 뒤 또는 near plane 이내
  const screenError = (geometricError * projFactor) / depth;
  return screenError < pixelThreshold;
}
```

**변경 포인트**:
| 항목 | 이전 | 현재 |
|------|------|------|
| 거리 기준점 | AABB 최근접점 | 타일 중심 |
| 거리 계산 방식 | 유클리드 거리 | forward 방향 내적(depth) |
| near plane 처리 | `distance < 1e-6` | `depth < 1.0` |
| 파라미터 | `cameraPos, bounds, projFactor` | `+ cameraForward: Vector3` |

---

### TerrainRenderer.ts 변경

`update()` 에서 forward 벡터를 계산하여 `traverse()`에 전달:

```ts
// update() 내부 추가
const forwardVec = this.camera.target.subtract(cameraPos).normalize();

// traverse() 호출 시 전달
this.traverse(rootCoord, cameraPos, frustumPlanes, projFactor, forwardVec);
```

`traverse()` 시그니처 변경:
```ts
// 이전
private traverse(coord, cameraPos, frustumPlanes, projFactor)

// 현재
private traverse(coord, cameraPos, frustumPlanes, projFactor, forwardVec: Vector3)
```

`lodSelector.isSufficientDetail()` 호출 업데이트:
```ts
this.lodSelector.isSufficientDetail(cameraPos, bounds, projFactor, forwardVec)
```

---

## 알려진 제한사항

- **타일 중심 기준**: depth는 타일 중심을 기준으로 계산된다. 타일 크기가 클수록(낮은 LOD 레벨) 중심과 가장자리의 오차가 커질 수 있다.
- **Y 높이 고정**: `dy` 계산에 `HEIGHT_SCALE / 2`를 사용하므로 지형 높이 변화를 반영하지 않는다. 평탄한 지형 기준으로는 합리적인 근사값이다.
- **카메라가 지형 위에 있는 정상적인 사용 시나리오**에서는 depth가 항상 양수이므로 문제없다.
