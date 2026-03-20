# Tile LOD Terrain

Heightmap 기반 Tile + LOD 지형 렌더링 시스템.

지도 엔진의 핵심 구조인 Tile System, LOD, Tile Streaming, Frustum Culling을 학습/검증하는 데모 프로젝트.

---

## 주요 기능

- **Tile System** — 지형을 격자 타일로 분할하여 독립적으로 관리
- **4단계 LOD** — 카메라 거리(SSE 기반)에 따라 타일 해상도를 동적으로 조정
- **Frustum Culling** — 카메라 시야 외부 타일을 자동으로 제외
- **LOD Seam 수정** — 인접 타일 간 LOD 레벨 차이로 발생하는 균열 보정
- **ArcRotate 카메라** — 마우스 드래그 회전, 휠 줌, RTS식 패닝
- **디버그 오버레이** — F키로 LOD 레벨별 색상 시각화 전환
- **Babylon Inspector** — 씬 구조 실시간 확인

---

## 기술 스택

| 항목   | 내용                                        |
| ------ | ------------------------------------------- |
| 렌더러 | [Babylon.js](https://www.babylonjs.com/) v7 |
| 언어   | TypeScript                                  |
| 번들러 | Vite                                        |

---

## 환경 요구사항

- Node.js 18 이상
- npm 9 이상

---

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행 (http://localhost:3000)
npm run dev

```

---

## 조작법

| 입력                   | 동작                     |
| ---------------------- | ------------------------ |
| 마우스 우클릭 + 드래그 | 카메라 회전              |
| 마우스 휠              | 줌 인/아웃               |
| 마우스 중클릭 + 드래그 | 카메라 패닝              |
| F                      | LOD 디버그 오버레이 전환 |

---

## LOD 구조

| Level | 타일 수 | Heightmap 샘플 영역 |
| ----- | ------- | ------------------- |
| 0     | 1       | 256×256 px          |
| 1     | 4       | 128×128 px          |
| 2     | 16      | 64×64 px            |
| 3     | 64      | 32×32 px            |
| 4     | 256     | 16×16 px            |

---

## 디렉토리 구조

```
src/
├── main.ts
└── engine/
    ├── camera/          # ArcRotateCamera 컨트롤러
    ├── heightmap/       # PNG 파싱 및 높이값 추출
    ├── tiling/          # 타일 좌표 체계
    ├── terrain/         # 타일 메시 빌드, 관리, LOD seam 보정
    ├── lod/             # SSE 기반 LOD 레벨 선택
    └── renderer/        # Quadtree traversal 렌더러
```

---

## 참고 문서

<!-- 링크를 아래에 추가해주세요 -->

[노션](https://www.notion.so/2-3D-3104931c8607802a83a5e21a234ff9c7?source=copy_link)
