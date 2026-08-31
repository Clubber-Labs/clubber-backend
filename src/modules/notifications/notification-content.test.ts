import { NotificationType } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { renderNotificationContent } from './notification-content'

// Derivado do enum do Prisma: tipo novo entra na guarda sozinho, sem depender
// de alguém lembrar de estender uma lista aqui.
const ALL_TYPES = Object.values(NotificationType)

const actor = { name: 'Ana', lastname: 'Lima' }

describe('renderNotificationContent', () => {
  it('monta a copy social com o nome do autor no idioma pedido', () => {
    const pt = renderNotificationContent(
      { type: 'NEW_FOLLOWER', params: null, data: null },
      actor,
      'pt-BR',
    )
    expect(pt).toEqual({
      title: 'Novo seguidor',
      body: 'Ana Lima começou a te seguir',
    })

    const en = renderNotificationContent(
      { type: 'NEW_FOLLOWER', params: null, data: null },
      actor,
      'en',
    )
    expect(en).toEqual({
      title: 'New follower',
      body: 'Ana Lima started following you',
    })
  })

  it('interpola params de snapshot junto do autor', () => {
    const { body } = renderNotificationContent(
      { type: 'SPOT_JOIN', params: { spotTitle: 'Bar do Zé' }, data: null },
      actor,
      'es',
    )
    expect(body).toBe('Ana Lima se unió a "Bar do Zé"')
  })

  it('separa a copy de evento promovido da de evento novo', () => {
    const novo = renderNotificationContent(
      { type: 'EVENT_NEARBY', params: { eventTitle: 'Baile' }, data: null },
      null,
      'pt-BR',
    )
    const promovido = renderNotificationContent(
      {
        type: 'EVENT_NEARBY',
        params: { eventTitle: 'Baile', promoted: true },
        data: null,
      },
      null,
      'pt-BR',
    )
    expect(novo.title).toBe('Tem evento perto de você')
    expect(promovido.title).toBe('Em destaque perto de você')
    expect(promovido.body).toBe('Baile')
  })

  it('usa o snapshot em data.actor quando o autor não existe mais', () => {
    const { body } = renderNotificationContent(
      {
        type: 'POST_REACTION',
        params: null,
        data: { actor: { name: 'Bruno', lastname: 'Souza' } },
      },
      null,
      'pt-BR',
    )
    expect(body).toBe('Bruno Souza curtiu seu post')
  })

  it('cai no rótulo genérico quando não há autor nem snapshot', () => {
    const { body } = renderNotificationContent(
      { type: 'POST_REACTION', params: null, data: null },
      null,
      'en',
    )
    expect(body).toBe('Someone liked your post')
  })

  it('tem copy nos três idiomas para todo NotificationType', () => {
    for (const type of ALL_TYPES) {
      for (const locale of ['pt-BR', 'en', 'es'] as const) {
        const { title, body } = renderNotificationContent(
          {
            type,
            params: { eventTitle: 'Evento', spotTitle: 'Rolê' },
            data: null,
          },
          actor,
          locale,
        )
        // Chave sem tradução volta como a própria chave (translateWith) —
        // o ponto continua sinalizando copy faltando.
        expect(title).not.toContain('.')
        expect(title.length).toBeGreaterThan(0)
        expect(body).not.toContain('{{')
      }
    }
  })
})
