// Cloudflare Worker — recebe o formulário Monetz (multipart/form-data, com anexos)
// e envia por e-mail via SendGrid para env.TO_EMAIL.
//
// Variáveis de ambiente esperadas (ver wrangler.toml e README.md):
//   ALLOWED_ORIGIN   - origem do site publicado (ex: https://usuario.github.io)
//   TO_EMAIL         - e-mail que recebe as solicitações (contato@monetz.com.br)
//   FROM_EMAIL       - e-mail remetente verificado no SendGrid (Single Sender)
//   SENDGRID_API_KEY - secret, configurado com `wrangler secret put SENDGRID_API_KEY`

const MAX_TOTAL_BYTES = 18 * 1024 * 1024; // 18MB, deve bater com o limite no front-end

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Método não permitido." }, 405, corsHeaders);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (e) {
      return json({ error: "Não foi possível ler os dados enviados." }, 400, corsHeaders);
    }

    // Honeypot: se o campo oculto "website" vier preenchido, é bot — responde OK sem processar.
    if (formData.get("website")) {
      return json({ ok: true }, 200, corsHeaders);
    }

    const fields = {};
    const attachments = [];
    let totalBytes = 0;

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (!value.size) continue;
        totalBytes += value.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          return json({ error: "Os anexos excedem o limite total de 18MB." }, 413, corsHeaders);
        }
        const buffer = await value.arrayBuffer();
        attachments.push({
          filename: value.name || "arquivo",
          content: arrayBufferToBase64(buffer),
          type: value.type || "application/octet-stream",
          disposition: "attachment",
        });
      } else {
        if (fields[key] !== undefined) {
          fields[key] = Array.isArray(fields[key]) ? [...fields[key], value] : [fields[key], value];
        } else {
          fields[key] = value;
        }
      }
    }

    if (!env.SENDGRID_API_KEY || !env.TO_EMAIL || !env.FROM_EMAIL) {
      return json({ error: "Backend não configurado corretamente." }, 500, corsHeaders);
    }

    const html = buildEmailHtml(fields);
    const razaoSocial = fields.razaoSocial || "sem razão social";

    const payload = {
      personalizations: [{ to: [{ email: env.TO_EMAIL }] }],
      from: { email: env.FROM_EMAIL, name: "Formulário Monetz" },
      subject: `Nova solicitação Monetz — ${razaoSocial}`,
      content: [{ type: "text/html", value: html }],
    };
    if (fields.emailContato) {
      payload.reply_to = { email: fields.emailContato };
    }
    if (attachments.length) {
      payload.attachments = attachments;
    }

    let sgResponse;
    try {
      sgResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: "Falha de rede ao enviar o e-mail." }, 502, corsHeaders);
    }

    if (!sgResponse.ok) {
      const errText = await sgResponse.text();
      console.log("SendGrid error:", sgResponse.status, errText);
      return json({ error: "Falha ao enviar o e-mail." }, 502, corsHeaders);
    }

    return json({ ok: true }, 200, corsHeaders);
  },
};

function json(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function buildEmailHtml(fields) {
  const esc = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const rows = Object.entries(fields)
    .filter(([k]) => k !== "website")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd;background:#f4f7fa;"><strong>${esc(
          k
        )}</strong></td><td style="padding:4px 8px;border:1px solid #ddd;">${esc(
          Array.isArray(v) ? v.join(", ") : v
        )}</td></tr>`
    )
    .join("");
  return `<div style="font-family:Arial,sans-serif;">
    <h2 style="color:#0b1f3a;">Nova solicitação — Crédito Monetz</h2>
    <table style="border-collapse:collapse;font-size:13px;">${rows}</table>
  </div>`;
}
