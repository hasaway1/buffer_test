import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    instagram: {
      type: "OBJECT",
      properties: {
        body: { type: "STRING" },
        hashtags: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["body", "hashtags"],
    },
    threads: {
      type: "OBJECT",
      properties: {
        body: { type: "STRING" },
        hashtags: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["body", "hashtags"],
    },
  },
  required: ["instagram", "threads"],
};

function buildPrompt(features: unknown, tone?: string) {
  return `아래는 한 장의 사진을 분석한 결과야. 이 사진으로 올릴 SNS 게시글 초안을 한국어로 작성해줘.

사진 분석:
${JSON.stringify(features, null, 2)}

${tone ? `원하는 톤: ${tone}\n` : ""}규칙:
- instagram.body: 3~6줄, 감성적이고 이모지는 적당히. 해시태그는 본문에 넣지 말고 hashtags에만 8~15개 (# 기호 없이 단어만).
- threads.body: 500자 이내의 짧은 대화체 단문. hashtags는 0~2개 (# 기호 없이).
- 두 글은 서로 다른 문장이어야 하고, 분석에 없는 사실을 지어내지 마.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) {
    console.error("GEMINI_API_KEY is not set");
    return json({ error: "서버 설정 오류입니다." }, 500);
  }

  let features: unknown, tone: string | undefined;
  try {
    ({ features, tone } = await req.json());
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!features || typeof features !== "object") {
    return json({ error: "사진 특성 데이터가 필요합니다." }, 400);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  let lastStatus = 0;
  let lastDetail = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(features, tone) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
        const posts = JSON.parse(text);
        return json({ posts, model: MODEL });
      }
      lastStatus = r.status;
      lastDetail = JSON.stringify(j?.error ?? j).slice(0, 300);
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      lastDetail = String(e);
    }
    await sleep(1000 * 2 ** attempt);
  }
  console.error("write-posts failed", MODEL, lastStatus, lastDetail);
  const msg = lastStatus === 429
    ? "Gemini 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
    : "초안 작성에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  return json({ error: msg, status: lastStatus }, 502);
});
