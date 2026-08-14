import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { handlePrismaUniqueError } from './errors'

function uniqueViolation(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  })
}

describe('handlePrismaUniqueError', () => {
  it('traduz a violação de coluna única', () => {
    expect(handlePrismaUniqueError(uniqueViolation(['email']))).toEqual({
      statusCode: 409,
      message: 'Este e-mail já está cadastrado em outra conta.',
    })
  })

  // Corrida entre dois cadastros: quem perde recebe o P2002 do índice funcional
  // (users_*_lower_key), que chega como nome do índice em vez da coluna.
  it('traduz a violação dos índices funcionais da identidade', () => {
    const porNome = handlePrismaUniqueError(
      uniqueViolation('users_username_lower_key'),
    )
    expect(porNome?.message).toBe('Este nome de usuário já está em uso.')

    const porLista = handlePrismaUniqueError(
      uniqueViolation(['users_email_lower_key']),
    )
    expect(porLista?.message).toBe(
      'Este e-mail já está cadastrado em outra conta.',
    )
  })

  it('cai na mensagem genérica para constraint desconhecida', () => {
    expect(
      handlePrismaUniqueError(uniqueViolation(['stripeCustomerId'])),
    ).toEqual({
      statusCode: 409,
      message: 'Este dado já está em uso em outra conta.',
    })
  })

  it('ignora erro que não é violação de unique', () => {
    expect(handlePrismaUniqueError(new Error('qualquer'))).toBeNull()
  })
})
