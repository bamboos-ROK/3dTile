# 15. 디버그 카메라 구현

## 목적

메인 카메라의 LOD 동작을 제3자 시점에서 확인하기 위한 디버그 카메라 및 LOD 레벨 시각화 기능 추가.

## 동작 방식

- **F 키**: 메인 카메라 ↔ 디버그 관찰 카메라 전환
- **디버그 카메라 활성 시**:
  - 타일이 LOD 레벨별 색상으로 오버라이드됨
  - 디버그 카메라는 마우스 드래그/휠로 독립 조작 가능
  - `scene.activeCamera`가 디버그 카메라로 전환되어 frustum culling도 디버그 카메라 기준으로 동작 (지형 전체가 보이므로 모든 타일의 LOD 색상 확인 가능)
  - LOD 거리 계산(`CameraController.position`)은 여전히 메인 카메라 기준 유지
- **메인 카메라 복귀 시**: 원래 텍스처 머티리얼 자동 복구

## LOD 색상 매핑

| Level | 색상 | 의미 |
|-------|------|------|
| 0 | 파란색 | 가장 거침 (타일 1개, 256×256 px) |
| 1 | 초록색 | |
| 2 | 노란색 | |
| 3 | 주황색 | |
| 4 | 빨간색 | 가장 세밀 (타일 256개, 16×16 px) |

## 변경 파일

| 파일 | 변경 내용 |
|------|---------|
| `src/engine/debug/DebugCameraOverlay.ts` | 신규: 디버그 카메라, F키 토글, LOD 색상 오버레이 |
| `src/engine/renderer/TerrainRenderer.ts` | `lastVisibleKeys` 필드 + `visibleTileKeys` getter 추가 |
| `src/engine/terrain/TerrainTileManager.ts` | `getTile(key)` getter 추가 |
| `src/main.ts` | `DebugCameraOverlay` 생성 및 렌더 루프 연결 |

## 디버그 카메라 초기 설정

- alpha: `-π/2`, beta: `π/3`, radius: `1500`
- radiusLimit: 200 ~ 3000
- betaLimit: π/8 ~ π/2-0.05
