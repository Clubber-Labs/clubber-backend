import { faker } from '@faker-js/faker/locale/pt_BR'
import {
  AttendanceType,
  type EventCategory,
  FollowStatus,
  type NotificationType,
  type Prisma,
  PrismaClient,
  type SpotVisibility,
  UserRole,
} from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ─── helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function sample<T>(arr: readonly T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

const PASSWORD_HASH = bcrypt.hashSync('senha123', 10)

const CATEGORIES = [
  'PARTY',
  'MUSIC',
  'SPORTS',
  'ART',
  'GASTRONOMY',
  'TECH',
  'NIGHTLIFE',
  'EDUCATION',
] as const

const ATTENDANCE_TYPES = [AttendanceType.CONFIRMED, AttendanceType.INTERESTED]

// Pool ponderado pra categoria primária do evento: shows (MUSIC) e baladas
// (NIGHTLIFE) têm prioridade, então aparecem com bem mais frequência no feed.
const CATEGORY_WEIGHTS: Record<(typeof CATEGORIES)[number], number> = {
  MUSIC: 5,
  NIGHTLIFE: 5,
  PARTY: 2,
  GASTRONOMY: 1,
  SPORTS: 1,
  ART: 1,
  TECH: 1,
  EDUCATION: 1,
}
const WEIGHTED_CATEGORIES = CATEGORIES.flatMap((c) =>
  Array.from({ length: CATEGORY_WEIGHTS[c] }, () => c),
)

// ─── conteúdo realista (PT) ─────────────────────────────────────────────────────

const EVENT_TITLES: Record<(typeof CATEGORIES)[number], string[]> = {
  PARTY: [
    'Festa de Aniversário da Marina',
    'Esquenta de Sexta no Apê',
    'Festa Junina do Bairro',
    'Churrasco de Confraternização',
    'Festa à Fantasia',
  ],
  MUSIC: [
    'Show do Jorge & Mateus na Pedreira',
    'Henrique & Juliano ao Vivo',
    'Festival Turá Curitiba',
    'Show do Nando Reis',
    'Maneva em Turnê',
    'Show da Marília Mendonça Cover',
    'Tributo ao Charlie Brown Jr.',
    'Show do Djonga — Turnê Nova',
    'Festival João Rock — Caravana',
    'Show do Seu Jorge — Músicas para Churrasco',
  ],
  SPORTS: [
    'Pelada de Domingo no Parque',
    'Corrida 5K no Parque Barigui',
    'Aulão de Beach Tennis',
    'Treino Funcional ao Ar Livre',
    'Torneio de Vôlei de Praia',
  ],
  ART: [
    'Exposição de Fotografia Urbana',
    'Vernissage na Galeria do Largo',
    'Mostra de Arte Independente',
    'Stand-up Comedy no Teatro',
    'Sessão de Cinema ao Ar Livre',
  ],
  GASTRONOMY: [
    'Festival de Food Trucks',
    'Jantar Harmonizado com Vinhos',
    'Feira Gastronômica do Largo',
    'Festival de Inverno — Fondue & Vinho',
    'Rota da Cerveja Artesanal',
  ],
  TECH: [
    'Meetup de Devs Curitiba',
    'Hackathon de IA',
    'Talk: Carreira em Tecnologia',
    'Workshop de React Native',
    'Café com Código',
  ],
  NIGHTLIFE: [
    'Show de DJ no Rooftop',
    'Quinta do Sertanejo ao Vivo',
    'Balada Eletrônica no Centro',
    'Pagode da Vila',
    'Festa Open Bar com Banda ao Vivo',
  ],
  EDUCATION: [
    'Palestra sobre Finanças Pessoais',
    'Roda de Conversa sobre Carreira',
    'Workshop de Oratória',
    'Clube do Livro',
    'Talk Show com Convidado Especial',
  ],
}

const EVENT_DESCRIPTIONS = [
  'Vai ser uma noite incrível! Traga os amigos e venha curtir com a gente. Confirma presença pra garantir seu lugar.',
  'Evento gratuito e aberto a todos. Vai ter música boa, comida e muita gente animada. Te espero lá!',
  'Preparamos tudo com muito carinho pra esse encontro. Chega cedo que costuma lotar rápido.',
  'Bora se reunir e fazer dessa data um momento especial. Qualquer dúvida, é só chamar nos comentários.',
  'Um encontro pra relaxar, conhecer gente nova e aproveitar o melhor da cidade. Não fica de fora!',
  'Programação caprichada do início ao fim. Leve sua energia boa e quem você ama.',
]

const BIOS = [
  'Apaixonado por música e bons encontros.',
  'Sempre em busca do próximo rolê. 🎶',
  'Curitibano, amante de café e trilhas.',
  'Organizo eventos e adoro conhecer gente nova.',
  'Fotógrafa nas horas vagas 📷',
  'Vivo de esporte e boa comida.',
  'Bora marcar alguma coisa esse fim de semana?',
  'Acredito que tudo fica melhor com os amigos por perto.',
]

const EVENT_COMMENTS = [
  'Que demais, vou sim!',
  'Bora! 🙌',
  'Já confirmei presença',
  'Alguém vai de carona?',
  'Que horas começa mesmo?',
  'Esse vai ser top',
  'Faz tempo que não vejo todo mundo',
  'Vou levar uns amigos',
  'Tô dentro!',
  'Mal posso esperar 🎉',
]

const POST_CONTENTS = [
  'Foi incrível ontem, valeu a todos que vieram! 🙌',
  'Melhor evento do mês com certeza.',
  'Quem mais tá animado pro próximo?',
  'As fotos ficaram demais, depois compartilho aqui.',
  'Já tô com saudade. Bora repetir!',
  'Energia surreal hoje, obrigado galera ❤️',
]

const DM_MESSAGES = [
  'Oi! tudo bem?',
  'Bora naquele evento sábado?',
  'Vi que você confirmou presença, eu também vou!',
  'Que horas a gente combina?',
  'Fechou, te encontro lá',
  'Me manda o endereço depois?',
  'Tô chegando em uns 10 min',
  'Valeu pela dica do rolê 🙏',
  'Partiu?',
  'kkkk com certeza',
  'Depois te mostro as fotos',
  'Você vai sozinho ou com a galera?',
]

const GROUP_MESSAGES = [
  'Galera, alguém vai no show hoje?',
  'Eu vou!',
  'Bora marcar o esquenta antes',
  'Levo a caixa de som',
  'Confirmadíssimo',
  'que horas a gente se encontra?',
  'combinado às 20h então',
  'alguém pode dar carona pro centro?',
  'vou levar uns salgados',
  'esse fim de semana vai ser top demais',
]

const GROUP_TITLES = [
  'Galera do Show',
  'Vôlei de Domingo',
  'Trampo & Cervejas',
  'Rolês de Curitiba',
]

// Spots = rolês efêmeros ancorados num lugar real. title + categorias coerentes.
const SPOTS = [
  {
    title: 'Happy hour no Boteco do Centro',
    categories: ['NIGHTLIFE', 'GASTRONOMY'],
  },
  { title: 'Pelada no Parque Barigui', categories: ['SPORTS', 'OUTDOORS'] },
  { title: 'Café & code na Vila', categories: ['TECH', 'GASTRONOMY'] },
  {
    title: 'Som ao vivo no bar da esquina',
    categories: ['MUSIC', 'NIGHTLIFE'],
  },
  { title: 'Trilha no Parque Tanguá', categories: ['OUTDOORS', 'SPORTS'] },
  { title: 'Rodízio de pizza hoje', categories: ['GASTRONOMY'] },
  { title: 'Cervejada pós-trampo', categories: ['NIGHTLIFE', 'PARTY'] },
  { title: 'Skate no Largo da Ordem', categories: ['SPORTS', 'ART'] },
] as const

const SPOT_MESSAGES = [
  'Bora? já tô a caminho',
  'Cheguei, tô na entrada',
  'Quem mais vem?',
  'Guardei lugar pra galera',
  'Atrasa não que tá enchendo',
  'Tô levando mais um amigo',
]

// Imagens: capas temáticas coerentes com o evento. A fonte preferida é o
// Unsplash (fotos reais e curadas); sem UNSPLASH_ACCESS_KEY caímos pro
// loremflickr, então o seed nunca quebra. `key`/`format`/`size` espelham o que
// o provider de upload gravaria.

// Query de busca por categoria → capa temática coerente com o evento.
const CATEGORY_IMAGE_QUERY: Record<string, string> = {
  PARTY: 'party celebration',
  MUSIC: 'concert live music',
  SPORTS: 'sports',
  ART: 'art exhibition',
  GASTRONOMY: 'food restaurant',
  TECH: 'technology conference',
  NIGHTLIFE: 'nightclub party',
  EDUCATION: 'lecture seminar',
  OUTDOORS: 'outdoor nature',
}
const FALLBACK_IMAGE_QUERY = 'event celebration'

// Hash estável (string → inteiro positivo) pra escolher/fixar a imagem.
function stableLock(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

// Pool de URLs do Unsplash por query — preenchido uma vez por query (não 1 req
// por imagem). Vazio quando não há key ou a chamada falha → cai no loremflickr.
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY
const imagePoolByQuery = new Map<string, string[]>()

async function loadImagePool(query: string) {
  if (imagePoolByQuery.has(query)) return
  if (!UNSPLASH_ACCESS_KEY) {
    imagePoolByQuery.set(query, [])
    return
  }
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape&content_filter=high`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as {
      results?: { urls?: { regular?: string } }[]
    }
    const urls = (json.results ?? [])
      .map((p) => p.urls?.regular)
      .filter((u): u is string => Boolean(u))
    imagePoolByQuery.set(query, urls)
  } catch (e) {
    console.warn(
      `   ⚠️  Unsplash falhou para "${query}" (${e}) — usando loremflickr`,
    )
    imagePoolByQuery.set(query, [])
  }
}

function fakeImage(
  folder: 'events' | 'posts',
  ownerId: string,
  order: number,
  query: string,
) {
  const key = `${folder}/${ownerId}/${order}`
  const pool = imagePoolByQuery.get(query) ?? []
  const url = pool.length
    ? pool[stableLock(key) % pool.length]
    : `https://loremflickr.com/800/600/${query.replace(/\s+/g, ',')}?lock=${stableLock(key)}`
  return {
    url,
    key,
    format: 'jpg',
    size: faker.number.int({ min: 80_000, max: 1_200_000 }),
    order,
  }
}

// Avatar de perfil: foto de rosto real e estável por usuário (pravatar usa o
// identificador em `?u=` pra sempre devolver a mesma imagem).
function avatarUrl(seed: string) {
  return `https://i.pravatar.cc/300?u=${encodeURIComponent(seed)}`
}

// Denúncias: motivos + textos curtos coerentes com cada motivo.
const REPORT_REASONS = [
  'HATE_SPEECH',
  'SPAM_OR_FRAUD',
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'OTHER',
] as const

const REPORT_DETAILS: Record<(typeof REPORT_REASONS)[number], string> = {
  HATE_SPEECH: 'Discurso de ódio contra um grupo.',
  SPAM_OR_FRAUD: 'Parece golpe / conteúdo repetido em massa.',
  HARASSMENT: 'Está perseguindo e ofendendo outros usuários.',
  INAPPROPRIATE_CONTENT: 'Conteúdo impróprio para a plataforma.',
  OTHER: 'Outro motivo (ver descrição com a moderação).',
}

// Os 7 consentimentos granulares da Política de Privacidade v1.0 (LGPD).
const CONSENT_FIELDS = [
  'locationPrecise',
  'socialFeed',
  'socialVisibility',
  'pushNotifications',
  'marketing',
  'analytics',
  'surveys',
] as const

// Copy das notificações sociais — espelha notification-content.ts (mantido inline
// pra o seed seguir autossuficiente, como os demais textos acima).
function notificationCopy(
  type: string,
  who: string,
): { title: string; body: string } {
  switch (type) {
    case 'FOLLOW_REQUEST':
      return { title: 'Nova solicitação', body: `${who} quer te seguir` }
    case 'NEW_FOLLOWER':
      return { title: 'Novo seguidor', body: `${who} começou a te seguir` }
    case 'FOLLOW_ACCEPTED':
      return {
        title: 'Solicitação aceita',
        body: `${who} aceitou seu pedido para seguir`,
      }
    case 'EVENT_INVITE':
      return {
        title: 'Convite para evento',
        body: `${who} te convidou para um evento`,
      }
    case 'EVENT_COMMENT':
      return { title: 'Novo comentário', body: `${who} comentou no seu evento` }
    case 'POST_COMMENT':
      return { title: 'Novo comentário', body: `${who} comentou no seu post` }
    case 'EVENT_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu evento` }
    case 'POST_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu post` }
    case 'COMMENT_REACTION':
      return { title: 'Nova curtida', body: `${who} curtiu seu comentário` }
    case 'EVENT_ATTENDANCE':
      return { title: 'Nova presença', body: `${who} vai ao seu evento` }
    default:
      return { title: 'Novidade', body: `${who} interagiu com você` }
  }
}

// ─── seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Limpando banco...')
  await prisma.report.deleteMany()
  // Spot referencia conversation (FK RESTRICT) e creator — apaga antes de ambos.
  // As quotas (geração/descoberta) e preferências cascateiam no delete do user.
  await prisma.spot.deleteMany()
  // Chat: conversation cascateia participants/messages/attachments.
  await prisma.conversation.deleteMany()
  await prisma.block.deleteMany()
  await prisma.featuredEvent.deleteMany()
  await prisma.reaction.deleteMany()
  await prisma.comment.deleteMany()
  await prisma.post.deleteMany()
  await prisma.eventInvite.deleteMany()
  await prisma.eventAttendance.deleteMany()
  await prisma.event.deleteMany()
  // eventSeries depois de event (seriesId é SetNull) e antes de user (RESTRICT).
  await prisma.eventSeries.deleteMany()
  await prisma.follow.deleteMany()
  await prisma.user.deleteMany()

  // ── 1. Usuários ─────────────────────────────────────────────────────────────
  console.log('👤 Criando usuários...')

  const adminDemo = await prisma.user.create({
    data: {
      name: 'Admin',
      lastname: 'Demo',
      username: 'admin_demo',
      email: 'admin@conectai.dev',
      password: PASSWORD_HASH,
      phone: '11900000000',
      birthdate: new Date('1990-01-01'),
      role: UserRole.ADMIN,
      isPremium: true,
      avatarUrl: avatarUrl('admin@conectai.dev'),
    },
  })

  const premiumDemo = await prisma.user.create({
    data: {
      name: 'Premium',
      lastname: 'Demo',
      username: 'premium_demo',
      email: 'premium@conectai.dev',
      password: PASSWORD_HASH,
      phone: '11900000001',
      birthdate: new Date('1995-01-01'),
      isPremium: true,
      avatarUrl: avatarUrl('premium@conectai.dev'),
    },
  })

  const usersData = Array.from({ length: 24 }).map((_, i) => {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    return {
      name: firstName,
      lastname: lastName,
      username: faker.internet
        .username({ firstName, lastName })
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20),
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
      password: PASSWORD_HASH,
      phone: faker.phone
        .number({ style: 'national' })
        .replace(/\D/g, '')
        .slice(0, 11)
        .padEnd(11, '0'),
      bio: i % 3 === 0 ? pick(BIOS) : null,
      // ~80% com foto de perfil; 1 em 5 fica sem pra exercitar o fallback
      avatarUrl: i % 5 === 0 ? null : avatarUrl(`seed-user-${i}`),
      isPrivate: i % 4 === 0, // 25% perfis privados
      birthdate: faker.date.birthdate({ min: 18, max: 40, mode: 'age' }),
    }
  })

  // garante username e phone únicos
  const seenUsernames = new Set<string>()
  const seenPhones = new Set<string>()
  const deduped = usersData.filter((u) => {
    if (seenUsernames.has(u.username) || seenPhones.has(u.phone)) return false
    seenUsernames.add(u.username)
    seenPhones.add(u.phone)
    return true
  })

  const randomUsers = await Promise.all(
    deduped.map((data) => prisma.user.create({ data })),
  )
  const users = [adminDemo, premiumDemo, ...randomUsers]

  console.log(
    `   ✓ ${users.length} usuários criados (1 admin + 1 premium fixos)`,
  )
  console.log('   🛡️  Admin fixo: admin@conectai.dev (admin_demo)')
  console.log('   ⭐ Premium fixo: premium@conectai.dev (premium_demo)')
  console.log('   📧 Login: qualquer email acima | Senha: senha123')

  // ── 2. Follows ───────────────────────────────────────────────────────────────
  console.log('🔗 Criando follows...')

  const followPairs: Array<[string, string]> = []
  for (const follower of users) {
    const targets = sample(
      users.filter((u) => u.id !== follower.id),
      faker.number.int({ min: 2, max: 5 }),
    )
    for (const target of targets) {
      const alreadyExists = followPairs.some(
        ([a, b]) => a === follower.id && b === target.id,
      )
      if (!alreadyExists) {
        followPairs.push([follower.id, target.id])
      }
    }
  }

  const follows = await Promise.all(
    followPairs.map(([followerId, followingId]) =>
      prisma.follow.create({
        data: {
          followerId,
          followingId,
          status: FollowStatus.ACCEPTED,
        },
      }),
    ),
  )

  // Atualiza contadores manualmente (seed não usa transactions do service)
  for (const follow of follows) {
    await prisma.user.update({
      where: { id: follow.followerId },
      data: { followingCount: { increment: 1 } },
    })
    await prisma.user.update({
      where: { id: follow.followingId },
      data: { followersCount: { increment: 1 } },
    })
  }

  // Alguns follows pendentes
  const pendingCandidates = sample(users, 4)
  for (let i = 0; i < pendingCandidates.length - 1; i++) {
    const a = pendingCandidates[i]
    const b = pendingCandidates[i + 1]
    const alreadyExists = followPairs.some(([x, y]) => x === a.id && y === b.id)
    if (!alreadyExists) {
      await prisma.follow.create({
        data: {
          followerId: a.id,
          followingId: b.id,
          status: FollowStatus.PENDING,
        },
      })
    }
  }

  console.log(`   ✓ ${follows.length} follows aceitos + alguns pendentes`)

  // ── 3. Eventos ───────────────────────────────────────────────────────────────
  console.log('📅 Criando eventos...')

  // Coordenadas aproximadas de Curitiba + arredores
  function curitibaCoords() {
    return {
      latitude: faker.location.latitude({ min: -25.65, max: -25.35 }),
      longitude: faker.location.longitude({ min: -49.45, max: -49.15 }),
    }
  }

  const eventsData = users.flatMap((author, i) =>
    Array.from({ length: faker.number.int({ min: 1, max: 3 }) }).map((_, j) => {
      // Categoria primária dá o título; 0–2 extras exercitam o multi-categoria.
      // Ponderada → shows e baladas dominam o feed.
      const primary = pick(WEIGHTED_CATEGORIES)
      const extras = sample(
        CATEGORIES.filter((c) => c !== primary),
        faker.number.int({ min: 0, max: 2 }),
      )
      return {
        title: pick(EVENT_TITLES[primary]),
        description: pick(EVENT_DESCRIPTIONS),
        date: faker.date.soon({ days: 30 }),
        ...curitibaCoords(),
        categories: [primary, ...extras],
        isPublic: !(i % 5 === 0 && j === 0), // ~20% privados
        authorId: author.id,
      }
    }),
  )

  const events = await Promise.all(
    eventsData.map((data) => prisma.event.create({ data })),
  )

  const publicEvents = events.filter((e) => e.isPublic)
  const privateEvents = events.filter((e) => !e.isPublic)

  console.log(
    `   ✓ ${events.length} eventos (${publicEvents.length} públicos, ${privateEvents.length} privados)`,
  )

  // ── 3b. Série recorrente (RF11.6, premium) ──────────────────────────────────
  // "Futeba de quarta" semanal do premiumDemo: 4 ocorrências espaçadas 7 dias.
  // O template (title/categories/duração…) mora na série — o reconciler clona
  // DESTE template para repor ocorrências futuras; séries sem template são
  // puladas. `categories` é NOT NULL no schema, então é obrigatório aqui.
  const futebaTemplate = {
    title: 'Futeba de quarta',
    description: 'Pelada semanal da galera',
    latitude: -25.43,
    longitude: -49.27,
    address: 'Quadra do bairro',
    categories: ['SPORTS'] as EventCategory[],
    isPublic: true,
    durationMs: 2 * 3_600_000, // 2h de jogo
  }
  const recurringSeries = await prisma.eventSeries.create({
    data: {
      frequency: 'WEEKLY',
      interval: 1,
      authorId: premiumDemo.id,
      ...futebaTemplate,
    },
  })
  const firstOccurrence = new Date()
  firstOccurrence.setDate(firstOccurrence.getDate() + 2)
  firstOccurrence.setHours(20, 0, 0, 0)
  await prisma.event.createMany({
    data: Array.from({ length: 4 }, (_, i) => {
      const date = new Date(firstOccurrence.getTime() + i * 7 * 86_400_000)
      return {
        title: futebaTemplate.title,
        description: futebaTemplate.description,
        date,
        endDate: new Date(date.getTime() + futebaTemplate.durationMs),
        latitude: futebaTemplate.latitude,
        longitude: futebaTemplate.longitude,
        address: futebaTemplate.address,
        categories: futebaTemplate.categories,
        isPublic: futebaTemplate.isPublic,
        authorId: premiumDemo.id,
        seriesId: recurringSeries.id,
      }
    }),
  })
  console.log(
    '   🔁 1 série recorrente semanal (premium_demo) com 4 ocorrências',
  )

  // ── 3c. Imagens de eventos (upload webp) ─────────────────────────────────────
  // ~40% dos eventos públicos ganham 1–3 imagens, ordenadas por `order`. A capa
  // segue a categoria primária do evento (1ª de `categories`).
  console.log('🖼️  Criando imagens de eventos...')

  // Pré-carrega o pool de fotos do Pexels por query (1 req por query, não por
  // imagem). Sem PEXELS_API_KEY os pools ficam vazios → loremflickr no fakeImage.
  await Promise.all(
    [
      ...new Set([
        ...Object.values(CATEGORY_IMAGE_QUERY),
        FALLBACK_IMAGE_QUERY,
      ]),
    ].map(loadImagePool),
  )
  if (UNSPLASH_ACCESS_KEY) console.log('   📸 fotos via Unsplash')

  const eventImages = publicEvents.flatMap((event) => {
    const query =
      CATEGORY_IMAGE_QUERY[event.categories[0]] ?? FALLBACK_IMAGE_QUERY
    return faker.datatype.boolean({ probability: 0.4 })
      ? Array.from(
          { length: faker.number.int({ min: 1, max: 3 }) },
          (_, n) => ({
            eventId: event.id,
            ...fakeImage('events', event.id, n, query),
          }),
        )
      : []
  })
  await prisma.eventImage.createMany({ data: eventImages })
  console.log(`   ✓ ${eventImages.length} imagens de eventos`)

  // ── 3d. Destaques / promoção de eventos (RF11.4+, premium) ───────────────────
  // Só autor premium destaca o próprio evento; uma janela ativa agora marca
  // Event.isFeatured. Exercita os 3 estados: ativo, agendado e cancelado. Cada
  // destaque consome 1 da quota mensal (EventPromotionUsage).
  console.log('⭐ Criando destaques de eventos...')

  const HOUR_MS = 3_600_000
  const nowMs = Date.now()
  const promotionPeriod = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  )

  // Ocorrências da "Futeba de quarta" (premium_demo) têm datas folgadas (+2d…),
  // ideais para janelas de destaque sem violar endsAt <= event.date.
  const futeba = await prisma.event.findMany({
    where: { seriesId: recurringSeries.id },
    orderBy: { date: 'asc' },
    select: { id: true },
  })

  const promotionUsage: Array<{ userId: string; count: number }> = []

  if (futeba.length >= 3) {
    // Ativo agora → isFeatured = true
    await prisma.featuredEvent.create({
      data: {
        eventId: futeba[0].id,
        createdBy: premiumDemo.id,
        startsAt: new Date(nowMs - HOUR_MS),
        endsAt: new Date(nowMs + 6 * HOUR_MS),
      },
    })
    await prisma.event.update({
      where: { id: futeba[0].id },
      data: { isFeatured: true },
    })
    // Agendado (ainda não começou) → não marca isFeatured
    await prisma.featuredEvent.create({
      data: {
        eventId: futeba[1].id,
        createdBy: premiumDemo.id,
        startsAt: new Date(nowMs + 12 * HOUR_MS),
        endsAt: new Date(nowMs + 18 * HOUR_MS),
      },
    })
    // Cancelado (janela passada, soft-cancel) → consumiu quota mesmo assim
    await prisma.featuredEvent.create({
      data: {
        eventId: futeba[2].id,
        createdBy: premiumDemo.id,
        startsAt: new Date(nowMs - 26 * HOUR_MS),
        endsAt: new Date(nowMs - 2 * HOUR_MS),
        canceledAt: new Date(nowMs - 20 * HOUR_MS),
      },
    })
    promotionUsage.push({ userId: premiumDemo.id, count: 3 })
  }

  // admin_demo (também premium) destaca um evento próprio com data folgada.
  const adminEvent = events.find(
    (e) =>
      e.authorId === adminDemo.id &&
      e.isPublic &&
      e.date.getTime() > nowMs + 8 * HOUR_MS,
  )
  if (adminEvent) {
    await prisma.featuredEvent.create({
      data: {
        eventId: adminEvent.id,
        createdBy: adminDemo.id,
        startsAt: new Date(nowMs - 30 * 60_000),
        endsAt: new Date(nowMs + 5 * HOUR_MS),
      },
    })
    await prisma.event.update({
      where: { id: adminEvent.id },
      data: { isFeatured: true },
    })
    promotionUsage.push({ userId: adminDemo.id, count: 1 })
  }

  if (promotionUsage.length > 0) {
    await prisma.eventPromotionUsage.createMany({
      data: promotionUsage.map((u) => ({
        userId: u.userId,
        period: promotionPeriod,
        count: u.count,
      })),
    })
  }
  console.log(
    `   ✓ destaques criados (1 ativo, 1 agendado, 1 cancelado${adminEvent ? ' + 1 admin' : ''})`,
  )

  // ── 4. Convites para eventos privados ────────────────────────────────────────
  if (privateEvents.length > 0) {
    console.log('✉️  Criando convites para eventos privados...')
    for (const event of privateEvents) {
      const guests = sample(
        users.filter((u) => u.id !== event.authorId),
        faker.number.int({ min: 2, max: 5 }),
      )
      await prisma.eventInvite.createMany({
        data: guests.map((g) => ({
          eventId: event.id,
          inviterId: event.authorId,
          invitedId: g.id,
        })),
        skipDuplicates: true,
      })
    }
    console.log('   ✓ Convites criados')
  }

  // ── 5. Presenças ─────────────────────────────────────────────────────────────
  console.log('✅ Criando presenças...')

  const attendancePairs = new Set<string>()
  const attendancesToCreate: Array<{
    userId: string
    eventId: string
    type: AttendanceType
  }> = []

  for (const event of events) {
    // Author sempre confirma presença no próprio evento
    attendancePairs.add(`${event.authorId}-${event.id}`)
    attendancesToCreate.push({
      userId: event.authorId,
      eventId: event.id,
      type: AttendanceType.CONFIRMED,
    })

    // Outros usuários participam
    const participants = sample(
      users.filter((u) => u.id !== event.authorId),
      faker.number.int({ min: 1, max: 5 }),
    )

    for (const user of participants) {
      const key = `${user.id}-${event.id}`
      if (!attendancePairs.has(key)) {
        // Para eventos privados só quem foi convidado pode ter presença
        if (!event.isPublic) {
          const invited = await prisma.eventInvite.findUnique({
            where: {
              eventId_invitedId: { eventId: event.id, invitedId: user.id },
            },
          })
          if (!invited) continue
        }
        attendancePairs.add(key)
        attendancesToCreate.push({
          userId: user.id,
          eventId: event.id,
          type: pick(ATTENDANCE_TYPES),
        })
      }
    }
  }

  await prisma.eventAttendance.createMany({
    data: attendancesToCreate,
    skipDuplicates: true,
  })
  console.log(`   ✓ ${attendancesToCreate.length} presenças criadas`)

  // ── 6. Reações em eventos ────────────────────────────────────────────────────
  console.log('❤️  Criando reações em eventos...')

  const eventReactions: Array<{
    userId: string
    eventId: string
  }> = []
  const eventReactionPairs = new Set<string>()

  for (const event of publicEvents) {
    const reactors = sample(users, faker.number.int({ min: 0, max: 6 }))
    for (const user of reactors) {
      const key = `${user.id}-${event.id}`
      if (!eventReactionPairs.has(key)) {
        eventReactionPairs.add(key)
        eventReactions.push({
          userId: user.id,
          eventId: event.id,
        })
      }
    }
  }

  await prisma.reaction.createMany({
    data: eventReactions,
    skipDuplicates: true,
  })
  console.log(`   ✓ ${eventReactions.length} reações em eventos`)

  // ── 7. Comentários em eventos ────────────────────────────────────────────────
  console.log('💬 Criando comentários em eventos...')

  const eventComments: Array<{
    authorId: string
    eventId: string
    content: string
  }> = []

  for (const event of publicEvents) {
    const commenters = sample(users, faker.number.int({ min: 0, max: 4 }))
    for (const user of commenters) {
      eventComments.push({
        authorId: user.id,
        eventId: event.id,
        content: pick(EVENT_COMMENTS),
      })
    }
  }

  await prisma.comment.createMany({ data: eventComments })
  console.log(`   ✓ ${eventComments.length} comentários em eventos`)

  // ── 8. Posts ─────────────────────────────────────────────────────────────────
  console.log('📝 Criando posts...')

  // Apenas usuários CONFIRMED podem postar
  const confirmedAttendances = attendancesToCreate.filter(
    (a) => a.type === AttendanceType.CONFIRMED,
  )

  const postsToCreate = confirmedAttendances.flatMap((attendance) =>
    faker.datatype.boolean({ probability: 0.5 })
      ? [
          {
            authorId: attendance.userId,
            eventId: attendance.eventId,
            content: pick(POST_CONTENTS),
          },
        ]
      : [],
  )

  const posts = await Promise.all(
    postsToCreate.map((data) => prisma.post.create({ data })),
  )

  console.log(`   ✓ ${posts.length} posts criados`)

  // ── 8b. Imagens em posts (upload webp) ───────────────────────────────────────
  // ~40% dos posts ganham 1–4 imagens (RF: imagens em posts de evento). A capa
  // segue a categoria do evento do post, então combina com o tema.
  let postImageCount = 0
  if (posts.length > 0) {
    const categoryByEventId = new Map(
      events.map((e) => [e.id, e.categories[0]]),
    )
    const postImages = posts.flatMap((post) => {
      const query =
        CATEGORY_IMAGE_QUERY[categoryByEventId.get(post.eventId) ?? ''] ??
        FALLBACK_IMAGE_QUERY
      return faker.datatype.boolean({ probability: 0.4 })
        ? Array.from(
            { length: faker.number.int({ min: 1, max: 4 }) },
            (_, n) => ({
              postId: post.id,
              ...fakeImage('posts', post.id, n, query),
            }),
          )
        : []
    })
    await prisma.postImage.createMany({ data: postImages })
    postImageCount = postImages.length
    console.log(`   ✓ ${postImages.length} imagens em posts`)
  }

  // ── 9. Reações e comentários em posts ────────────────────────────────────────
  if (posts.length > 0) {
    console.log('💬 Criando reações e comentários em posts...')

    const postReactions: Array<{
      userId: string
      postId: string
    }> = []
    const postReactionPairs = new Set<string>()
    const postComments: Array<{
      authorId: string
      postId: string
      content: string
    }> = []

    for (const post of posts) {
      const reactors = sample(users, faker.number.int({ min: 0, max: 5 }))
      for (const user of reactors) {
        const key = `${user.id}-${post.id}`
        if (!postReactionPairs.has(key)) {
          postReactionPairs.add(key)
          postReactions.push({
            userId: user.id,
            postId: post.id,
          })
        }
      }

      const commenters = sample(users, faker.number.int({ min: 0, max: 3 }))
      for (const user of commenters) {
        postComments.push({
          authorId: user.id,
          postId: post.id,
          content: pick(EVENT_COMMENTS),
        })
      }
    }

    await prisma.reaction.createMany({
      data: postReactions,
      skipDuplicates: true,
    })
    await prisma.comment.createMany({ data: postComments })

    console.log(
      `   ✓ ${postReactions.length} reações e ${postComments.length} comentários em posts`,
    )
  }

  // ── 10. Chat (conversas e mensagens) ─────────────────────────────────────────
  console.log('💬 Criando conversas de chat...')

  function directKey(a: string, b: string) {
    return [a, b].sort().join(':')
  }

  // Timestamps cronológicos crescentes pra uma conversa (últimas ~48h).
  function conversationTimestamps(count: number): Date[] {
    const start = Date.now() - faker.number.int({ min: 2, max: 48 }) * 3_600_000
    let t = start
    return Array.from({ length: count }).map(() => {
      t += faker.number.int({ min: 1, max: 40 }) * 60_000
      return new Date(t)
    })
  }

  let conversationCount = 0
  let messageCount = 0

  // Cria uma conversa com N mensagens. `unreadFor` recebe mensagens não-lidas
  // (lastReadAt = null); os demais participantes "leram" tudo.
  async function seedConversation(opts: {
    type: 'DIRECT' | 'GROUP'
    title?: string
    members: { id: string }[]
    pool: string[]
    unreadFor: string[]
    lastSenderId?: string
  }) {
    const ids = opts.members.map((m) => m.id)
    const count = faker.number.int({ min: 3, max: 8 })
    const stamps = conversationTimestamps(count)
    const lastReadAt = stamps[stamps.length - 1]

    const convo = await prisma.conversation.create({
      data: {
        type: opts.type,
        title: opts.title ?? null,
        createdById: ids[0],
        directKey: opts.type === 'DIRECT' ? directKey(ids[0], ids[1]) : null,
        lastMessageAt: lastReadAt,
        participants: {
          create: opts.members.map((m, idx) => ({
            userId: m.id,
            role: opts.type === 'GROUP' && idx === 0 ? 'ADMIN' : 'MEMBER',
            // quem está em unreadFor não leu; os outros leram até a última msg
            lastReadAt: opts.unreadFor.includes(m.id) ? null : lastReadAt,
          })),
        },
      },
    })

    await prisma.message.createMany({
      data: stamps.map((createdAt, idx) => {
        const isLast = idx === stamps.length - 1
        const senderId =
          isLast && opts.lastSenderId ? opts.lastSenderId : pick(ids)
        return {
          conversationId: convo.id,
          senderId,
          content: pick(opts.pool),
          createdAt,
        }
      }),
    })

    conversationCount++
    messageCount += count
  }

  // DMs do usuário premium (com não-lidas pra ele, pra exercitar o badge).
  for (const other of sample(randomUsers, 3)) {
    await seedConversation({
      type: 'DIRECT',
      members: [other, premiumDemo], // other é o criador; premium recebe
      pool: DM_MESSAGES,
      unreadFor: [premiumDemo.id],
      lastSenderId: other.id, // última mensagem é do outro → premium tem unread
    })
  }

  // DMs aleatórias entre os demais usuários.
  for (let k = 0; k < 5; k++) {
    const [a, b] = sample(randomUsers, 2)
    if (!a || !b || a.id === b.id) continue
    await seedConversation({
      type: 'DIRECT',
      members: [a, b],
      pool: DM_MESSAGES,
      unreadFor: faker.datatype.boolean() ? [b.id] : [],
    })
  }

  // Grupos (premium participa de um, com não-lidas).
  const premiumGroupMembers = [premiumDemo, ...sample(randomUsers, 3)]
  await seedConversation({
    type: 'GROUP',
    title: pick(GROUP_TITLES),
    members: premiumGroupMembers,
    pool: GROUP_MESSAGES,
    unreadFor: [premiumDemo.id],
    lastSenderId: premiumGroupMembers[1].id,
  })

  const otherGroupMembers = sample(randomUsers, 4)
  if (otherGroupMembers.length >= 2) {
    await seedConversation({
      type: 'GROUP',
      title: pick(GROUP_TITLES),
      members: otherGroupMembers,
      pool: GROUP_MESSAGES,
      unreadFor: [],
    })
  }

  console.log(`   ✓ ${conversationCount} conversas e ${messageCount} mensagens`)

  // ── 11. Preferências de categoria ────────────────────────────────────────────
  // Necessárias pro botão "gerar sugestões" de spot (sem preferência → 400).
  console.log('🎯 Criando preferências de categoria...')

  const prefRows = users.flatMap((u) =>
    sample(CATEGORIES, faker.number.int({ min: 2, max: 4 })).map(
      (category) => ({
        userId: u.id,
        category,
      }),
    ),
  )
  await prisma.userCategoryPreference.createMany({
    data: prefRows,
    skipDuplicates: true,
  })
  console.log(`   ✓ ${prefRows.length} preferências`)

  // ── 12. Spots (rolês efêmeros ancorados num lugar) ───────────────────────────
  console.log('📍 Criando spots...')

  const HOUR = 3_600_000
  let spotCount = 0

  // Cria um spot publicado: grupo de chat (criador ADMIN + membros) + o spot
  // ligado a ele, com algumas mensagens. A coluna `location` (geography) é
  // gerada pelo Postgres a partir de lat/lng.
  async function seedSpot(opts: {
    creator: { id: string }
    title: string
    categories: readonly EventCategory[]
    visibility: SpotVisibility
    members: { id: string }[]
    startsAt: Date
    endsAt: Date
  }) {
    const memberIds = opts.members.map((m) => m.id)
    const ids = [opts.creator.id, ...memberIds]
    const convo = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        title: opts.title,
        createdById: opts.creator.id,
        lastMessageAt: new Date(),
        participants: {
          create: [
            { userId: opts.creator.id, role: 'ADMIN' },
            ...memberIds.map((userId) => ({ userId, role: 'MEMBER' as const })),
          ],
        },
      },
    })
    await prisma.message.createMany({
      data: Array.from({ length: faker.number.int({ min: 2, max: 5 }) }).map(
        () => ({
          conversationId: convo.id,
          senderId: pick(ids),
          content: pick(SPOT_MESSAGES),
        }),
      ),
    })
    await prisma.spot.create({
      data: {
        title: opts.title,
        categories: [...opts.categories],
        visibility: opts.visibility,
        placeId: `seed_place_${++spotCount}`,
        ...curitibaCoords(),
        startsAt: opts.startsAt,
        endsAt: opts.endsAt,
        creatorId: opts.creator.id,
        conversationId: convo.id,
      },
    })
  }

  const now = Date.now()
  // Criadores fixos no topo (premium e admin) pra demo enxergar os próprios.
  const spotCreators = [
    premiumDemo,
    adminDemo,
    ...sample(randomUsers, SPOTS.length),
  ]

  for (let s = 0; s < SPOTS.length; s++) {
    const def = SPOTS[s]
    const creator = spotCreators[s] ?? pick(users)
    const members = sample(
      users.filter((u) => u.id !== creator.id),
      faker.number.int({ min: 0, max: 4 }),
    )
    // Janelas variadas pra exercitar mapa, upcoming, lifecycle e privacidade.
    let startsAt = new Date(now - HOUR)
    let endsAt = new Date(now + faker.number.int({ min: 3, max: 8 }) * HOUR)
    let visibility: SpotVisibility = 'PUBLIC'
    if (s === 0) {
      endsAt = new Date(now + 40 * 60_000) // vencendo em ~40min → lembrete de renovação
    } else if (s === 1) {
      startsAt = new Date(now + 2 * HOUR) // ainda não começou (upcoming)
      endsAt = new Date(now + 5 * HOUR)
    } else if (s === 2) {
      visibility = 'FRIENDS' // restrito a amigos do criador
    }
    await seedSpot({
      creator,
      title: def.title,
      categories: def.categories,
      visibility,
      members,
      startsAt,
      endsAt,
    })
  }
  console.log(`   ✓ ${spotCount} spots (1 vencendo, 1 upcoming, 1 privado)`)

  // ── 13. Denúncias (moderação) ────────────────────────────────────────────────
  // Cobre os 5 alvos (evento, post, comentário, mensagem, usuário) e os estados
  // PENDING → REVIEWED → RESOLVED_*. admin_demo aparece como revisor.
  console.log('🚩 Criando denúncias...')

  const commentsForReports = await prisma.comment.findMany({
    take: 4,
    select: { id: true, authorId: true },
  })
  const messagesForReports = await prisma.message.findMany({
    take: 2,
    select: { id: true, senderId: true },
  })

  // Reporter aleatório distinto do dono do conteúdo (não se denuncia a si mesmo).
  function reporterExcept(excludeId: string) {
    return pick(randomUsers.filter((u) => u.id !== excludeId))
  }

  type ReportSpec = {
    reporterId: string
    reason: (typeof REPORT_REASONS)[number]
    status: 'PENDING' | 'REVIEWED' | 'RESOLVED_INVALID' | 'RESOLVED_REMOVED'
    eventId?: string
    postId?: string
    commentId?: string
    messageId?: string
    targetUserId?: string
    reviewerId?: string
    resolutionNote?: string
    resolvedAt?: Date
  }

  const reportSpecs: ReportSpec[] = []

  if (publicEvents[0]) {
    reportSpecs.push({
      reporterId: reporterExcept(publicEvents[0].authorId).id,
      reason: 'SPAM_OR_FRAUD',
      status: 'PENDING',
      eventId: publicEvents[0].id,
    })
  }
  if (posts[0]) {
    reportSpecs.push({
      reporterId: reporterExcept(posts[0].authorId).id,
      reason: 'INAPPROPRIATE_CONTENT',
      status: 'PENDING',
      postId: posts[0].id,
    })
  }
  if (commentsForReports[0]) {
    reportSpecs.push({
      reporterId: reporterExcept(commentsForReports[0].authorId).id,
      reason: 'HARASSMENT',
      status: 'REVIEWED',
      commentId: commentsForReports[0].id,
      reviewerId: adminDemo.id,
    })
  }
  if (messagesForReports[0]) {
    reportSpecs.push({
      reporterId: reporterExcept(messagesForReports[0].senderId).id,
      reason: 'HATE_SPEECH',
      status: 'RESOLVED_REMOVED',
      messageId: messagesForReports[0].id,
      reviewerId: adminDemo.id,
      resolutionNote: 'Mensagem removida por violar as diretrizes.',
      resolvedAt: new Date(nowMs - 2 * HOUR_MS),
    })
  }
  // Duas denúncias de usuário (uma resolvida-inválida, uma pendente).
  const reportedUserA = randomUsers[randomUsers.length - 1]
  const reportedUserB = randomUsers[randomUsers.length - 2]
  if (reportedUserA) {
    reportSpecs.push({
      reporterId: reporterExcept(reportedUserA.id).id,
      reason: 'OTHER',
      status: 'RESOLVED_INVALID',
      targetUserId: reportedUserA.id,
      reviewerId: adminDemo.id,
      resolutionNote: 'Denúncia improcedente após análise.',
      resolvedAt: new Date(nowMs - 5 * HOUR_MS),
    })
  }
  if (reportedUserB) {
    reportSpecs.push({
      reporterId: reporterExcept(reportedUserB.id).id,
      reason: 'HARASSMENT',
      status: 'PENDING',
      targetUserId: reportedUserB.id,
    })
  }

  for (const spec of reportSpecs) {
    await prisma.report.create({
      data: { ...spec, details: REPORT_DETAILS[spec.reason] },
    })
  }
  console.log(`   ✓ ${reportSpecs.length} denúncias (pendentes + resolvidas)`)

  // ── 14. Bloqueios ────────────────────────────────────────────────────────────
  console.log('🚫 Criando bloqueios...')

  const blockPairs: Array<{ blockerId: string; blockedId: string }> = []
  const blockSeen = new Set<string>()
  for (let b = 0; b < 5; b++) {
    const [blocker, blocked] = sample(randomUsers, 2)
    if (!blocker || !blocked || blocker.id === blocked.id) continue
    const key = `${blocker.id}:${blocked.id}`
    if (blockSeen.has(key)) continue
    blockSeen.add(key)
    blockPairs.push({ blockerId: blocker.id, blockedId: blocked.id })
  }
  await prisma.block.createMany({ data: blockPairs, skipDuplicates: true })
  console.log(`   ✓ ${blockPairs.length} bloqueios`)

  // ── 15. Notificações (central in-app + push) ─────────────────────────────────
  // Tokens de push (Expo) e uma caixa de notificações pro premium_demo com
  // não-lidas (exercita o badge), além de algumas pra usuários aleatórios.
  console.log('🔔 Criando notificações e device tokens...')

  const deviceTokenUsers = [premiumDemo, adminDemo, ...sample(randomUsers, 6)]
  const deviceTokens = deviceTokenUsers.map((u, i) => ({
    userId: u.id,
    token: `ExponentPushToken[seed-${i}-${u.username}]`,
    platform: i % 2 === 0 ? 'ios' : 'android',
    // um token soft-disabled pra exercitar o estado invalidado
    ...(i === deviceTokenUsers.length - 1
      ? {
          invalidatedAt: new Date(nowMs - 24 * HOUR_MS),
          invalidatedReason: 'DeviceNotRegistered',
        }
      : {}),
  }))
  await prisma.deviceToken.createMany({ data: deviceTokens })

  // Alvos reais pros deep-links das notificações. eventId/postId/commentId/
  // spotId não têm FK no schema, mas usamos ids existentes pra o app conseguir
  // navegar pro destino ao tocar na notificação.
  const allComments = await prisma.comment.findMany({
    select: { id: true, authorId: true },
  })
  const allSpots = await prisma.spot.findMany({
    select: { id: true, creatorId: true, title: true },
  })

  // Todos os 14 tipos que o app entrega hoje. Cada usuário recebe um de cada,
  // pra exercitar a aba de notificações inteira no mobile (badge, lidas/não,
  // avatar do ator, deep-link por tipo).
  const NOTIF_TYPES: NotificationType[] = [
    'NEW_FOLLOWER',
    'FOLLOW_REQUEST',
    'FOLLOW_ACCEPTED',
    'EVENT_INVITE',
    'EVENT_COMMENT',
    'EVENT_REACTION',
    'EVENT_ATTENDANCE',
    'POST_COMMENT',
    'POST_REACTION',
    'COMMENT_REACTION',
    'EVENT_NEARBY',
    'SPOT_NEARBY',
    'SPOT_JOIN',
    'SPOT_RENEWAL',
  ]

  // Prefere um alvo do próprio recipient (a copy fala do "seu evento/post/…");
  // sem nenhum dele, cai em qualquer um do pool. Retorna undefined se vazio.
  function ownOrAny<T>(pool: T[], isOwn: (x: T) => boolean): T | undefined {
    if (pool.length === 0) return undefined
    const own = pool.filter(isOwn)
    return own.length ? pick(own) : pick(pool)
  }

  const notifications: Prisma.NotificationCreateManyInput[] = []
  let notifSeq = 0
  for (const recipient of users) {
    for (const type of NOTIF_TYPES) {
      // Ator: qualquer outro usuário. Proximidade/renovação não têm ator.
      const actor = pick(randomUsers.filter((u) => u.id !== recipient.id))
      const who = [actor.name, actor.lastname].filter(Boolean).join(' ')
      const actorData = {
        id: actor.id,
        name: actor.name,
        lastname: actor.lastname,
        username: actor.username,
        avatarUrl: actor.avatarUrl,
      }

      let actorId: string | null = actor.id
      let eventId: string | null = null
      let postId: string | null = null
      let commentId: string | null = null
      let spotId: string | null = null
      let title: string
      let body: string
      // Sociais carregam data.actor (avatar + nome); proximidade/spot espelham
      // o payload de produção (só ids do alvo).
      let data: Prisma.InputJsonValue = { actor: actorData }

      switch (type) {
        case 'EVENT_INVITE': {
          // Convite pra evento de outra pessoa — qualquer evento do pool.
          eventId = pick(events).id
          ;({ title, body } = notificationCopy(type, who))
          break
        }
        case 'EVENT_COMMENT':
        case 'EVENT_REACTION':
        case 'EVENT_ATTENDANCE': {
          eventId =
            ownOrAny(events, (e) => e.authorId === recipient.id)?.id ?? null
          ;({ title, body } = notificationCopy(type, who))
          break
        }
        case 'POST_COMMENT':
        case 'POST_REACTION': {
          postId =
            ownOrAny(posts, (p) => p.authorId === recipient.id)?.id ?? null
          ;({ title, body } = notificationCopy(type, who))
          break
        }
        case 'COMMENT_REACTION': {
          commentId =
            ownOrAny(allComments, (c) => c.authorId === recipient.id)?.id ??
            null
          ;({ title, body } = notificationCopy(type, who))
          break
        }
        case 'EVENT_NEARBY': {
          const ev = pick(events)
          eventId = ev.id
          actorId = null
          title = 'Tem evento perto de você'
          body = ev.title
          data = { eventId: ev.id }
          break
        }
        case 'SPOT_NEARBY': {
          const sp = pick(allSpots)
          spotId = sp.id
          actorId = null
          title = 'Tem rolê perto de você'
          body = sp.title
          data = { spotId: sp.id }
          break
        }
        case 'SPOT_JOIN': {
          const sp =
            ownOrAny(allSpots, (s) => s.creatorId === recipient.id) ??
            pick(allSpots)
          spotId = sp.id
          title = 'Novo membro no rolê'
          body = `${who} entrou em "${sp.title}"`
          data = { spotId: sp.id, actorId: actor.id }
          break
        }
        case 'SPOT_RENEWAL': {
          const sp =
            ownOrAny(allSpots, (s) => s.creatorId === recipient.id) ??
            pick(allSpots)
          spotId = sp.id
          actorId = null
          title = 'Seu rolê está acabando'
          body = `"${sp.title}" expira em breve — renove por mais 24h`
          data = { spotId: sp.id }
          break
        }
        default: {
          // Sociais sem alvo: NEW_FOLLOWER, FOLLOW_REQUEST, FOLLOW_ACCEPTED.
          ;({ title, body } = notificationCopy(type, who))
        }
      }

      // Escalona nas últimas ~72h; lidas têm readAt DEPOIS do createdAt (e nunca
      // no futuro) — caixa realista de lidas/não-lidas, sem ler antes de criar.
      const createdAt = new Date(
        nowMs - faker.number.int({ min: 5, max: 72 * 60 }) * 60_000,
      )
      const readAt = faker.datatype.boolean()
        ? new Date(
            Math.min(
              createdAt.getTime() +
                faker.number.int({ min: 1, max: 90 }) * 60_000,
              nowMs,
            ),
          )
        : null

      const target = eventId ?? postId ?? commentId ?? spotId ?? 'social'
      notifications.push({
        userId: recipient.id,
        type,
        actorId,
        eventId,
        postId,
        commentId,
        spotId,
        title,
        body,
        data,
        // notifSeq garante unicidade global do (userId, dedupeKey).
        dedupeKey: `${type}:${actorId ?? 'sys'}:${target}:${notifSeq++}`,
        createdAt,
        readAt,
      })
    }
  }

  await prisma.notification.createMany({ data: notifications })
  const unreadCount = notifications.filter((n) => n.readAt === null).length
  console.log(
    `   ✓ ${deviceTokens.length} device tokens, ${notifications.length} notificações ` +
      `(${unreadCount} não-lidas) — ${NOTIF_TYPES.length} tipos × ${users.length} usuários`,
  )

  // ── 16. Consentimento LGPD (granular + auditoria) ────────────────────────────
  // Cada usuário tem um UserConsent + log GRANTED. premium/admin aceitam tudo;
  // alguns usuários revogam (REVOKED) ou ajustam (UPDATED) — alimenta a auditoria.
  console.log('🔐 Criando consentimentos LGPD...')

  const consentRows: Prisma.UserConsentCreateManyInput[] = []
  const consentLogs: Prisma.ConsentAuditLogCreateManyInput[] = []

  users.forEach((u, i) => {
    const isFixedFull = u.id === premiumDemo.id || u.id === adminDemo.id
    const accepted = isFixedFull
      ? [...CONSENT_FIELDS]
      : sample(CONSENT_FIELDS, faker.number.int({ min: 2, max: 6 }))
    const revoked = !isFixedFull && i % 6 === 0 // ~1 em 6 revoga
    const updated = !isFixedFull && !revoked && i % 5 === 0 // ~alguns ajustam

    // Revogado zera os granulares; do contrário vale o subconjunto aceito.
    const on = (field: (typeof CONSENT_FIELDS)[number]) =>
      !revoked && accepted.includes(field)

    consentRows.push({
      userId: u.id,
      essentialAccepted: true,
      locationPrecise: on('locationPrecise'),
      socialFeed: on('socialFeed'),
      socialVisibility: on('socialVisibility'),
      pushNotifications: on('pushNotifications'),
      marketing: on('marketing'),
      analytics: on('analytics'),
      surveys: on('surveys'),
      consentVersion: '1.0',
      ipAddress: faker.internet.ipv4(),
      userAgent: 'ConectAI/1.0 (seed)',
      ...(revoked ? { revokedAt: new Date(nowMs - 3 * HOUR_MS) } : {}),
    })

    // Log inicial GRANTED (com o que foi aceito na criação).
    consentLogs.push({
      userId: u.id,
      action: 'GRANTED',
      changedFields: accepted.map((f) => ({ field: f, from: null, to: true })),
      consentVersion: '1.0',
      ipAddress: faker.internet.ipv4(),
      userAgent: 'ConectAI/1.0 (seed)',
    })
    if (updated) {
      consentLogs.push({
        userId: u.id,
        action: 'UPDATED',
        changedFields: [{ field: 'marketing', from: true, to: false }],
        consentVersion: '1.0',
        ipAddress: faker.internet.ipv4(),
        userAgent: 'ConectAI/1.0 (seed)',
      })
    }
    if (revoked) {
      consentLogs.push({
        userId: u.id,
        action: 'REVOKED',
        changedFields: accepted.map((f) => ({
          field: f,
          from: true,
          to: false,
        })),
        consentVersion: '1.0',
        ipAddress: faker.internet.ipv4(),
        userAgent: 'ConectAI/1.0 (seed)',
      })
    }
  })

  await prisma.userConsent.createMany({ data: consentRows })
  await prisma.consentAuditLog.createMany({ data: consentLogs })
  console.log(
    `   ✓ ${consentRows.length} consentimentos, ${consentLogs.length} logs de auditoria`,
  )

  // ── Resumo ───────────────────────────────────────────────────────────────────
  const featuredCount = promotionUsage.reduce((s, u) => s + u.count, 0)

  console.log('\n✅ Seed concluído!')
  console.log(`   👤 Usuários:      ${users.length}`)
  console.log(`   🔗 Follows:       ${follows.length}`)
  console.log(`   📅 Eventos:       ${events.length}`)
  console.log(`   ⭐ Destaques:     ${featuredCount}`)
  console.log(`   ✅ Presenças:     ${attendancesToCreate.length}`)
  console.log(`   📝 Posts:         ${posts.length}`)
  console.log(
    `   🖼️  Imagens:       ${eventImages.length} eventos / ${postImageCount} posts`,
  )
  console.log(`   💬 Conversas:     ${conversationCount}`)
  console.log(`   ✉️  Mensagens:     ${messageCount}`)
  console.log(`   📍 Spots:         ${spotCount}`)
  console.log(`   🚩 Denúncias:     ${reportSpecs.length}`)
  console.log(`   🚫 Bloqueios:     ${blockPairs.length}`)
  console.log(`   🔔 Notificações:  ${notifications.length}`)
  console.log(`   🔐 Consentimentos: ${consentRows.length}`)
  console.log('\n   🔑 Senha de todos os usuários: senha123')
  console.log('   📋 Usuários criados:')
  for (const u of users.slice(0, 5))
    console.log(`      ${u.email} (${u.username})`)
  if (users.length > 5) console.log(`      ... e mais ${users.length - 5}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
