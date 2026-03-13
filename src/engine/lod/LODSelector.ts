import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TileBounds } from '../tiling/TilingScheme';

/**
 * Camera distance 기반 LOD 레벨 선택
 *
 * LOD 전환 임계값 (camera distance):
 *   Level 0 → 1: 400
 *   Level 1 → 2: 200
 *   Level 2 → 3: 100
 *
 * 카메라가 가까울수록 더 높은 level(세밀한 타일)로 전환
 */
const LOD_THRESHOLDS = [400, 200, 100] as const;

export class LODSelector {
  private readonly maxLevel: number;

  constructor(maxLevel = 3) {
    this.maxLevel = maxLevel;
  }

  /**
   * 타일의 world 경계와 카메라 위치를 기반으로
   * 해당 타일에 적합한 LOD level 반환 (0~maxLevel)
   */
  selectLevel(cameraPos: Vector3, bounds: TileBounds): number {
    const dx = cameraPos.x - bounds.centerX;
    const dz = cameraPos.z - bounds.centerZ;
    const distance = Math.sqrt(dx * dx + dz * dz);

    for (let level = 0; level < this.maxLevel; level++) {
      if (distance > LOD_THRESHOLDS[level]) {
        return level;
      }
    }
    return this.maxLevel;
  }

  /**
   * 현재 타일의 level이 카메라 거리 기준으로 충분한지 판단
   * true → 이 타일을 그대로 렌더링
   * false → 자식 타일로 세분화 필요
   */
  isSufficientDetail(
    currentLevel: number,
    cameraPos: Vector3,
    bounds: TileBounds
  ): boolean {
    const targetLevel = this.selectLevel(cameraPos, bounds);
    return currentLevel >= targetLevel;
  }
}
