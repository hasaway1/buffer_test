import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const ENDPOINT = "https://api.buffer.com";

async function gql(key: string, query: string, variables?: Record<string, unknown>) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (j?.errors?.length) {
    const e = j.errors[0];
    throw new Error(`${e?.extensions?.code ?? "ERROR"}: ${e?.message ?? ""}`);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return j.data;
}

const ORGS = `query { account { organizations { id name } } }`;
const CHANNELS = `query ($org: OrganizationId!) {
  channels(input: { organizationId: $org }) { id name displayName service isLocked isDisconnected }
}`;
const CREATE = `mutation ($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("BUFFER_API_KEY");
  if (!key) {
    console.error("BUFFER_API_KEY is not set");
    return json({ error: "Buffer 설정이 아직 되어 있지 않습니다.", code: "not_configured" }, 500);
  }

  let instagram: string, threads: string, services: string[] | undefined;
  try {
    ({ instagram, threads, services } = await req.json());
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (typeof instagram !== "string" || typeof threads !== "string") {
    return json({ error: "초안 내용이 필요합니다." }, 400);
  }

  try {
    const orgs = (await gql(key, ORGS))?.account?.organizations ?? [];
    if (!orgs.length) return json({ error: "Buffer 조직을 찾지 못했습니다." }, 502);

    // 모든 조직의 채널에서 서비스별 첫 번째 사용 가능한 채널을 고른다
    const channels: Array<{ id: string; service: string; displayName?: string; name?: string; isLocked?: boolean; isDisconnected?: boolean }> = [];
    for (const o of orgs) {
      const data = await gql(key, CHANNELS, { org: o.id });
      channels.push(...(data?.channels ?? []));
    }
    const usable = channels.filter((c) => !c.isLocked && !c.isDisconnected);
    const pick = (service: string) => usable.find((c) => String(c.service).toLowerCase() === service);

    const targets: Array<[string, string, string]> = [
      ["instagram", instagram, "인스타그램"],
      ["threads", threads, "스레드"],
    ];
    const results = [];
    for (const [service, text, label] of targets) {
      if (Array.isArray(services) && !services.includes(service)) continue;
      const ch = pick(service);
      if (!ch) {
        results.push({ service, label, ok: false, error: `연결된 ${label} 채널이 Buffer에 없습니다.` });
        continue;
      }
      try {
        const data = await gql(key, CREATE, {
          input: {
            text,
            channelId: ch.id,
            schedulingType: "automatic",
            mode: "addToQueue",
            saveToDraft: true,
            // 인스타그램은 게시 유형이 필요하다
            ...(service === "instagram" ? { metadata: { instagram: { type: "post", shouldShareToFeed: true } } } : {}),
          },
        });
        const res = data?.createPost;
        if (res?.post?.id) results.push({ service, label, ok: true, channel: ch.displayName ?? ch.name });
        else results.push({ service, label, ok: false, error: res?.message ?? "알 수 없는 오류" });
      } catch (e) {
        results.push({ service, label, ok: false, error: String((e as Error).message).slice(0, 200) });
      }
    }
    return json({ results, availableServices: [...new Set(channels.map((c) => c.service))] });
  } catch (e) {
    console.error("register-buffer failed", String(e));
    const msg = String((e as Error).message);
    return json({ error: msg.startsWith("UNAUTHORIZED") ? "Buffer API 키가 올바르지 않습니다." : "Buffer 등록에 실패했습니다." }, 502);
  }
});
