# 08 — 타일 경계 Seam 수정 (Heightmap 법선 + Skirt)

## 배경

타일 LOD 지형에서 두 가지 경계 문제가 발생:

1. **법선 불일치 (격자선)** — 같은 LOD 타일 간 경계에서 격자선이 음영 차이로 보임
2. **T-junction 균열** — 다른 LOD 레벨 타일이 인접할 때 기하학적 틈 발생

---

## 수정 내용 (`TerrainMeshBuilder.ts`)

### 수정 1 — Heightmap 기반 전역 법선 계산

**문제:** `VertexData.ComputeNormals()`는 타일 내 삼각형만 참조해 경계 버텍스 법선이 인접 타일과 달라짐 → 라이팅 불연속 → 격자선 시각화

**해결:** 중앙차분법으로 heightmap에서 직접 법선 계산. 동일 픽셀 위치의 버텍스는 타일에 관계없이 항상 동일한 법선을 가짐.

```typescript
function computeHeightmapNormal(hm, px, py): [number, number, number] {
  const dydx = (sampleHeight(hm, px+1, py) - sampleHeight(hm, px-1, py)) / (2 * PIXEL_WORLD_SIZE);
  const dydz = (sampleHeight(hm, px, py+1) - sampleHeight(hm, px, py-1)) / (2 * PIXEL_WORLD_SIZE);
  // N = normalize(-dydx, 1, -dydz)  Babylon.js Y-up 기준
}
```

`VertexData.ComputeNormals()` 호출 제거.

---

### 수정 2 — Skirt Geometry

**문제:** LOD 레벨이 다른 인접 타일은 경계 버텍스 위치가 맞지 않아 틈(crack) 발생

**해결:** 각 타일 4변에 아래로 내려가는 수직 삼각형(skirt) 추가. 틈을 기하학적으로 막는 대신 시각적으로 가림.

```
타일 표면 ────────────┐
                       │ skirt (수직 벽)
                       │
skirt 하단 ────────────┘
```

**깊이 계산 (per-vertex):**
```typescript
const depth = Math.max(
  Math.abs(sampleHeight(hm, px+1, py) - h),
  Math.abs(sampleHeight(hm, px-1, py) - h),
  Math.abs(sampleHeight(hm, px, py+1) - h),
  Math.abs(sampleHeight(hm, px, py-1) - h),
) + 2;
```
주변 1픽셀 최대 높이 변화량 = LOD 보간 오차의 상한. 상수 대신 heightmap 데이터 기반.

**와인딩 방향:**

| 변 | 바깥 방향 | 와인딩 |
|----|----------|--------|
| North (row=0) | -Z | 정순 |
| South (row=n-1) | +Z | **역순** |
| West (col=0) | -X | **역순** |
| East (col=n-1) | +X | 정순 |

South/West(edgeIdx 1, 2)만 역순 적용 → back-face culling 시에도 바깥쪽에서 보임.

---

## Known Issues

- **skirt 깊이 과소 추정 가능성**: 현재 1픽셀 기준으로 계산하지만 LOD가 2단계 이상 차이날 경우 더 큰 깊이가 필요할 수 있음
- **극단적 경사에서 skirt 하단 노출**: 카메라를 매우 낮은 각도로 내릴 경우 skirt 하단이 보일 수 있음
- **근본적 해결책**: Stitching(LOD 경계 버텍스를 인접 타일에 맞춰 재구성) 또는 Dependent LOD(인접 타일 LOD 차이 1 이하 강제)로 교체하면 skirt 불필요

## 관련 파일

- `src/engine/terrain/TerrainMeshBuilder.ts` — 모든 수정이 이 파일에 집중
