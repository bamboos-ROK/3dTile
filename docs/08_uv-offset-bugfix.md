# 08 — UV 오프셋 버그 수정 (텍스처 2×2 분할 문제)

## 증상

텍스처를 적용했을 때 지형 전체가 **2×2 그리드처럼 4등분**되어 보임.
언뜻 그리드(Tile) 분할 문제처럼 보이지만, 실제 원인은 **UV 좌표 계산 오류**.

## 원인

`TerrainMeshBuilder.ts`의 UV 계산 코드:

```typescript
// 수정 전 (잘못됨)
uvs.push(wz / TERRAIN_SIZE, 1.0 - wx / TERRAIN_SIZE);
```

World 좌표계는 **중앙이 원점(0)** — 즉 X/Z 범위가 `-256 ~ +256`.
`TERRAIN_SIZE = 512`로 나누면:

| 축 | 계산 | 결과 UV 범위 |
|----|------|-------------|
| U  | `wz / 512` | `-0.5 ~ +0.5` |
| V  | `1.0 - wx / 512` | `+0.5 ~ +1.5` |

UV가 `[0, 1]`을 벗어나면 텍스처 WRAP 모드에 의해 반복되는데,
가로/세로 각각 중앙에서 반씩 잘려 반복되면서 **4개 조각이 이어붙여진 패턴**으로 보임.

## 수정

World 좌표에 `TERRAIN_SIZE / 2`(= 256) 오프셋을 더해 `[0, 1]`로 정규화:

```typescript
// 수정 후 (올바름)
uvs.push((wz + TERRAIN_SIZE / 2) / TERRAIN_SIZE, 1.0 - (wx + TERRAIN_SIZE / 2) / TERRAIN_SIZE);
```

수정 위치: `src/engine/terrain/TerrainMeshBuilder.ts` — `buildTerrainMesh()` 내 vertices 루프

## 교훈

- World 좌표계가 **중앙 원점(-N ~ +N)** 이면, UV = `worldCoord / totalSize`만으로는 항상 `[0,1]` 범위가 나오지 않음.
- 올바른 공식: `UV = (worldCoord + totalSize / 2) / totalSize`
- 텍스처가 그리드처럼 분할되어 보일 때 → **Tile 수 문제 전에 UV 범위를 먼저 확인**할 것.
