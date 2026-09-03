import type { Principal } from "@graphrag/shared";
import { prisma } from "../db.js";
import { NotFoundError } from "../errors.js";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  citations?: unknown;
  graphEvidence?: unknown;
  retrievalMeta?: unknown;
  explanation?: unknown;
}

export async function getOrCreateConversation(
  principal: Principal & { companyId: string },
  conversationId?: string
) {
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, companyId: principal.companyId, userId: principal.userId },
      include: { messages: { orderBy: { createdAt: "asc" } } }
    });
    if (!conversation) throw new NotFoundError("Conversation not found");
    return conversation;
  }
  return prisma.conversation.create({
    data: {
      companyId: principal.companyId,
      userId: principal.userId,
      title: "New conversation"
    },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
}

export async function appendMessage(
  conversationId: string,
  companyId: string,
  message: ConversationMessage
) {
  return prisma.message.create({
    data: {
      conversationId,
      companyId,
      role: message.role,
      content: message.content,
      citations: (message.citations ?? null) as never,
      graphEvidence: (message.graphEvidence ?? null) as never,
      retrievalMeta: (message.retrievalMeta ?? null) as never,
      explanation: (message.explanation ?? null) as never
    }
  });
}

export async function listConversations(principal: Principal & { companyId: string }) {
  const conversations = await prisma.conversation.findMany({
    where: { companyId: principal.companyId, userId: principal.userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { messages: { orderBy: { createdAt: "asc" }, take: 2 } }
  });
  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    preview: c.messages[0]?.content.slice(0, 80) ?? ""
  }));
}

export async function getConversation(principal: Principal & { companyId: string }, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, companyId: principal.companyId, userId: principal.userId },
    include: { messages: { orderBy: { createdAt: "asc" } } }
  });
  if (!conversation) throw new NotFoundError("Conversation not found");
  return conversation;
}

export async function updateConversationTitle(conversationId: string, title: string) {
  return prisma.conversation.update({ where: { id: conversationId }, data: { title } });
}

/** Delete one user's private conversation (its messages cascade in the DB). */
export async function deleteConversation(principal: Principal & { companyId: string }, conversationId: string) {
  await getConversation(principal, conversationId);
  await prisma.conversation.delete({ where: { id: conversationId } });
}
