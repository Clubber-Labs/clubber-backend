import { STICKER_WORDMARK_URL } from '../../lib/brand-assets'
import type { InviteLandingData } from './share.service'

// Tudo que entra no HTML passa por aqui — título/descrição vêm do usuário.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Espelho dos tokens do app (src/shared/theme/colors.ts do mobile + régua de
// raios do CLAUDE.md de lá): zinc #0b0b0d de fundo, superfícies em raio
// moderado, controle interativo é PÍLULA, primário branco cheio (o pop vem do
// contraste — nunca gradiente nem o violeta legado). Sora só em marca/título,
// como no app.
const STYLES = `
  :root { color-scheme: dark }
  * { margin: 0; box-sizing: border-box }
  body {
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: #0b0b0d; color: #ffffff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 24px 20px 40px;
  }
  .page { max-width: 420px; width: 100% }
  .brand { display: block; width: 150px; height: auto; margin: 0 auto 28px }
  .heading {
    font-family: 'Sora', -apple-system, sans-serif; font-weight: 700;
    font-size: 24px; line-height: 1.25; margin-bottom: 20px;
  }
  .card {
    background: #18181b; border: 1px solid #27272a; border-radius: 16px;
    overflow: hidden; margin-bottom: 24px;
  }
  .cover { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block }
  .cover-fallback {
    width: 100%; aspect-ratio: 16/9;
    background: radial-gradient(circle at 0 0, #3f3f46, #18181b 70%);
  }
  .card-body { padding: 16px; text-align: left }
  h1 {
    font-family: 'Sora', -apple-system, sans-serif; font-weight: 700;
    font-size: 20px; line-height: 1.3; margin-bottom: 6px;
  }
  .meta { color: #e2e6eb; font-size: 14px }
  .desc {
    color: #9aa4b0; font-size: 14px; line-height: 1.5; margin-top: 10px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .btn {
    display: block; width: 100%; padding: 16px; border-radius: 9999px;
    font-size: 16px; text-align: center; text-decoration: none;
    margin-bottom: 12px;
  }
  .btn-primary { background: #ffffff; color: #0b0b0d; font-weight: 700 }
  .btn-secondary {
    background: transparent; color: #e2e6eb; font-weight: 600;
    border: 1px solid #3f3f46;
  }
  .hint { color: #6b7684; font-size: 12px; text-align: center; margin-top: 16px }
`

type OgTags = {
  title: string
  description: string
  url?: string
  imageUrl?: string | null
}

// Com as DUAS lojas na página, esconde a da plataforma errada (iPhone não
// precisa ver Google Play). Só quando ambas existem — com uma loja só, ela
// aparece pra todo mundo: pior que botão errado é nenhum. Sem JS (crawler,
// leitor estranho), ficam os dois — degradação inofensiva.
const STORE_PICKER_SCRIPT = `<script>
(function () {
  var ios = document.querySelector('[data-store="ios"]')
  var android = document.querySelector('[data-store="android"]')
  if (!ios || !android) return
  var ua = navigator.userAgent
  // iPadOS 13+ manda UA de Mac desktop; o toque (maxTouchPoints) o denuncia.
  var isIos = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  if (isIos) android.style.display = 'none'
  else if (/Android/i.test(ua)) ios.style.display = 'none'
})()
</script>`

function head(og: OgTags): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0b0d">
<title>${esc(og.title)} · Clubber</title>
<meta property="og:site_name" content="Clubber">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(og.description)}">
${og.url ? `<meta property="og:url" content="${esc(og.url)}">` : ''}
${og.imageUrl ? `<meta property="og:image" content="${esc(og.imageUrl)}">` : ''}
<meta name="twitter:card" content="${og.imageUrl ? 'summary_large_image' : 'summary'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@700;800&display=swap" rel="stylesheet">
<style>${STYLES}</style>
</head>`
}

// Sticker oficial da marca — mesma fonte do template de e-mail.
const WORDMARK = `<img class="brand" src="${STICKER_WORDMARK_URL}" width="150" height="66" alt="clubber">`

export function renderInviteLanding(
  data: Extract<InviteLandingData, { kind: 'ok' }>,
): string {
  const description = `${data.dateLabel} · por ${data.authorLabel}`
  return `${head({
    title: data.title,
    description,
    url: data.shareUrl,
    imageUrl: data.coverUrl,
  })}
<body>
  <main class="page">
    ${WORDMARK}
    <p class="heading">${esc(data.authorLabel)} te convidou</p>
    <section class="card">
      ${
        data.coverUrl
          ? `<img class="cover" src="${esc(data.coverUrl)}" alt="">`
          : '<div class="cover-fallback"></div>'
      }
      <div class="card-body">
        <h1>${esc(data.title)}</h1>
        <p class="meta">${esc(data.dateLabel)}</p>
        ${data.description ? `<p class="desc">${esc(data.description)}</p>` : ''}
      </div>
    </section>
    <a class="btn btn-primary" href="${esc(data.appUrl)}">Abrir no Clubber</a>
    ${data.appStoreUrl ? `<a class="btn btn-secondary" data-store="ios" href="${esc(data.appStoreUrl)}">Baixar na App Store</a>` : ''}
    <a class="btn btn-secondary" data-store="android" href="${esc(data.playStoreUrl)}">Baixar no Google Play</a>
    <p class="hint">Baixou agora? Volta e toca no link do convite de novo — ele abre direto no app.</p>
  </main>
  ${STORE_PICKER_SCRIPT}
</body>
</html>`
}

const UNAVAILABLE_COPY = {
  not_found: {
    title: 'Convite não encontrado',
    message: 'Esse link de convite não existe ou foi digitado errado.',
  },
  gone: {
    title: 'Convite indisponível',
    message: 'Esse convite não está mais valendo — fala com quem te chamou.',
  },
} as const

export function renderUnavailableLanding(
  reason: keyof typeof UNAVAILABLE_COPY,
  playStoreUrl: string,
  appStoreUrl?: string,
): string {
  const copy = UNAVAILABLE_COPY[reason]
  return `${head({ title: copy.title, description: copy.message })}
<body>
  <main class="page">
    ${WORDMARK}
    <section class="card">
      <div class="card-body">
        <h1>${copy.title}</h1>
        <p class="desc">${copy.message}</p>
      </div>
    </section>
    ${appStoreUrl ? `<a class="btn btn-secondary" data-store="ios" href="${esc(appStoreUrl)}">Baixar na App Store</a>` : ''}
    <a class="btn btn-secondary" data-store="android" href="${esc(playStoreUrl)}">Baixar no Google Play</a>
  </main>
  ${STORE_PICKER_SCRIPT}
</body>
</html>`
}
