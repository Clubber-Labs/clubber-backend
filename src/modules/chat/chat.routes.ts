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
  postMessageVideo,
  postParticipant,
  postRead,
  postVideoUploadSignature,
} from './chat.controller'
import {
  addParticipantSchema,
  conversationParamSchema,
  createConversationSchema,
  createVideoMessageSchema,
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
          '- `image` (arquivo, obrigatório): JPEG, PNG ou WebP. Máx. 5 MB.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'IMAGE', url, format, size, width, height, durationMs: null, waveform: [], order }`.",
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
    '/conversations/:id/messages/video/signature',
    {
      schema: {
        params: conversationParamSchema,
        tags: ['chat'],
        summary: 'Assinar upload direto de vídeo',
        description: [
          'Retorna credenciais assinadas para o cliente subir o vídeo **direto ao Cloudinary** (o arquivo não passa pelo backend).',
          '',
          '**Fluxo (3 passos):**',
          '1. `POST` aqui → recebe `{ signature, timestamp, apiKey, cloudName, folder, resourceType, type }`.',
          '2. O cliente faz `POST` em `https://api.cloudinary.com/v1_1/{cloudName}/video/upload` com `file`, `api_key`, `timestamp`, `folder`, `type` e `signature`. O `type` (`authenticated`) é assinado junto com `folder`/`timestamp` — **precisa ser reenviado no form**, senão o Cloudinary recompõe a string sem ele e devolve `Invalid Signature`. O Cloudinary responde com `public_id`.',
          '3. O cliente chama `POST /conversations/:id/messages/video` com `{ publicId }`.',
          '',
          'A `folder` é travada em `conversations/:id` — o cliente não a escolhe.',
          '',
          '**Erros:** `401`, `403` (não participa / bloqueado), `404` (conversa inexistente), `501` (storage local sem Cloudinary).',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    postVideoUploadSignature,
  )

  api.post(
    '/conversations/:id/messages/video',
    {
      schema: {
        params: conversationParamSchema,
        body: createVideoMessageSchema,
        tags: ['chat'],
        summary: 'Criar mensagem de vídeo (a partir do upload direto)',
        description: [
          'Cria a mensagem de vídeo a partir do `publicId` que o cliente subiu direto ao Cloudinary (ver `/messages/video/signature`).',
          '',
          '**Body:** `{ "publicId": "conversations/<id>/<asset>" }`.',
          '',
          'O backend **verifica o asset no Cloudinary** (fonte da verdade): exige que esteja na pasta desta conversa, valida o formato (MP4/MOV/WebM) e o tamanho (máx. 50 MB), e lê duração/dimensões/tamanho reais do provider — não confia em valores enviados pelo cliente.',
          '',
          "**Resposta 201:** a mensagem criada, com `content: null` e `attachments[0]` = `{ kind: 'VIDEO', url, format, size, durationMs, width, height, waveform: [], order }`.",
          '',
          '**Erros:** `400` (asset inexistente / formato inválido), `401`, `403` (não participa / bloqueado / vídeo de outra conversa), `404` (conversa inexistente), `413` (vídeo acima de 50 MB).',
        ].join('\n'),
      },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
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
