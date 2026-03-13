import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

/**
 * ArcRotateCamera 래퍼
 *
 * - terrain 전체를 내려다보는 초기 시점 설정
 * - 이동/회전/줌 가능
 */
export class CameraController {
  readonly camera: ArcRotateCamera;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      'mainCamera',
      -Math.PI / 2, // alpha: 정면
      Math.PI / 3,  // beta: 약 60도 기울기
      500,          // radius: terrain(512) 바깥에서 시작
      Vector3.Zero(),
      scene
    );

    this.camera.lowerRadiusLimit = 50;
    this.camera.upperRadiusLimit = 1000;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI / 2;

    this.camera.attachControl(canvas, true);
  }

  get position(): Vector3 {
    return this.camera.position;
  }
}
