# 17 — LOD 경계 균열 수정 (BVS 방향별 조건부 적용)

## 배경

Heightmap 기반 LOD 지형에서 레벨이 다른 타일이 맞닿는 경계에 균열(crack/seam)이 발생하는 문제.
기존에 BVS(Border Vertex Snapping)와 Skirt geometry가 이미 구현되어 있었지만 균열이 남아 있었음.

---

## 디버깅 과정

### 1차 — 외부 피드백 검증 (결론: 피드백 오류)

피드백 내용: T-junction 판별식 `(col + tileX) % 2`가 잘못되었고,
`globalCol = tileX * cells + col` 기반으로 바꿔야 한다.

**수학적 검증 결과**: `cells = 31`은 홀수이므로

```
(tileX * 31 + col) % 2 = (tileX * 1 + col) % 2 = (tileX + col) % 2
```

두 공식은 완전히 동치 → 피드백 오류, 수정 불필요.

---

### 2차 — LOD 레벨 차이 제한 (필요하지만 불충분)

**발견**: 쿼드트리 순회에 인접 타일 LOD 차이 제약이 없어서 level 4 ↔ level 1처럼
2레벨 이상 차이가 나는 타일이 맞닿을 수 있었음.
BVS의 `bvsStep = hmTileSize / cells`는 1레벨 차이에만 올바르게 동작하므로 이 경우 오작동.

**수정**: `TerrainRenderer.enforceConsistency()` 추가.
`traverse()` 이후 후처리로 인접 타일 레벨 차이를 최대 1로 제한.

- 각 visible 타일의 4방향 이웃을 검사
- 이웃의 ancestor가 2레벨 이상 coarse하면 그 ancestor를 4개 children으로 강제 분할
- 변화 없을 때까지 반복

**결과**: 균열 감소했지만 여전히 남아 있었음.

---

### 3차 — BVS 방향별 조건부 적용 (근본 수정)

**진짜 원인**:

BVS가 타일의 **모든 border**에 무조건 적용됨.
그런데 BVS는 "내 이웃이 coarser(거침) → 내가 이웃에 맞춰 스냅"하는 로직인데,
반대로 "내가 coarser → 이웃이 나에게 맞춰야 할 때"도 내 border를 스냅해버림.

```
Level 3 타일 (fine) ←─ 경계 ─→ Level 2 타일 (coarse)
```

| 역할 | 올바른 동작 |
|------|------------|
| Level 2 (coarse) | 기준. border를 raw heightmap 값으로 유지 |
| Level 3 (fine) | Level 2의 기준 높이에 T-junction 스냅 |

**현재 잘못된 동작**:

Level 2 타일도 자신의 east border에 BVS 스냅을 적용 → border 높이가 raw heightmap과 달라짐.
Level 3 타일은 Level 2의 "raw heightmap" 값을 가정하고 스냅하므로 → **불일치 → 균열**.

수학적으로: Level 2 row=k+1이 T-junction으로 스냅되면

```
L2_row_k+1 = (h(y_k) + h(y_k+2)) / 2        ← BVS 스냅 결과
L3 T-junction snap = (h(y_k) + h(y_k+1)) / 2 ← L3의 기대값
L2 mesh 선형보간 = (3*h(y_k) + h(y_k+2)) / 4 ← 실제 표면값
```

셋 다 달라서 균열 발생.

**수정 원칙**: BVS는 이웃이 1레벨 더 거친(coarser) 방향에만 적용.
이웃이 같은 레벨이거나 더 세밀하면 raw heightmap 사용.

---

## 최종 구현

### 수정 파일 1: `src/engine/terrain/TerrainMeshBuilder.ts`

`CoarserBorders` 인터페이스 추가:

```typescript
export interface CoarserBorders {
  N: boolean; S: boolean; W: boolean; E: boolean;
}
```

`buildTerrainMesh` 파라미터 추가:

```typescript
export function buildTerrainMesh(
  ...,
  coarserBorders: CoarserBorders = { N: false, S: false, W: false, E: false },
)
```

`borderSnapHeight` 변경 — 방향별 조건부 BVS:

```typescript
const onCoarserNS = (row === 0 && coarserBorders.N) || (row === cells && coarserBorders.S);
const onCoarserWE = (col === 0 && coarserBorders.W) || (col === cells && coarserBorders.E);
if (!onCoarserNS && !onCoarserWE) return sampleHeight(hm, px, py); // BVS 미적용
```

### 수정 파일 2: `src/engine/renderer/TerrainRenderer.ts`

`computeCoarserBorders()` 추가:

```typescript
private computeCoarserBorders(coord: TileCoord, visibleKeys: Set<string>): CoarserBorders {
  // 각 방향 이웃이 same-level이면 false
  // level-1 ancestor가 visible이면 true (coarser)
  // level+1 타일이면 false (finer → 이 타일이 기준)
}
```

`enforceConsistency()`: 인접 타일 레벨 차이 최대 1 제한 (2차 수정).

`update()` 처리 흐름:

```
traverse() → enforceConsistency() → computeCoarserBorders() → getOrCreate(coord, coarserBorders)
```

### 수정 파일 3: `src/engine/terrain/TerrainTileManager.ts`

- `bordersCache: Map<string, string>` 추가 (이전 coarserBorders 상태 저장)
- `getOrCreate(coord, coarserBorders)`: coarserBorders가 변경되면 기존 mesh 폐기 후 재생성
- `dispose()`: `bordersCache` 함께 정리

---

## 핵심 교훈

BVS는 **"내가 finer일 때, coarser 이웃에 맞추는"** 단방향 로직이다.
coarser 타일이 자신의 border를 임의로 스냅하면 finer 타일의 스냅 기준값이 틀어진다.
→ BVS는 반드시 방향 정보(coarserBorders)를 보고 조건부로 적용해야 한다.
