import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import {
  deleteConversation,
  deleteMessageHandler,
  deleteMessageReaction,
  deleteParticipant,
  getConversationDetail,
  getConversations,
  getMessages,
  patchConversation,
  patchMessage,
  patchParticipantRole,
  postConversation,
  postDelivered,
  postLeave,
  postMessage,
  postMessageAudio,
  postMessageImage,
  postMessageReaction,
  postParticipant,
  postRead,
} from './chat.controller'
import {
  addParticipantSchema,
  conversationParamSchema,
  createConversationSchema,
  editMessageSchema,
  messageParamSchema,
  messageReactionSchema,
  paginationSchema,
  participantParamSchema,
  renameConversationSchema,
  sendMessageSchema,
  setRoleSchema,
} from './chat.schema'

export async function chatRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const api = app.withTypeProvider<ZodTypeProvider>()

  api.post(
    '/conversations',
    {
      schema: { body: createConversationSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    postConversation,
  )

  api.get(
    '/conversations',
    {
      schema: { querystring: paginationSchema },
      onRequest: [app.authenticate],
    },
    getConversations,
  )

  api.get(
    '/conversations/:id',
    {
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
    },
    getConversationDetail,
  )

  api.patch(
    '/conversations/:id',
    {
      schema: {
        params: conversationParamSchema,
        body: renameConversationSchema,
      },
      onRequest: [app.authenticate],
    },
    patchConversation,
  )

  api.delete(
    '/conversations/:id',
    {
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
    },
    deleteConversation,
  )

  api.get(
    '/conversations/:id/messages',
    {
      schema: {
        params: conversationParamSchema,
        querystring: paginationSchema,
      },
      onRequest: [app.authenticate],
    },
    getMessages,
  )

  api.post(
    '/conversations/:id/messages',
    {
      schema: { params: conversationParamSchema, body: sendMessageSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    postMessage,
  )

  api.post(
    '/conversations/:id/messages/images',
    {
      schema: {
        params: conversationParamSchema,
        tags: ['chat'],
        summary: 'Enviar mensagem de imagem',
        description: [
          'Cria uma mensagem de imagem na conversa via `multipart/form-data`.',
          '',
          '**Campo do form:**',
          '- `image` (arquivo, obrigatório): JPEG, PNG, WebP ou GIF. Máx. 5 MB.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'IMAGE', url, format, size, durationMs: null, waveform: [], order }`.",
          '',
          '**Erros:** `400` (sem arquivo / mimetype inválido), `401`, `403` (não participa da conversa / bloqueado), `404`.',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    postMessageImage,
  )

  api.post(
    '/conversations/:id/messages/audio',
    {
      schema: {
        params: conversationParamSchema,
        tags: ['chat'],
        summary: 'Enviar mensagem de áudio (nota de voz)',
        description: [
          'Cria uma mensagem de áudio na conversa via `multipart/form-data`.',
          '',
          '**Campos do form (os de texto ANTES do arquivo):**',
          '- `durationMs` (texto, obrigatório): duração em ms, inteiro `1..600000`.',
          '- `waveform` (texto, opcional): array JSON de inteiros `0..255` (máx. 512). Ex.: `[3,7,12,9,4]`.',
          '- `audio` (arquivo, obrigatório): container m4a/AAC. Mimetypes aceitos: `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/aac`. Máx. 5 MB.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'AUDIO', url, format, size, durationMs, waveform, order }`.",
          '',
          '**Erros:** `400` (sem arquivo / mimetype inválido / sem `durationMs` / `waveform` JSON inválido), `401`, `403` (não participa da conversa / bloqueado), `404`.',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    postMessageAudio,
  )

  api.post(
    '/conversations/:id/read',
    {
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
    },
    postRead,
  )

  api.post(
    '/conversations/:id/delivered',
    {
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
    },
    postDelivered,
  )

  api.patch(
    '/conversations/:id/messages/:messageId',
    {
      schema: { params: messageParamSchema, body: editMessageSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    patchMessage,
  )

  api.delete(
    '/conversations/:id/messages/:messageId',
    {
      schema: { params: messageParamSchema },
      onRequest: [app.authenticate],
    },
    deleteMessageHandler,
  )

  api.post(
    '/conversations/:id/messages/:messageId/reactions',
    {
      schema: { params: messageParamSchema, body: messageReactionSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    postMessageReaction,
  )

  api.delete(
    '/conversations/:id/messages/:messageId/reactions',
    {
      schema: { params: messageParamSchema, body: messageReactionSchema },
      onRequest: [app.authenticate],
    },
    deleteMessageReaction,
  )

  api.post(
    '/conversations/:id/leave',
    {
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
    },
    postLeave,
  )

  api.post(
    '/conversations/:id/participants',
    {
      schema: { params: conversationParamSchema, body: addParticipantSchema },
      onRequest: [app.authenticate],
    },
    postParticipant,
  )

  api.delete(
    '/conversations/:id/participants/:userId',
    {
      schema: { params: participantParamSchema },
      onRequest: [app.authenticate],
    },
    deleteParticipant,
  )

  api.patch(
    '/conversations/:id/participants/:userId',
    {
      schema: { params: participantParamSchema, body: setRoleSchema },
      onRequest: [app.authenticate],
    },
    patchParticipantRole,
  )
}
