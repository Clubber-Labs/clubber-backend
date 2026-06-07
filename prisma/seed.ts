import { faker } from '@faker-js/faker/locale/pt_BR'
import {
  AttendanceType,
  FollowStatus,
  PrismaClient,
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
    'Show da Banda Lua Cheia',
    'Noite de MPB no Bar do Zé',
    'Festival de Rock Curitiba',
    'Sarau de Jazz ao Vivo',
    'Tributo ao Legião Urbana',
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
    'Oficina de Cerâmica',
    'Vernissage na Galeria do Largo',
    'Mostra de Arte Independente',
    'Workshop de Aquarela',
  ],
  GASTRONOMY: [
    'Festival de Food Trucks',
    'Jantar Harmonizado com Vinhos',
    'Feira Gastronômica do Largo',
    'Aula de Massas Italianas',
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
    'Balada Eletrônica no Centro',
    'Quinta do Sertanejo',
    'Karaokê Night',
    'Happy Hour Prolongado',
    'Festa Open Bar',
  ],
  EDUCATION: [
    'Palestra sobre Finanças Pessoais',
    'Curso de Fotografia para Iniciantes',
    'Roda de Conversa sobre Carreira',
    'Workshop de Oratória',
    'Clube do Livro',
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

// ─── seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Limpando banco...')
  await prisma.report.deleteMany()
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
    },
  })

  const usersData = Array.from({ length: 12 }).map((_, i) => {
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
      const category = pick(CATEGORIES)
      return {
        title: pick(EVENT_TITLES[category]),
        description: pick(EVENT_DESCRIPTIONS),
        date: faker.date.soon({ days: 30 }),
        ...curitibaCoords(),
        category,
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

  // ── Resumo ───────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed concluído!')
  console.log(`   👤 Usuários:    ${users.length}`)
  console.log(`   🔗 Follows:     ${follows.length}`)
  console.log(`   📅 Eventos:     ${events.length}`)
  console.log(`   ✅ Presenças:   ${attendancesToCreate.length}`)
  console.log(`   📝 Posts:       ${posts.length}`)
  console.log(`   💬 Conversas:   ${conversationCount}`)
  console.log(`   ✉️  Mensagens:   ${messageCount}`)
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
