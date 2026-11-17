import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// 무료 비전 모델, 순서대로 폴백
const MODELS = [
  { id: "particle-ai/particle-1:free", max_tokens: 2000 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", max_tokens: 6000 },
];

const PROMPT = `이 사진을 SNS(인스타그램, 스레드) 게시글을 쓰기 위한 관점에서 분석해줘.
반드시 한국어로만 답하고, 아래 형식의 JSON 객체 하나만 출력해. 설명이나 코드블록 표시는 쓰지 마.
{
  "subject": "주요 대상 (한 문장)",
  "colors": ["주요 색상 2~4개"],
  "setting": "장소/배경",
  "mood": "분위기",
  "time_weather": "시간대나 날씨 (알 수 없으면 빈 문자열)",
  "keywords": ["키워드 5~8개"],
  "caption_hooks": ["글감 후보 2~3개"]
}`;

function parseJson(text: string) {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  if (!obj.subject || !Array.isArray(obj.keywords)) throw new Error("missing fields");
  return obj;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModel(key: string, model: { id: string; max_tokens: number }, image: string) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.id,
      max_tokens: model.max_tokens,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: image } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = JSON.stringify(j?.error ?? j).slice(0, 200);
    throw Object.assign(new Error(`status ${r.status} ${detail}`), { status: r.status });
  }
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error("empty reply");
  return parseJson(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("OPEN_ROUTER_KEY");
  if (!key) {
    console.error("OPEN_ROUTER_KEY is not set");
    return json({ error: "서버 설정 오류입니다." }, 500);
  }

  let image: string;
  try {
    ({ image } = await req.json());
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return json({ error: "이미지 데이터가 필요합니다." }, 400);
  }

  const errors: string[] = [];
  for (const model of MODELS) {
    // 모델당 최대 3회 시도(최초 + 재시도 2회), 지수 백오프
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const features = await callModel(key, model, image);
        return json({ features, model: model.id });
      } catch (e) {
        const err = e as Error & { status?: number };
        errors.push(`${model.id}#${attempt + 1}: ${err.message}`);
        // 403/400 등 재시도해도 소용없는 오류는 바로 다음 모델로
        if (err.status && err.status !== 429 && err.status < 500) break;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  console.error("analyze-photo failed", errors);
  return json({ error: "사진 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.", detail: errors }, 502);
});
