# 07. RTS 카메라 구현

## 배경

기존 UniversalCamera 기본 이동(W/S)은 카메라가 바라보는 방향 벡터(Y 성분 포함)로 전진/후진했다.
지형을 비스듬히 내려다보는 시점에서 W를 누르면 앞으로 이동하면서 동시에 고도가 낮아지는 효과가 생겨,
마우스 휠(Y 고도 조절)과 체감이 겹쳤다.

## 해결책: RTS 카메라

RTS(Real-Time Strategy) 카메라는 전략 게임(StarCraft, Age of Empires 등)에서 정착된 조작 방식으로,
입력 축별 역할을 명확히 분리한다.

| 입력 | 역할 |
|------|------|
| W / ↑ | XZ 수평 전진 (카메라 기울기 무관) |
| S / ↓ | XZ 수평 후진 |
| A / ← | XZ 수평 좌이동 |
| D / → | XZ 수평 우이동 |
| 마우스 휠 | Y 고도 증감 |
| 마우스 드래그 | 시선 방향 회전 |

## 구현 방법

### 기본 키보드 입력 제거

Babylon.js UniversalCamera의 기본 키보드 이동(방향 벡터 기반)을 제거하고 마우스 회전만 유지한다.

```ts
this.camera.inputs.removeByType("FreeCameraKeyboardMoveInput");
```

### 키 상태 추적

`keydown` / `keyup` 이벤트로 현재 눌린 키를 `Set<string>`에 관리한다. (`e.code` 기준 — 레이아웃 독립적)

```ts
window.addEventListener("keydown", (e) => this.keysDown.add(e.code));
window.addEventListener("keyup",   (e) => this.keysDown.delete(e.code));
```

### 매 프레임 XZ 이동 계산

`scene.onBeforeRenderObservable`에서 다음 순서로 이동량을 계산한다.

```
1. forward = normalize(camera.target - camera.position)
2. forward.y = 0  →  XZ 평면에 투영
3. forward = normalize(forward)
4. right = normalize(Cross(Up, forward))   // Cross(Up, fwd) → 올바른 우방 벡터
5. move = forward * forwardInput * MOVE_SPEED * dt
        + right   * rightInput  * MOVE_SPEED * dt
6. camera.position += move
   camera.target   += move   // 시선 방향 유지
```

`camera.target`도 함께 이동하지 않으면 이동 시 시선이 틀어진다.

> **Cross 순서 주의**: `Cross(forward, Up)`은 -X(좌) 방향, `Cross(Up, forward)`는 +X(우) 방향.

### 상수

```ts
MOVE_SPEED = 80  // units/sec (deltaTime 기반)
ZOOM_SPEED = 1.0 // 휠 픽셀당 Y 이동량
MIN_HEIGHT = 20  // 카메라 최저 고도
```

## 수정 파일

- [`src/engine/camera/CameraController.ts`](../src/engine/camera/CameraController.ts)
