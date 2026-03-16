# 11. SSE 기반 LOD 구현 및 기준점 실험 히스토리

## 배경

이전 구현은 카메라-타일 거리를 고정 임계값([400, 200, 100, 50])과 비교하는 **거리 기반 LOD**였다.

**문제점:**
- FOV나 해상도가 바뀌면 임계값을 수동으로 재조정해야 함
- 화면에 얼마나 크게 보이는지를 반영하지 못함 (멀리 있어도 FOV가 크면 크게 보일 수 있음)

---

## SSE(Screen-Space Error) 공식

```
screenError = geometricError × projFactor / distance
```

- **geometricError**: 타일의 기하학적 오차 근사값 → `bounds.size / 2` (타일 XZ 크기의 절반)
- **projFactor**: 화면 투영 계수 → `screenHeight / (2 × tan(fov / 2))`
- **distance**: 카메라와 타일 AABB 사이의 3D 최단거리

판단 기준:
- `screenError < pixelThreshold` → 현재 LOD로 충분, 세분화 불필요
- `screenError ≥ pixelThreshold` → 세분화 필요

FOV·해상도 변화에 자동 적응하는 것이 거리 기반 대비 핵심 장점이다.

---

## LOD 기준점 실험 히스토리

SSE 도입 후 "어느 지점을 기준으로 거리를 측정할 것인가"에 대해 세 가지 방식을 실험했다.

### 시도 1: camera.target XZ + camera.position Y (하이브리드)

```ts
const t = this.camera.target;
const cameraPos = new Vector3(t.x, this.camera.position.y, t.z);
```

**문제**: UniversalCamera의 `camera.target`은 카메라가 바라보는 절대 좌표.
카메라를 얕은 각도로 틸트하면 `target.x/z`가 지형 밖 수백~수천 units로 벗어남
→ 모든 타일이 카메라에서 멀어져 LOD 0(가장 거침)으로 유지됨.

### 시도 2: 시선 Ray-Y=0 교차점

```ts
const dir = Vector3.Normalize(this.camera.target.subtract(pos));
if (dir.y < -1e-6) {
  const t = -pos.y / dir.y;
  refX = pos.x + dir.x * t;
  refZ = pos.z + dir.z * t;
}
```

**문제**: 수학적으로는 더 정확하지만 근본 문제는 동일.
고도 800, 얕은 각도(예: 20°)에서 교차점이 2000+ units 앞으로 이탈
→ LOD 기준이 너무 멀리 집중됨. 가까운 지형의 디테일이 올라가지 않음.

### 최종 결정: camera.position (표준 방식)

```ts
const cameraPos = this.camera.position;
```

**근거**: 표준 terrain LOD 시스템(Cesium, Unreal, Unity 등)은 camera.position 기반.
- Frustum culling이 화각 밖 타일을 제거하므로, 남은 visible 타일은 모두 화면 내 타일
- 카메라에 가까운 타일 = 화면에 크게 보이는 타일 → 고LOD 적절
- 카메라에 먼 타일 = 화면에 작게 보이는 타일 → 저LOD로 충분

"발 아래만 고LOD"처럼 느껴지는 것은 기하학적으로 올바른 동작이다.
화면 하단(가까운 지형)은 실제로 카메라에 가까워 고LOD가 필요하고,
화면 상단(먼 지형)은 실제로 카메라에서 멀어 저LOD로도 화면 품질이 충분하다.

---

## pixelThreshold 설정

| threshold | 고도 800, 500u 앞 타일 (level 0) | 동작 |
|-----------|--------------------------------|------|
| 600 (초기) | screenError ≈ 465 < 600 → 충분 | LOD 0 유지, 흐림 |
| 200 (최종) | screenError ≈ 465 > 200 → 부족 | 세분화 → level 2, 선명 |

threshold를 낮추면 더 먼 거리의 타일도 세분화되어 전반적으로 디테일이 높아진다.
반면 타일 수가 증가하므로 성능과 트레이드오프가 있다.

**최종값: `pixelThreshold = 200`**

---

## 최종 구현 파라미터

| 항목 | 값 | 위치 |
|------|-----|------|
| geometricError | `bounds.size / 2` | `LODSelector.isSufficientDetail()` |
| projFactor | `screenHeight / (2 × tan(fov / 2))` | `TerrainRenderer.update()` |
| pixelThreshold | `200` | `LODSelector` 생성자 기본값 |
| LOD 기준점 | `camera.position` | `TerrainRenderer.update()` |
| 거리 계산 | 카메라-타일 AABB 3D 최단거리 | `LODSelector.isSufficientDetail()` |

---

## 관련 파일

- `src/engine/lod/LODSelector.ts` — SSE 계산 및 판단
- `src/engine/renderer/TerrainRenderer.ts` — projFactor 계산, quadtree traversal
