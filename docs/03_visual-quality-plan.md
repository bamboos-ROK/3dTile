# 03 — 지형 시각 품질 개선 계획

## 배경

와이어프레임은 정상적으로 고도가 표현되나 Solid 모드에서 표면이 찰흙처럼 평탄하고 입체감이 없음.

---

## 원인 분석

| 우선순위 | 원인                                                                | 영향도 | 관련 파일               |
| -------- | ------------------------------------------------------------------- | ------ | ----------------------- |
| 1        | `HemisphericLight` 단독 사용 → 균일 조명으로 경사면 명암 없음       | ★★★★★  | `main.ts`               |
| 2        | 단색 `diffuseColor`, 텍스처 없음 → 표면 정보 시각적 전달 불가       | ★★★★   | `TerrainMeshBuilder.ts` |
| 3        | `specularColor=0.1` + `specularPower=64` → 하이라이트 사실상 없음   | ★★★    | `TerrainMeshBuilder.ts` |
| 4        | 타일 경계에서 노멀 불연속 → 경계마다 날카로운 음영 변화             | ★★     | `TerrainMeshBuilder.ts` |
| 5        | `BoundingBox Y max=200`, `HEIGHT_SCALE=480` 불일치 → 컬링 오류 가능 | ★      | `TerrainTileManager.ts` |

---

## 개선 방안

### 개선 1 — DirectionalLight 추가 (핵심)

`HemisphericLight`는 모든 면에 균일한 빛을 제공하므로 경사면 명암이 생기지 않음.
비스듬한 `DirectionalLight`를 추가하면 경사면에 즉시 음영이 생겨 입체감이 크게 향상됨.

```typescript
// main.ts
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";

// HemisphericLight → ambient 역할로 강도 낮춤
light.intensity = 0.4;

// 비스듬한 방향 조명 추가
const dirLight = new DirectionalLight(
  "dirLight",
  new Vector3(-1, -2, -1),
  scene,
);
dirLight.intensity = 0.8;
```

### 개선 2 — 머티리얼 Specular 조정

현재 specularColor가 거의 0이어서 하이라이트가 없음. 약간 높이고 영역을 넓혀 반사감 부여.

```typescript
// TerrainMeshBuilder.ts
mat.specularColor = new Color3(0.3, 0.28, 0.25); // 0.1 → 0.3
mat.specularPower = 32; // 64 → 32
```

### 개선 3 — 고도별 버텍스 컬러

단색 대신 고도에 따라 색상 그라데이션 적용 (저지대: 흙색 → 고지대: 밝은 회색).
`StandardMaterial.useVertexColors = true`로 활성화.

```typescript
// buildTerrainMesh 버텍스 생성 루프 내
const t = Math.min(wy / HEIGHT_SCALE, 1.0);
colors.push(0.4 + t * 0.4, 0.35 + t * 0.2, 0.25 + t * 0.3, 1.0);

// vertexData에 적용
vertexData.colors = colors;
mat.useVertexColors = true;
```

### 개선 4 — BoundingBox Y 범위 수정

`HEIGHT_SCALE = 480`인데 BoundingBox Y max가 200으로 설정되어 있어 고지대 타일이 컬링될 수 있음.

```typescript
// TerrainTileManager.ts
// Y max: 200 → 480 (HEIGHT_SCALE과 동기화)
```

---

## 수정 대상 파일

- `src/main.ts` — DirectionalLight 추가, HemisphericLight 강도 조정
- `src/engine/terrain/TerrainMeshBuilder.ts` — specular 조정, 버텍스 컬러 추가
- `src/engine/terrain/TerrainTileManager.ts` — BoundingBox Y max 수정

---

## 검증 방법

1. `npm run dev` 실행
2. Solid 모드에서 경사면에 그림자/명암 확인
3. 고도별 색상 그라데이션 확인
4. Babylon Inspector에서 DirectionalLight 방향 조작 → 음영 반응 확인
5. 카메라 이동 시 타일 컬링 오류 없는지 확인

---

## 구현 결과 (2026-03-16)

### 완료 항목

| 개선 | 상태 | 실제 변경 내용 |
| ---- | ---- | -------------- |
| 개선 1 — DirectionalLight 추가 | ✅ | `HemisphericLight` intensity 0.4, `DirectionalLight(-1,-2,-1)` intensity 0.8 추가 |
| 개선 2 — Specular 조정 | ✅ | `specularColor=(0.3,0.28,0.25)`, `specularPower=32` |
| 개선 3 — 고도별 버텍스 컬러 | ✅ | `vertexData.colors` 추가, `diffuseColor=White`로 변경 (아래 참고) |
| 개선 4 — BoundingBox Y max 수정 | ✅ | `200 → 480` |

### 추가 발견 버그 및 수정

**버그 A — `HemisphericLight.groundColor` 미설정**

기본값 `groundColor = Color3(0,0,0)` (검정) 때문에 경사면 음지가 완전히 검게 렌더링됨.
과도한 명암 대비의 주원인.

```typescript
// main.ts
light.groundColor = new Color3(0.2, 0.18, 0.15); // 어두운 흙색 ambient
```

**버그 B — `diffuseColor × vertexColor` 이중 곱**

Babylon.js `StandardMaterial`은 `finalColor = diffuseColor × vertexColor`로 계산.
기존 `diffuseColor=(0.6,0.55,0.45)` 상태에서는 저지대 vertexColor가 의도보다 훨씬 어두워짐.
`diffuseColor=White`로 변경하여 vertexColor가 그대로 표현되도록 수정.

```typescript
// TerrainMeshBuilder.ts
mat.diffuseColor = new Color3(1, 1, 1); // vertexColor 그대로 표현
```

### 최종 변경 파일 요약

| 파일 | 변경 내용 |
| ---- | --------- |
| `src/main.ts` | DirectionalLight 추가, HemisphericLight intensity 0.4, groundColor 설정 |
| `src/engine/terrain/TerrainMeshBuilder.ts` | specular 조정, 버텍스 컬러 추가, diffuseColor=White |
| `src/engine/terrain/TerrainTileManager.ts` | BoundingBox Y max 200 → 480 |
