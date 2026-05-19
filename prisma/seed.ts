import { faker } from '@faker-js/faker/locale/pt_BR'
import {
  AttendanceType,
  FollowStatus,
  PrismaClient,
  ReactionType,
} from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ─── helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function sample<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

const PASSWORD_HASH = bcrypt.hashSync('senha123', 10)

const CATEGORIES = [
  'Festa',
  'Show',
  'Esporte',
  'Cultura',
  'Gastronomia',
  'Tecnologia',
  'Arte',
  'Balada',
]

const REACTION_TYPES = Object.values(ReactionType)
const ATTENDANCE_TYPES = [AttendanceType.CONFIRMED, AttendanceType.INTERESTED]

// ─── seed ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Limpando banco...')
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
      bio: i % 3 === 0 ? faker.lorem.sentence() : null,
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
  const users = [premiumDemo, ...randomUsers]

  console.log(`   ✓ ${users.length} usuários criados (1 premium fixo)`)
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
    Array.from({ length: faker.number.int({ min: 1, max: 3 }) }).map(
      (_, j) => ({
        title: faker.lorem.words({ min: 2, max: 5 }),
        description: faker.lorem.paragraph(),
        date: faker.date.soon({ days: 30 }),
        ...curitibaCoords(),
        category: pick(CATEGORIES),
        isPublic: !(i % 5 === 0 && j === 0), // ~20% privados
        authorId: author.id,
      }),
    ),
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
    type: ReactionType
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
          type: pick(REACTION_TYPES),
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
        content: faker.lorem.sentences({ min: 1, max: 3 }),
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
            content: faker.lorem.sentences({ min: 1, max: 4 }),
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
      type: ReactionType
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
            type: pick(REACTION_TYPES),
          })
        }
      }

      const commenters = sample(users, faker.number.int({ min: 0, max: 3 }))
      for (const user of commenters) {
        postComments.push({
          authorId: user.id,
          postId: post.id,
          content: faker.lorem.sentence(),
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

  // ── Resumo ───────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed concluído!')
  console.log(`   👤 Usuários:    ${users.length}`)
  console.log(`   🔗 Follows:     ${follows.length}`)
  console.log(`   📅 Eventos:     ${events.length}`)
  console.log(`   ✅ Presenças:   ${attendancesToCreate.length}`)
  console.log(`   📝 Posts:       ${posts.length}`)
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
