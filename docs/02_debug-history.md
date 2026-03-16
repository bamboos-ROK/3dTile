# 디버깅 히스토리

초기 구현 완료 후 브라우저에서 발견된 버그와 수정 과정 기록.

---

## Bug 1 — Terrain 미표시 (검은 화면)

**증상:** 브라우저에서 캔버스에 아무것도 렌더링되지 않음.

**원인 A — Material 없음**
- Babylon.js v7은 material이 없는 mesh를 검게 렌더링
- 배경색도 어두운 계열(0.1, 0.1, 0.15)이라 구분 불가

**원인 B — Frustum planes 계산 시점**
- `scene.render()` 호출 전에 `Frustum.GetPlanes(scene.getTransformMatrix())`를 호출하면 Matrix.Zero() 반환
- 모든 타일이 frustum 밖으로 판정 → `isVisible = false`

**수정:**
- `TerrainMeshBuilder.ts`: `StandardMaterial` + `diffuseColor` 추가
- `TerrainRenderer.ts`: `scene.updateTransformMatrix()` 선행 호출 추가

---

## Bug 2 — Terrain Flat (높이 변화 없음)

**증상:** Wireframe으로 확인 시 완전히 평면 mesh로 구성됨.

**진단 과정:**
`loadHeightmap`에 디버그 로그 추가:
```
[Heightmap] size: 2048×2048
[Heightmap] R-channel  min=75  max=123  avg=92.9
```

**원인 A — `HEIGHTMAP_SIZE = 256` 하드코딩**
- 실제 PNG: 2048×2048, 코드 상수: 256
- Level 0 타일의 샘플 범위: `256 / 2^0 = 256px` → 이미지의 좌상단 256px만 사용 (전체의 1/64)
- 좌표 계산: `hmTileSize = 256 / 2^level` → 전체 이미지 커버 불가

**원인 B — HEIGHT_SCALE 부족**
- R채널 범위: 75~123 (전체 0~255 중 19%만 사용하는 이미지)
- HEIGHT_SCALE=50: 실제 height 변화량 = (123-75)/255 × 50 ≈ **9 units**
- 지형 512 units, 카메라 거리 500 units에서 9 units 차이 = 사실상 평면으로 보임

**수정:**
```typescript
// TerrainMeshBuilder.ts
const HEIGHT_SCALE = 200;  // 50 → 200
// HEIGHTMAP_SIZE 상수 제거, buildTerrainMesh에서 hm.width 사용
const hmTileSize = hm.width / Math.pow(2, coord.level);
```

---

## Bug 3 — Terrain 검은색 (조명 미적용)

**증상:** Solid 모드에서 terrain이 흙색 대신 검게 렌더링됨.

**사용자 실험:** Babylon Inspector에서 HemisphericLight의 direction Z값을 100이상으로 높이면 동작하는 것처럼 보임.

**원인 분석 — Winding Order 오류**

Babylon.js 규칙:
- **CCW (반시계방향)** = Front face (OpenGL 방식 채용)
- `ComputeNormals` 공식: `cross(p1−p2, p3−p2)`

기존 winding `tl, bl, tr` (위에서 내려다볼 때 CW = Back face):
```
p1p2 = tl - bl = (0, 0, -s)
p3p2 = tr - bl = (s, 0, -s)
cross 결과 = (0, -s², 0)  →  DOWN (-Y)
```

결과:
1. terrain 상단이 **Back face** → `backFaceCulling = false`로 임시 노출
2. 법선이 **-Y (하방)** → `HemisphericLight(0,1,0)` (sky=+Y) 기준에서 `groundColor`(검정) 적용

**Z=100이 "우연히" 동작한 이유:**
- `direction=(0,1,100)` normalized ≈ `(0, 0.01, 0.9999)` → sky 방향이 거의 +Z로 변함
- 법선 (-Y) 기준 blend ≈ 0.495 → 약 50% 밝기로 렌더링
- 물리적으로 틀린 조명이나 시각적으로 검지 않게 보임

**수정:**
```typescript
// TerrainMeshBuilder.ts — winding 반전 (CCW from above = FRONT face)
// 변경 전
indices.push(tl, bl, tr);
indices.push(tr, bl, br);
// 변경 후
indices.push(tl, tr, bl);
indices.push(tr, br, bl);
```

검증 — `tl, tr, bl` winding에 대해 ComputeNormals:
```
p1p2 = tl - tr = (-s, 0, 0)
p3p2 = bl - tr = (-s, 0, s)
cross = (0, +s², 0)  →  UP (+Y)  ✓
```

추가 수정:
- `mat.backFaceCulling = false` 제거 (workaround 불필요)
- `TerrainTileManager.ts` BoundingBox Y max: `50` → `200` (HEIGHT_SCALE과 일치)

---

## 핵심 학습 사항

| 항목 | 내용 |
|------|------|
| Babylon.js winding 규칙 | CCW = Front face (OpenGL 방식) |
| ComputeNormals 공식 | `cross(p1−p2, p3−p2)`, 순서에 따라 법선 방향 결정 |
| HemisphericLight | sky direction과 법선이 일치해야 diffuseColor 적용, 불일치 시 groundColor |
| Frustum 계산 시점 | `scene.render()` 전 반드시 `scene.updateTransformMatrix()` 선행 |
| Heightmap 크기 | 코드 상수 대신 `hm.width`/`hm.height` 동적 참조 |
