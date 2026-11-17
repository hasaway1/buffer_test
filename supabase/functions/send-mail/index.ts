import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@6.9.16";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Gmail SMTP(앱 비밀번호)로 발송한다. 수신자는 요청의 `to`(상급자 이메일)로 받는다.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const user = Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) {
    console.error("GMAIL_USER / GMAIL_APP_PASSWORD is not set");
    return json({ error: "메일 발송 설정이 아직 되어 있지 않습니다.", code: "not_configured" }, 500);
  }

  let to: string, instagram: string, threads: string;
  try {
    ({ to, instagram, threads } = await req.json());
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (typeof to !== "string" || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to.trim())) {
    return json({ error: "올바른 이메일 주소를 입력해 주세요." }, 400);
  }
  to = to.trim();
  if (typeof instagram !== "string" || typeof threads !== "string") {
    return json({ error: "초안 내용이 필요합니다." }, 400);
  }

  const text = `[인스타그램 초안]\n${instagram}\n\n----------\n\n[스레드 초안]\n${threads}\n`;
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    await transporter.sendMail({ from: user, to, subject: "SNS 포스팅 초안", text });
    return json({ ok: true });
  } catch (e) {
    console.error("send-mail failed", String(e));
    return json({ error: "메일 발송에 실패했습니다." }, 502);
  }
});
