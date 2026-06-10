import type { NotificationType } from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { realtime } from '../../lib/realtime'
import {
  makeBlock,
  makeComment,
  makeEvent,
  makePost,
  makeUser,
} from '../../test/factories'
import { testPrisma } from '../../test/prisma'
import { confirmAttendance } from '../attendance/attendance.service'
import {
  addCommentToEvent,
  addCommentToPost,
} from '../comments/comments.service'
import { inviteToEvent } from '../event-invites/event-invites.service'
import {
  approveFollowRequest,
  followUser,
  rejectFollowRequest,
  unfollowUser,
} from '../follows/follows.service'
import {
  likeComment,
  likeEvent,
  likePost,
} from '../reactions/reactions.service'

function notifFor(userId: string, type: NotificationType) {
  return testPrisma.notification.findFirst({ where: { userId, type } })
}

beforeEach(() => {
  // Isola do Redis e evita ruído; as asserções olham as linhas persistidas.
  vi.spyOn(realtime, 'publishNotification').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  await testPrisma.$disconnect()
})

describe('gatilhos de follow', () => {
  it('seguir perfil público notifica NEW_FOLLOWER', async () => {
    const [follower, target] = await Promise.all([
      makeUser(),
      makeUser({ isPrivate: false }),
    ])
    await followUser(follower.id, target.id)

    const n = await notifFor(target.id, 'NEW_FOLLOWER')
    expect(n).not.toBeNull()
    expect(n?.actorId).toBe(follower.id)
    expect(n?.body).toContain(follower.name)
  })

  it('seguir perfil privado notifica FOLLOW_REQUEST', async () => {
    const [follower, target] = await Promise.all([
      makeUser(),
      makeUser({ isPrivate: true }),
    ])
    await followUser(follower.id, target.id)

    expect(await notifFor(target.id, 'FOLLOW_REQUEST')).not.toBeNull()
    expect(await notifFor(target.id, 'NEW_FOLLOWER')).toBeNull()
  })

  it('aprovar solicitação notifica FOLLOW_ACCEPTED o solicitante', async () => {
    const [requester, owner] = await Promise.all([
      makeUser(),
      makeUser({ isPrivate: true }),
    ])
    await followUser(requester.id, owner.id) // cria PENDING
    await approveFollowRequest(owner.id, requester.id)

    const n = await notifFor(requester.id, 'FOLLOW_ACCEPTED')
    expect(n).not.toBeNull()
    expect(n?.actorId).toBe(owner.id)
  })

  it('unfollow→refollow volta a notificar (limpa o dedupe)', async () => {
    const [follower, target] = await Promise.all([
      makeUser(),
      makeUser({ isPrivate: false }),
    ])
    await followUser(follower.id, target.id)
    expect(await notifFor(target.id, 'NEW_FOLLOWER')).not.toBeNull()

    await unfollowUser(follower.id, target.id)
    expect(await notifFor(target.id, 'NEW_FOLLOWER')).toBeNull() // limpou

    await followUser(follower.id, target.id)
    expect(await notifFor(target.id, 'NEW_FOLLOWER')).not.toBeNull() // re-notifica
  })

  it('rejeitar solicitação limpa a notificação FOLLOW_REQUEST', async () => {
    const [requester, owner] = await Promise.all([
      makeUser(),
      makeUser({ isPrivate: true }),
    ])
    await followUser(requester.id, owner.id)
    expect(await notifFor(owner.id, 'FOLLOW_REQUEST')).not.toBeNull()

    await rejectFollowRequest(owner.id, requester.id)
    expect(await notifFor(owner.id, 'FOLLOW_REQUEST')).toBeNull()
  })
})

describe('gatilhos de comentário', () => {
  it('comentar em evento notifica o autor (EVENT_COMMENT)', async () => {
    const [author, commenter] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })

    await addCommentToEvent(commenter.id, event.id, { content: 'Top!' })

    const n = await notifFor(author.id, 'EVENT_COMMENT')
    expect(n).not.toBeNull()
    expect(n?.eventId).toBe(event.id)
    expect(n?.body).toContain(commenter.name)
  })

  it('comentar no próprio evento NÃO notifica (self-guard)', async () => {
    const author = await makeUser()
    const event = await makeEvent(author.id, { isPublic: true })

    await addCommentToEvent(author.id, event.id, { content: 'meu' })

    expect(await notifFor(author.id, 'EVENT_COMMENT')).toBeNull()
  })

  it('comentário de usuário bloqueado NÃO notifica (block-guard)', async () => {
    const [author, commenter] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })
    await makeBlock(author.id, commenter.id)

    await addCommentToEvent(commenter.id, event.id, { content: 'oi' })

    expect(await notifFor(author.id, 'EVENT_COMMENT')).toBeNull()
  })

  it('comentar em post notifica o autor (POST_COMMENT)', async () => {
    const [author, commenter] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })
    const post = await makePost(author.id, event.id)

    await addCommentToPost(commenter.id, post.id, { content: 'legal' })

    const n = await notifFor(author.id, 'POST_COMMENT')
    expect(n).not.toBeNull()
    expect(n?.postId).toBe(post.id)
    // eventId junto: o deep-link do app abre o evento que contém o post.
    expect(n?.eventId).toBe(event.id)
  })
})

describe('gatilhos de reação', () => {
  it('curtir evento notifica o autor (EVENT_REACTION)', async () => {
    const [author, liker] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })

    await likeEvent(liker.id, event.id)

    const n = await notifFor(author.id, 'EVENT_REACTION')
    expect(n).not.toBeNull()
    expect(n?.actorId).toBe(liker.id)
  })

  it('curtir post notifica o autor do post (POST_REACTION)', async () => {
    const [author, liker] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })
    const post = await makePost(author.id, event.id)

    await likePost(liker.id, post.id)

    const n = await notifFor(author.id, 'POST_REACTION')
    expect(n).not.toBeNull()
    expect(n?.postId).toBe(post.id)
    expect(n?.actorId).toBe(liker.id)
    expect(n?.eventId).toBe(event.id)
  })

  it('curtir comentário notifica o autor do comentário (COMMENT_REACTION)', async () => {
    const [commentAuthor, liker] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(commentAuthor.id, { isPublic: true })
    const comment = await makeComment(commentAuthor.id, event.id)

    await likeComment(liker.id, comment.id)

    const n = await notifFor(commentAuthor.id, 'COMMENT_REACTION')
    expect(n).not.toBeNull()
    expect(n?.commentId).toBe(comment.id)
    expect(n?.eventId).toBe(event.id)
  })
})

describe('gatilho de presença', () => {
  it('confirmar presença notifica o autor (EVENT_ATTENDANCE)', async () => {
    const [author, attendee] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })

    await confirmAttendance(attendee.id, event.id, 'CONFIRMED')

    expect(await notifFor(author.id, 'EVENT_ATTENDANCE')).not.toBeNull()
  })

  it('NOT_INTERESTED não notifica', async () => {
    const [author, attendee] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(author.id, { isPublic: true })

    await confirmAttendance(attendee.id, event.id, 'NOT_INTERESTED')

    expect(await notifFor(author.id, 'EVENT_ATTENDANCE')).toBeNull()
  })
})

describe('gatilho de convite', () => {
  it('convidar para evento privado notifica cada convidado (EVENT_INVITE)', async () => {
    const inviter = await makeUser()
    const [a, b] = await Promise.all([makeUser(), makeUser()])
    const event = await makeEvent(inviter.id, { isPublic: false })

    await inviteToEvent(event.id, inviter.id, { userIds: [a.id, b.id] })

    expect(await notifFor(a.id, 'EVENT_INVITE')).not.toBeNull()
    expect(await notifFor(b.id, 'EVENT_INVITE')).not.toBeNull()
  })
})
