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
      schema: { params: conversationParamSchema },
      onRequest: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    postMessageImage,
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
