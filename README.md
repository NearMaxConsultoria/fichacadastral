# Formulário Monetz — publicação e envio por e-mail

## Como funciona

O GitHub Pages só serve arquivos estáticos — não consegue, sozinho, enviar e-mail
nem guardar uma chave de API com segurança. Por isso a solução tem duas partes:

1. **`index.html`** — o formulário, publicado no GitHub Pages. Quando o usuário
   clica em "Enviar", o JavaScript monta um `FormData` (campos + arquivos) e
   faz um `POST` para o endereço do Worker (constante `WORKER_URL` no topo do
   `<script>`).
2. **`worker/index.js`** — uma função serverless (Cloudflare Worker) que recebe
   esse `POST`, converte os anexos e dispara um e-mail via SendGrid para
   `contato@monetz.com.br`, com os arquivos anexados.

A chave da API do SendGrid fica **apenas no Worker** (como *secret*), nunca no
HTML público — por isso não dá pra usar algo tipo EmailJS aqui, que exigiria
expor a chave no navegador de qualquer visitante do site.

```
Usuário → index.html (GitHub Pages) → Worker (Cloudflare) → SendGrid → e-mail
```

---

## Passo 1 — Publicar o site no GitHub Pages

Este repositório (`NearMaxConsultoria/fichacadastral`) já está publicado via
GitHub Pages em `https://nearmaxconsultoria.github.io/fichacadastral/` — não
precisa recriar nada aqui, só manter o `index.html` atualizado nesse
repositório e o Pages já redeploya sozinho a cada push na branch `main`.

## Passo 2 — Criar o remetente no SendGrid

O SendGrid tem um plano gratuito (100 e-mails/dia). Para enviar para
`contato@monetz.com.br` sem precisar mexer em DNS, use **Single Sender
Verification**:

1. Crie uma conta em [sendgrid.com](https://sendgrid.com).
2. Vá em **Settings → Sender Authentication → Single Sender Verification**.
3. Cadastre um e-mail remetente (pode ser o próprio `contato@monetz.com.br`,
   desde que você tenha acesso à caixa para clicar no link de confirmação).
4. Em **Settings → API Keys**, crie uma chave com permissão **Mail Send** apenas.
   Guarde essa chave — ela só é exibida uma vez.

> Se no futuro vocês tiverem acesso ao DNS do domínio `monetz.com.br`, vale
> migrar para verificação de domínio completa (melhor entregabilidade, permite
> qualquer remetente `@monetz.com.br`).

## Passo 3 — Publicar o Worker no Cloudflare

1. Crie uma conta gratuita em [cloudflare.com](https://cloudflare.com) (não
   precisa ter domínio próprio lá — o Worker roda em `*.workers.dev`).
2. Instale o Wrangler (CLI do Cloudflare) e faça login:
   ```
   npm install -g wrangler
   wrangler login
   ```
3. Dentro da pasta `worker/`, confira o `wrangler.toml` (já vem preenchido):
   - `ALLOWED_ORIGIN`: `https://nearmaxconsultoria.github.io` (já preenchido).
   - `TO_EMAIL`: `contato@monetz.com.br` (já preenchido).
   - `FROM_EMAIL`: troque pelo e-mail que você verificou no Passo 2.
4. Configure a chave secreta do SendGrid (não fica no arquivo, fica só no
   Cloudflare):
   ```
   wrangler secret put SENDGRID_API_KEY
   ```
   (cole a chave quando solicitado)
5. Publique:
   ```
   wrangler deploy
   ```
   O comando retorna uma URL do tipo
   `https://monetz-form-backend.SEU-SUBDOMINIO.workers.dev`.

## Passo 4 — Conectar o formulário ao Worker

1. Abra `index.html` e troque a constante no topo do `<script>`:
   ```js
   const WORKER_URL = "https://monetz-form-backend.SEU-SUBDOMINIO.workers.dev";
   ```
2. Suba essa alteração para o GitHub (commit + push). O GitHub Pages atualiza
   automaticamente em 1–2 minutos.

## Passo 5 — Testar

1. Abra a URL do GitHub Pages, preencha o formulário com dados de teste e
   anexe arquivos pequenos.
2. Envie e confira se o e-mail chegou em `contato@monetz.com.br` com os
   anexos.
3. Teste também um envio com falha proposital (ex: desligar o Wi-Fi) para
   confirmar que a mensagem de erro aparece corretamente.

---

## Limites e observações importantes

- **Tamanho dos anexos:** o formulário bloqueia envios com mais de 18MB no
  total (ajustável na constante `MAX_TOTAL_ATTACHMENT_BYTES` do HTML e
  `MAX_TOTAL_BYTES` do Worker). O SendGrid aceita até ~30MB por e-mail — a
  margem de 18MB cobre a expansão de ~33% do Base64.
- **Anti-spam básico:** existe um campo *honeypot* invisível (`website`); bots
  que preenchem todos os campos automaticamente costumam cair nessa armadilha
  e o envio é silenciosamente ignorado. Isso não impede abuso deliberado — se
  o formulário for divulgado publicamente e sofrer spam, considere adicionar
  Cloudflare Turnstile (CAPTCHA gratuito) na etapa de envio.
- **Dados sensíveis (LGPD):** este formulário coleta CPF, CNPJ, dados
  bancários, chave Pix e documentos de identidade/comprovantes. Antes de usar
  em produção:
  - Confirme que o texto de consentimento/privacidade na seção 9 do
    formulário foi validado pelo jurídico.
  - Trate o e-mail recebido como dado sensível (acesso restrito, não
    encaminhar sem necessidade).
  - Avalie o tempo de retenção dos anexos na caixa de e-mail e considere um
    processo de exclusão/arquivamento.
  - Cloudflare e SendGrid processam esses dados em trânsito — revise os termos
    de cada um se isso for relevante para a política de dados da Monetz.
- **CORS:** o Worker só aceita requisições vindas da origem definida em
  `ALLOWED_ORIGIN`. Se o formulário for movido para outro domínio, atualize
  essa variável e rode `wrangler deploy` novamente.
