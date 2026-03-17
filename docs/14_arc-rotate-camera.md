# 14. ArcRotateCamera 리팩토링

## 배경

`UniversalCamera` 기반 RTS 카메라는 이동 시 `position`과 `target`을 항상 동시에 갱신해야 했고,
마우스 휠로 Y 절대 고도를 직접 조작하는 방식이었다.
`ArcRotateCamera`로 전환하면 `camera.target`만 이동하면 카메라가 자동으로 따라오는
단일 책임 구조가 되고, 휠은 `radius` 증감(자연스러운 줌)으로 대체된다.

## 변경 내용 (`src/engine/camera/CameraController.ts`)

### 카메라 타입 전환

| 항목 | 이전 | 이후 |
|---|---|---|
| 카메라 클래스 | `UniversalCamera` | `ArcRotateCamera` |
| 초기 위치 파라미터 | `position(-100, 800, 300)` | `alpha=-π/2, beta=π/3, radius=900` |
| 타겟 | `setTarget(Vector3.Zero())` | 생성자 5번째 인자 `Vector3.Zero()` |

### 입력 처리 변경

| 입력 | 이전 | 이후 |
|---|---|---|
| W/S/A/D | position + target 동시 이동 | `camera.target`만 이동 (position 자동 추종) |
| 마우스 드래그 | 시선 방향 변경 | alpha/beta 회전 (기본 제공) |
| 마우스 휠 | Y 절대 고도 직접 조작 + MIN_HEIGHT 가드 | radius 증감 (기본 제공) |

### forward / right 계산 방식

```ts
// 이전: target - position 투영 후 정규화
const dir = this.camera.target.subtract(this.camera.position);
dir.y = 0;
const forward = Vector3.Normalize(dir);

// 이후: alpha에서 직접 계산 (단위벡터, 정규화 불필요)
const forward = new Vector3(-Math.cos(alpha), 0, -Math.sin(alpha));
const right   = Vector3.Cross(Vector3.Up(), forward).normalize();
// Cross(Up, forward) = 시각적 right (+X when facing +Z)
// Cross(forward, Up) = 반전이므로 사용 금지
```

### 카메라 제한값 추가

```ts
camera.lowerBetaLimit  = Math.PI / 8;        // 22.5° — 정수직 하향 방지
camera.upperBetaLimit  = Math.PI / 2 - 0.05; // ~87°  — 지평선 진입 방지
camera.lowerRadiusLimit = 50;                 // 최소 줌인
camera.upperRadiusLimit = 2000;              // 최대 줌아웃
```

### 제거된 코드

- `wheelHandler` 이벤트 핸들러
- `MIN_HEIGHT` 상수
- `canvas.removeEventListener("wheel", ...)` (dispose)

## 타겟 구조

ArcRotateCamera의 타겟은 `Vector3` 좌표값이며, 실제 mesh 없이 "보이지 않는 피벗 포인트" 역할을 한다.
mesh 기반 타겟이 아닌 Vector3 타겟을 선택한 이유:

- `camera.target.y`를 항상 0(지면)으로 유지 가능 → LOD 기준점으로 안정적
- mesh에 종속되지 않아 `radius`, `target` 값이 예측 가능
- 향후 LOD 개선 시 `radius` 기반 pixelThreshold 동적 조절, `target`의 지면 기준 거리 계산 등에 활용 가능

## 외부 인터페이스 (무변경)

```ts
get position(): Vector3  // camera.position 반환
get target(): Vector3    // camera.target 반환
```

`TerrainRenderer`, `LODSelector` 등 외부에서 `cameraController.position`을 참조하는 코드는 변경 없음.

## Known Issues

없음.
