# 사진함 원본 클라이언트 계약 재확인

2026-10-16 Ego에서 원본 /images를 직접 열고 로드된 JavaScript를 읽었다. 원본에는 테스트 사진을 업로드하지 않았다.

원본: https://www.naeo.kr/_next/static/immutable/chunks/0yo5uxj29t17d.js

## 확인한 계약

- resizeToJpeg: createImageBitmap, 긴 변 최대1600px, 비율 유지, 확대하지 않음. 모든 이미지를 Canvas toBlob image/jpeg 품질0.85로 변환한다.
- 클라이언트가 .jpg 파일로 POST /api/images를 호출한다.
- 응답의 url과 markdown이 모두 있어야 업로드 성공으로 처리한다. 401은 로그인 안내다.
- 사진별 복사 버튼은 응답 markdown을 그대로 클립보드에 쓴다. 전체 복사는 현재 업로드 목록의 markdown을 줄바꿈으로 연결한다.
- 클라이언트 코드만으로는 서버가 생성하는 정확한 이미지 URL·접근 정책·마크다운 문자열은 확인되지 않는다.

## 구현 정정

직전 315f151의 형식 보존/작은 파일 바이트 보존은 원본과 달랐다. preparePhoto를 JPEG0.85로 수정했다. 이전 image-optimization 보고서의 PNG 투명도 및 작은WEBP 원본 보존은 당시 동작에 대한 기록이며 현재 계약이 아니다.

Ego 실제 업로드 및 저장 파일 디코딩으로 확인:

- 2400×1200 PNG → wide.jpg, image/jpeg, 1600×800.
- 320×240 WEBP → small.jpg, image/jpeg, 320×240.
- 프로덕션 build 및 lint 통과. 전체 테스트 재실행은 하지 않았다.
- 임시 서버·DB·파일·자격증명 정리 완료.

[검증 증거](evidence/ego-jpeg-2026-10-16/)

## 남은 작업

현재 /api/media/{id}는 소유자 로그인 전용이며 공유는 초안 연결을 전제로 한다. 사진함에서 외부 AI·확장 프로그램으로 전달할 독립 이미지 링크의 생성/조회/회수와 마크다운 응답 계약이 필요하다. 개인 사진 전체를 공개하거나 로그인 전용 주소만 복사해 완료했다고 처리하지 않는다. P11.8은 미완료로 유지한다.
