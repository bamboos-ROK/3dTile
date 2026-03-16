import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { KeyboardEventTypes } from "@babylonjs/core/Events/keyboardEvents";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

/**
 * ArcRotateCamera 래퍼
 *
 * - 왼쪽 마우스 드래그: 궤도 회전
 * - 마우스 휠: 줌인/줌아웃
 * - 방향키: 카메라 시선 방향 기준 타겟 이동 (패닝)
 */
export class CameraController {
  readonly camera: ArcRotateCamera;
  private readonly _keys = new Set<string>();

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      "mainCamera",
      -Math.PI / 2, // alpha: 정면
      Math.PI / 6,  // beta: 약 30도 기울기
      800,          // radius: terrain(512) 바깥에서 시작
      Vector3.Zero(),
      scene,
    );

    this.camera.lowerRadiusLimit = 50;
    this.camera.upperRadiusLimit = 1000;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI / 2;
    this.camera.panningSensibility = 0; // 키보드로만 패닝

    this.camera.attachControl(canvas, true);
    // ArcRotateCamera 내장 키보드 회전 제거 (방향키 충돌 방지)
    this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

    // 키 상태 추적
    scene.onKeyboardObservable.add((info) => {
      if (info.type === KeyboardEventTypes.KEYDOWN) {
        this._keys.add(info.event.code);
      } else {
        this._keys.delete(info.event.code);
      }
    });

    // 매 프레임 키보드 패닝 처리
    scene.onBeforeRenderObservable.add(() => {
      const dt = scene.deltaTime / 1000; // ms → 초
      if (dt <= 0) return;

      const alpha = this.camera.alpha;
      const speed = this.camera.radius * 0.5 * dt;

      // 카메라 수평 방향 기준 forward/right 벡터 (XZ 평면)
      const fx = -Math.cos(alpha);
      const fz = -Math.sin(alpha);
      const rx = -Math.sin(alpha);
      const rz = Math.cos(alpha);

      let dx = 0;
      let dz = 0;

      if (this._keys.has("ArrowUp"))    { dx += fx; dz += fz; }
      if (this._keys.has("ArrowDown"))  { dx -= fx; dz -= fz; }
      if (this._keys.has("ArrowRight")) { dx += rx; dz += rz; }
      if (this._keys.has("ArrowLeft"))  { dx -= rx; dz -= rz; }

      if (dx !== 0 || dz !== 0) {
        this.camera.target.addInPlace(new Vector3(dx * speed, 0, dz * speed));
      }
    });
  }

  get position(): Vector3 {
    return this.camera.position;
  }
}
