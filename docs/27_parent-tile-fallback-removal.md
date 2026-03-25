# 27. 부모 타일 폴백 로직 제거

## 배경

`25_quantized-mesh-loader` 작업 중, 자식 타일 fetch 실패 시 부모 타일의 데이터를 가져와 자식 영역만 잘라내 렌더링하는 폴백 체인이 구현됐다.
그러나 이 기능은 별도 문서화 없이 `26_zombie-tile-fix` 커밋에 묻혀 들어갔고, 그 결과:

- 의도적으로 추가된 기능인지, 파생된 부산물인지 맥락이 불분명했다.
- 기능을 되돌리려 해도 `26`과 같은 커밋에 섞여 git rollback이 불가능했다.

## 추가됐던 로직 구조

### `LODTraverser.ts`

`loadWithFallback(x, y, z, bounds, srcX, srcY, srcZ)` 재귀 함수:
1. `tileLoader(srcX, srcY, srcZ, targetX, targetY, targetZ)` 호출
2. 실패 시 → `getParentCoord(srcX, srcY, srcZ)`로 부모 좌표 계산
3. 부모로 `loadWithFallback` 재귀 호출
4. 루트까지 올라가도 실패 → debug mesh 생성

`TileLoaderFn` 타입에 `targetX?/targetY?/targetZ?` 선택적 파라미터가 추가됐었다.

### `QuantizedMeshTileLoader.ts`

`buildMeshForTarget(targetX, targetY, targetZ, srcX, srcY, srcZ, parsed)`:
- `n = targetZ - srcZ` (조상과의 레벨 차이)로 스케일 계산
- src u,v 공간에서 target 영역의 `[uMin, uMax] × [vMin, vMax]` 계산
- `BOUNDARY_EPS`(= 0.5/32767)로 경계 vertex 포함 범위 확장
- target bounds 안의 vertex만 필터링 후 새 인덱스 매핑
- 3개 vertex 모두 in-bounds인 삼각형만 유지
- positions를 target bounds 공간으로 remapping 후 mesh 생성

## 제거 결정 이유

- 복잡도 대비 실용성 불명확: 서버가 응답하지 않는 타일에 대해 부모 데이터를 억지로 잘라내 렌더링해도 시각 품질이 보장되지 않음
- 구현 정확도 불확실: vertex 필터링 방식의 boundary 처리가 완전하지 않을 수 있음
- 문서화 없이 추가되어 유지보수 부담

## 기능적 롤백 내용

### `LODTraverser.ts`

- `loadWithFallback` 함수 전체 제거
- `TileLoaderFn` 타입에서 `targetX?/targetY?/targetZ?` 파라미터 제거
- `getParentCoord` import 제거
- `syncTiles`에서 직접 `tileManager.load()` + `.catch()` 호출로 단순화:
  - 실패 시 부모 탐색 없이 바로 debug mesh(wireframe 평면) 생성

### `QuantizedMeshTileLoader.ts`

- `BOUNDARY_EPS` 상수 제거
- `buildMeshForTarget` 제거 → `buildMesh(x, y, z, parsed)`로 교체
  - src/target 구분 없이 fetch한 타일 데이터를 그대로 해당 타일 bounds에 매핑
  - vertex 필터링, 인덱스 재매핑 로직 전부 제거

## 현재 동작

타일 fetch 실패 → catch → debug mesh(wireframe 평면, z레벨 색상) 즉시 생성.
부모 탐색 없음.

## 교훈

새 기능을 추가할 때는 반드시 해당 세션에서 별도 docs 파일을 작성하고, 독립된 커밋으로 남겨야 한다.
다른 작업과 함께 커밋될 경우 기능 단위의 추적/롤백이 불가능해진다.
