import type { FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { rateLimit } from '../../lib/rate-limit'
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
  postMessageVideo,
  postParticipant,
  postRead,
  postVideoUploadSignature,
} from './chat.controller'
import {
  addParticipantSchema,
  conversationParamSchema,
  createConversationSchema,
  createVideoSignatureSchema,
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
      config: { rateLimit: rateLimit(30) },
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
      config: { rateLimit: rateLimit(60) },
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
          '- `image` (arquivo, obrigatório): JPEG, PNG ou WebP. Máx. 5 MB.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'IMAGE', url, format, size, width, height, durationMs: null, waveform: [], order }`.",
          '',
          '**Erros:** `400` (sem arquivo / mimetype inválido), `401`, `403` (não participa da conversa / bloqueado), `404`.',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
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
      config: { rateLimit: rateLimit(30) },
    },
    postMessageAudio,
  )

  api.post(
    '/conversations/:id/messages/video/signature',
    {
      schema: {
        params: conversationParamSchema,
        body: createVideoSignatureSchema,
        tags: ['chat'],
        summary: 'Assinar upload direto de vídeo',
        description: [
          'Retorna credenciais assinadas para o cliente subir o vídeo **direto ao R2** via `PUT` (o arquivo não passa pelo backend).',
          '',
          '**Fluxo (3 passos):**',
          '1. `POST` aqui com `{ mimetype }` (`video/mp4`, `video/quicktime` ou `video/webm`) → recebe `{ uploadUrl, key, expiresAt }`. A `key` já vem travada em `conversations/:id/...` — o cliente não a escolhe. O `uploadUrl` (PUT) expira em 15 min.',
          '2. O cliente faz `PUT uploadUrl` com o binário do vídeo, usando o **MESMO** `Content-Type` enviado nesta assinatura — o header é assinado junto; divergir devolve `403` do R2.',
          '3. O cliente chama `POST /conversations/:id/messages/video` (multipart) com `{ key }` (e opcionalmente metadados/poster).',
          '',
          '**Erros:** `401`, `403` (não participa / bloqueado), `404` (conversa inexistente), `501` (storage local, sem R2).',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    postVideoUploadSignature,
  )

  api.post(
    '/conversations/:id/messages/video',
    {
      schema: {
        params: conversationParamSchema,
        tags: ['chat'],
        summary: 'Criar mensagem de vídeo (a partir do upload direto)',
        description: [
          'Cria a mensagem de vídeo a partir da `key` que o cliente subiu direto ao R2 (ver `/messages/video/signature`), via `multipart/form-data`.',
          '',
          '**Campos do form (texto):**',
          '- `key` (obrigatório): a mesma key devolvida pela assinatura.',
          '- `durationMs`, `width`, `height` (opcionais): declarados pelo cliente — cosméticos, o backend não os confirma no provider.',
          '',
          '**Campo do form (arquivo, opcional):**',
          '- `poster` (imagem JPEG/PNG/WebP, máx. 5 MB): processada pelo mesmo pipeline sharp da imagem de chat e sobe como objeto próprio (privado).',
          '',
          'O backend valida **server-side**: a `key` pertence a esta conversa (prefixo travado na assinatura), existe no R2, o formato real (magic bytes) é MP4/MOV/WebM, o tamanho é ≤ 50 MB, e a cota do usuário comporta o arquivo.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'VIDEO', url, format, size, durationMs, width, height, thumbnailUrl, waveform: [], order }`.",
          '',
          '**Erros:** `400` (key fora do padrão / vídeo inexistente no provedor / formato inválido), `401`, `403` (não participa / bloqueado / key de outra conversa), `404` (conversa inexistente), `413` (vídeo acima de 50 MB / cota excedida).',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: rateLimit(30) },
    },
    postMessageVideo,
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
      config: { rateLimit: rateLimit(60) },
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
      config: { rateLimit: rateLimit(120) },
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
