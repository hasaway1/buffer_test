# CLAUDE.md

사진을 올리면 사진 특성을 추출하고, 그 특성으로 인스타/스레드 포스팅 초안을 만드는 웹 앱. 상세 요구사항은 `PRD.md`.

## 스택
- 프론트: 순수 HTML, CSS, JavaScript (빌드 도구/프레임워크 없음)
- 백엔드: Supabase Edge Functions (Deno, TypeScript)
- AI: OpenRouter API (`https://openrouter.ai/api/v1/chat/completions`)

## 파이프라인
1. **특성 추출** (비전): `particle-ai/particle-1:free` 우선, 실패 시 `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`
2. **초안 작성** (텍스트): Gemini 3.5 Flash Lite, `GEMINI_API_KEY`로 Google Gemini API 직접 호출 (모델 ID는 구현 시 확인)

**비용 0원 원칙: 1단계는 OpenRouter `:free` 모델, 2단계는 Gemini 무료 티어 한도 내에서만 쓴다. 유료 과금이 필요해지면 먼저 사용자에게 확인한다.**

## 시크릿 규칙
- 시크릿은 Supabase Secrets에만 둔다: `OPEN_ROUTER_KEY`(1단계), `GEMINI_API_KEY`(2단계).
- Edge Function 안에서 `Deno.env.get()`으로만 읽는다.
- 키를 프론트 코드, 커밋, 로그, 응답 본문에 절대 넣지 않는다. JWT 검증을 끄므로 클라이언트가 Authorization 헤더 없이 함수를 호출해도 된다.
- `GEMINI_API_KEY`의 동작과 무료 티어 가능 여부는 미검증이다(PRD 9장). 구현 초기에 테스트 호출로 확인한다.
- Supabase 시크릿은 MCP로 읽을 수 없다. 키가 필요한 동작 확인은 Edge Function을 배포해 호출하는 방식으로 한다.

## 모델 호출 시 주의 (테스트로 확인됨)
- nemotron-nano는 reasoning 모델이다. `max_tokens`가 작으면(1500) 추론만 하다 본문이 빈다. 3000 이상으로 설정한다.
- 무료(`:free`) 모델은 429가 자주 난다. 재시도(지수 백오프)와 폴백 모델을 구현한다.
- 모델이 한국어 요청에 영어/다른 언어로 답할 수 있다. 프롬프트에 "한국어로만 답하고 JSON만 출력"을 명시하고 파싱 실패에 대비한다.
- 이미지는 data URL(base64)로 보낸다. 클라이언트에서 긴 변 1024px 이하로 줄인다.
- `thinkingmachines/inkling-2-small:free` 같은 에이전트 하네스 전용 모델은 직접 호출이 403이므로 쓰지 않는다.

## Edge Function 규칙
- 함수: `analyze-photo`(1단계), `write-posts`(2단계), `send-mail`(초안을 Gmail SMTP로 발송), `register-buffer`(초안을 Buffer 초안으로 등록). 각각 CORS를 포함한다.
- `send-mail`: 시크릿 `GMAIL_USER`, `GMAIL_APP_PASSWORD`(Google 앱 비밀번호). 수신자는 화면 모달에서 입력한 `to`(상급자 이메일)이며 형식만 검사한다. Gmail MCP 커넥터는 초안 작성만 되고 발송 도구가 없어서 이 방식을 쓴다.
- `register-buffer`: 시크릿 `BUFFER_API_KEY`. Buffer GraphQL API(`https://api.buffer.com`, Bearer)의 `createPost`를 `saveToDraft: true`로 호출한다. 조직/채널을 조회해 instagram, threads 채널에 각각 등록한다. 인스타그램은 `metadata.instagram`(`type: post`, `shouldShareToFeed: true`)이 필요하다. 이미지 없이 텍스트 초안 등록은 확인됨. 이미지 첨부는 공개 HTTPS URL만 가능(업로드 불가)해서 미구현.
- 배포는 Supabase MCP(`deploy_edge_function`) 또는 CLI로 한다. **엣지 함수에는 보안을 적용하지 않는다: `verify_jwt: false`로 배포하고, 인증/속도 제한/남용 방지 코드를 넣지 않는다.** (사용자 지시)
- 단, API 키를 코드/응답에 노출하지 않는 것은 보안 기능이 아니라 기본 시크릿 관리이므로 그대로 지킨다.
- 프로젝트: ref `efcezxsrvxmvojacukkm` (이름 "연습", ap-northeast-2).
- 임시 테스트 함수 `or-model-test`가 배포돼 있다. 앱 완성 후 대시보드에서 삭제한다(MCP로는 삭제 불가).

## 코드 스타일
- JS는 ES 모듈, `const`/`let`, async/await. 외부 라이브러리는 꼭 필요할 때만 CDN으로 추가한다.
- UI 문구와 AI 출력은 한국어가 기본이다.
- 파일 구조(제안): `index.html`, `style.css`, `app.js`, `supabase/functions/<name>/index.ts`

## 작업 방식
- 새 기능은 PRD.md의 요구사항 ID(F1~F5)에 맞춰 구현하고, 범위가 바뀌면 PRD.md도 함께 고친다.
- 외부 서비스에 보내는 요청에 사용자 개인정보를 넣지 않는다.
