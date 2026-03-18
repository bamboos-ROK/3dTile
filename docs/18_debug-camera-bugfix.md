# 18. 디버그 카메라 버그픽스

## 개요

`DebugCameraOverlay`의 두 가지 버그 수정:

1. LOD 색상 오버레이가 일부 타일에서 원본 텍스처로 렌더링되는 문제
2. 디버그 카메라 전환 시 카메라 이상 동작 (이중 입력, 마우스 충돌, target 드리프트)

---

## Bug 1: LOD 색상 오버레이 미적용

### 증상

디버그 모드(F키)에서 지형 일부 타일이 LOD 색상 대신 원본 diffuse 텍스처로 렌더링됨.

### 원인

`enforceConsistency()`가 인접 타일 LOD 차이를 1로 제한하기 위해 일부 타일의 `coarserBorders`를 변경한다. `coarserBorders`가 변경되면 `TerrainTileManager.getOrCreate()`는 기존 타일을 dispose하고 새 메시(terrainMat 할당)로 재생성한다.

문제: `DebugCameraOverlay.applyLodColors()`의 두 번째 루프가 `originalMaterials.has(key)` 체크로 이미 처리된 키를 스킵했기 때문에, 재생성된 새 타일에는 LOD 색상이 적용되지 않았다.

```
Frame N:   tile "1_1_2" → LOD 색상 적용, originalMaterials.set("1_1_2", terrainMat)
Frame N+1: coarserBorders 변경 → 타일 dispose + 재생성 (terrainMat)
           applyLodColors(): originalMaterials.has("1_1_2") === true → SKIP → 원본 텍스처 노출
```

### 수정 (`DebugCameraOverlay.applyLodColors`)

원본 material 저장은 처음 한 번만. LOD 색상은 **매 프레임 모든 visible 타일에 무조건 적용**.
재생성 감지 로직 불필요 — 타일이 재생성되든 아니든 매 프레임 올바른 LOD 색상이 덮어쓰인다.

```typescript
for (const key of visibleKeys) {
  const tile = this.tileManager.getTile(key);
  if (!tile?.mesh) continue;

  if (!this.originalMaterials.has(key)) {
    this.originalMaterials.set(key, tile.mesh.material); // 처음 한 번만 저장
  }
  tile.mesh.material = this.getLodMaterial(parseTileKey(key).level); // 매 프레임 적용
}
```

---

## Bug 2: 카메라 전환 시 이상 동작

### 증상

- 디버그 카메라 조작 시 메인 카메라도 같이 움직임
- F키로 메인 카메라 복귀 후 키보드 이동 속도가 2배 빨라지거나 이상해짐
- 디버그 모드에서 WASD를 누르면 복귀 후 메인 카메라 위치가 달라짐

### 원인 (3가지)

**1. mainCamera detach 누락**

`toggle()` ON 시 `mainCamera.detachControl()`을 호출하지 않아서, 디버그 모드 중에도 마우스/휠 이벤트가 mainCamera와 debugCamera 양쪽에 전달됨.

**2. `attachControl()` 재호출이 keyboard input 복구**

`CameraController` 생성자에서 `camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput")`로 Babylon.js 기본 키보드 입력을 제거했지만, `toggle()` OFF 시 `mc.attachControl(canvas, true)`를 다시 호출하면 기본 입력이 재등록됨. 결과적으로 키보드 이동이 두 번 처리됨.

**3. `updateMovement()` debug 모드에서도 계속 실행**

`CameraController.updateMovement()`는 `scene.onBeforeRenderObservable`에 등록되어 매 프레임 실행됨. 디버그 모드에서 mainCamera가 비활성 카메라여도 WASD 입력이 `mainCamera.target`을 계속 수정 → 복귀 후 target이 이동해있음.

### 수정

**`DebugCameraOverlay.toggle()`**

```typescript
toggle(): void {
  this.isDebugOn = !this.isDebugOn;
  if (this.isDebugOn) {
    this.mainCamera.camera.detachControl();       // mainCamera 입력 차단
    this.scene.activeCamera = this.debugCamera;
    this.debugCamera.attachControl(this.canvas, true);
  } else {
    this.debugCamera.detachControl();
    this.scene.activeCamera = this.mainCamera.camera;
    this.mainCamera.camera.attachControl(this.canvas, true);
    this.mainCamera.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput"); // keyboard 재제거
    this.restoreAllMaterials();
  }
}
```

**`CameraController.updateMovement()`**

```typescript
private updateMovement(): void {
  if (this.scene.activeCamera !== this.camera) return; // debug 모드에서 스킵
  // ...
}
```

### 카메라 독립성

두 카메라는 완전히 독립적이다. 상태 복사(main→debug, debug→main)를 하지 않으므로:

- 디버그 카메라: 자신의 마지막 위치를 기억 (세션 간 유지)
- 메인 카메라: `detachControl()` + `updateMovement()` 가드 두 겹으로 디버그 모드 중 완전 동결 → F키 복귀 시 진입 전 위치 그대로

---

## 수정 파일

| 파일 | 변경 |
|------|------|
| `src/engine/debug/DebugCameraOverlay.ts` | `toggle()` — detach/attach 순서 및 removeByType 추가 |
| `src/engine/debug/DebugCameraOverlay.ts` | `applyLodColors()` — 매 프레임 무조건 적용으로 단순화 |
| `src/engine/camera/CameraController.ts` | `updateMovement()` — activeCamera 가드 추가 |
