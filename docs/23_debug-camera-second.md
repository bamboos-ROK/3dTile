# 23 — 디버그용 두 번째 카메라 추가

## 목적

Inspector 디버깅 시 사용할 두 번째 카메라를 추가. 기존 렌더링·LOD 시스템에 개입하지 않으며, 키보드 이동 키를 메인 카메라와 분리.

---

## 변경 내용

### 1. `CameraController` — `debug` 인자 추가

```typescript
constructor(scene: Scene, canvas: HTMLCanvasElement, debug = false)
```

- `debug` 필드 저장 후 `updateMovement()`에서 키 분기에 사용.

### 2. `CameraController.updateMovement()` — 키 분기

| `debug` | 이동 키 |
| ------- | ------- |
| `false` | ArrowUp / ArrowDown / ArrowLeft / ArrowRight |
| `true`  | W / S / A / D |

- 두 컨트롤러가 서로 다른 키를 쓰므로 `activeCamera` early return 불필요 → 제거.

```typescript
const forwardKey = this.debug ? "KeyW" : "ArrowUp";
const backKey    = this.debug ? "KeyS" : "ArrowDown";
const rightKey   = this.debug ? "KeyD" : "ArrowRight";
const leftKey    = this.debug ? "KeyA" : "ArrowLeft";
```

### 3. `main.ts` — 두 번째 `CameraController` 생성

```typescript
const camera  = new CameraController(scene, canvas);        // debug=false (방향키)
const camera2 = new CameraController(scene, canvas, true);  // debug=true  (WASD)
scene.activeCamera = camera.camera; // camera2 생성으로 변경된 activeCamera 복원
```

- `traverser.update(camera.camera)` — LOD는 항상 메인 카메라 기준 유지.
- `camera2.dispose()` — beforeunload 시 정리.

---

## 사용 방법

1. `npm run dev` 실행
2. Babylon Inspector → Scene Explorer → Cameras 에서 두 카메라 확인
3. Inspector에서 두 번째 카메라를 activeCamera로 전환하면 WASD로 조작 가능
4. 메인 카메라로 전환하면 방향키로 복귀

---

## 참고: 휠(줌) 동작

두 카메라 모두 `attachControl` 유지 → Babylon 내장 휠 줌이 각자 동작.
cross-camera 휠 분기(스크롤 → 메인 카메라 줌)는 인위적이라 판단해 적용하지 않음.
