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

const STYLES = `
  :root { color-scheme: dark }
  * { margin: 0; box-sizing: border-box }
  body {
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: #0b0b10; color: #f4f4f6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 24px;
  }
  .card { max-width: 420px; width: 100%; text-align: center }
  .cover { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 16px; margin-bottom: 24px }
  .brand { font-size: 14px; letter-spacing: 2px; text-transform: uppercase; color: #8b8b98; margin-bottom: 12px }
  h1 { font-size: 26px; line-height: 1.25; margin-bottom: 8px }
  .meta { color: #b9b9c6; font-size: 15px; margin-bottom: 24px }
  .desc { color: #8b8b98; font-size: 14px; line-height: 1.5; margin-bottom: 24px }
  .btn {
    display: block; width: 100%; padding: 14px 16px; border-radius: 12px;
    font-size: 16px; font-weight: 600; text-decoration: none; margin-bottom: 12px;
  }
  .btn-primary { background: #7c3aed; color: #fff }
  .btn-secondary { background: #1c1c26; color: #f4f4f6 }
`

type OgTags = {
  title: string
  description: string
  url?: string
  imageUrl?: string | null
}

function head(og: OgTags): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(og.title)} · Clubber</title>
<meta property="og:site_name" content="Clubber">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(og.title)}">
<meta property="og:description" content="${esc(og.description)}">
${og.url ? `<meta property="og:url" content="${esc(og.url)}">` : ''}
${og.imageUrl ? `<meta property="og:image" content="${esc(og.imageUrl)}">` : ''}
<meta name="twitter:card" content="${og.imageUrl ? 'summary_large_image' : 'summary'}">
<style>${STYLES}</style>
</head>`
}

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
  <main class="card">
    ${data.coverUrl ? `<img class="cover" src="${esc(data.coverUrl)}" alt="">` : ''}
    <p class="brand">Convite · Clubber</p>
    <h1>${esc(data.title)}</h1>
    <p class="meta">${esc(description)}</p>
    ${data.description ? `<p class="desc">${esc(data.description)}</p>` : ''}
    <a class="btn btn-primary" href="${esc(data.appUrl)}">Abrir no Clubber</a>
    ${data.appStoreUrl ? `<a class="btn btn-secondary" href="${esc(data.appStoreUrl)}">Baixar na App Store</a>` : ''}
    <a class="btn btn-secondary" href="${esc(data.playStoreUrl)}">Baixar no Google Play</a>
  </main>
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
  <main class="card">
    <p class="brand">Clubber</p>
    <h1>${copy.title}</h1>
    <p class="meta">${copy.message}</p>
    ${appStoreUrl ? `<a class="btn btn-secondary" href="${esc(appStoreUrl)}">Baixar na App Store</a>` : ''}
    <a class="btn btn-secondary" href="${esc(playStoreUrl)}">Baixar no Google Play</a>
  </main>
</body>
</html>`
}
