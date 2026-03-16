# 06 — Diffuse.exr 텍스처 적용 및 UV 방향 수정

## 작업 목적

heightmap.png 제작자가 함께 제공한 `public/Diffuse.exr` 파일을 지형 머티리얼의 diffuse 텍스처로 적용한다.
기존 고도 기반 버텍스 컬러를 제거하고 실제 지형 색감 텍스처로 교체한다.

## 변경 파일

`src/engine/terrain/TerrainMeshBuilder.ts`

## 변경 내역

### 1. import 추가

```typescript
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
```

### 2. TERRAIN_SIZE 상수 추가

```typescript
const TERRAIN_SIZE = 512; // 전체 지형 world 크기
```

### 3. UV 좌표 — per-tile → global UV

기존 UV는 타일 내부 기준 [0, 1]이었기 때문에 텍스처가 타일마다 반복되었음.
Diffuse.exr은 전체 지형(512×512)에 한 번 매핑되어야 하므로 world 좌표 기반 global UV로 변경.

```typescript
// Before
uvs.push(col / cells, row / cells);

// After (최종)
uvs.push(wz / TERRAIN_SIZE, 1.0 - wx / TERRAIN_SIZE);
```

### 4. 버텍스 컬러 제거

텍스처가 색감을 담당하므로 고도 기반 버텍스 컬러(`colors` 배열) 전체 제거.

### 5. 머티리얼에 diffuse 텍스처 적용

```typescript
mat.diffuseTexture = new Texture("/Diffuse.exr", scene);
mat.specularColor = new Color3(0.1, 0.1, 0.1); // 스펙큘러 낮춤
```

## UV 방향 디버깅 과정

Diffuse.exr와 heightmap.png는 동일 제작자 제공 세트이나 UV 방향 불일치가 있었음.

| 시도 | UV 공식 | 결과 |
|------|---------|------|
| 1차 (원본) | `(wx/512, wz/512)` | 텍스처 90° 어긋남 |
| 2차 | `(wz/512, 1 - wx/512)` | 방향 맞음 (채택) |
| 3차 (실수) | `(1 - wz/512, wx/512)` | 180° 뒤집힘 → 2차로 복원 |

**최종 채택**: `uvs.push(wz / TERRAIN_SIZE, 1.0 - wx / TERRAIN_SIZE)`

이는 UV 좌표 기준 90° CW 회전에 해당하며, Babylon.js의 V축 방향 및 EXR 파일 좌표계 차이를 보정한다.
