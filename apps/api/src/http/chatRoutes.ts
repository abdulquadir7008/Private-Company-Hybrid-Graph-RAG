import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler } from "../util/asyncHandler.js";
import { requireAuth, requireCompanyPrincipal } from "../access/middleware.js";
import { hybridRetrieve } from "../retrieval/hybrid.js";
import { generateGroundedAnswer } from "../answer/generate.js";
import { buildExplanation } from "../answer/explanation.js";
import { condenseQuestion } from "../conversations/condense.js";
import { getOrCreateConversation, appendMessage, listConversations, getConversation, updateConversationTitle } from "../conversations/repository.js";
import { Auditor } from "../audit/service.js";
import { ValidationError, NotFoundError } from "../errors.js";
import { uuid } from "../util/ids.js";

export const chatRoutes = Router();

const chatSchema = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  depth: z.coerce.number().int().min(1).max(5).optional()
});

chatRoutes.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Question is required", "question");
    const { question, conversationId, depth } = parsed.data;

    const start = performance.now();
    const conversation = await getOrCreateConversation(p, conversationId);
    const history = conversation.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Multi-turn: condense the follow-up into a self-contained question.
    const resolvedQuestion = await condenseQuestion(question, history);

    const hybrid = await hybridRetrieve({ principal: p, question: resolvedQuestion, depth });
    const grounded = await generateGroundedAnswer({ question: resolvedQuestion, hybrid, history });

    // Explainable RAG: build an ACL-aware trace from the SAME retrieval pass.
    // This performs no additional retrieval — it is a pure transform of the
    // authorized evidence the answer was already grounded on.
    const traceId = uuid();
    const explanation = buildExplanation({ traceId, question: resolvedQuestion, hybrid, grounded });

    const userMsg = await appendMessage(conversation.id, p.companyId, {
      role: "user",
      content: question,
      retrievalMeta: { resolvedQuestion }
    });
    const assistantMsg = await appendMessage(conversation.id, p.companyId, {
      role: "assistant",
      content: grounded.answer,
      citations: grounded.sources,
      graphEvidence: { relationships: grounded.graphEvidence, paths: grounded.paths },
      retrievalMeta: { grounded: grounded.grounded, confidence: grounded.confidence, plan: hybrid.plan, retrieval: hybrid.retrievalMeta, traceId },
      explanation
    });

    if (conversation.title === "New conversation") {
      await updateConversationTitle(conversation.id, question.slice(0, 60));
    }

    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "ASK",
      detail: {
        question,
        resolvedQuestion,
        queryKind: hybrid.plan.kind,
        detectedEntities: hybrid.plan.detectedEntities,
        graphEntitiesQueried: hybrid.plan.detectedEntities.length,
        traversalDepth: hybrid.plan.maxDepth,
        vectorResults: hybrid.bundle.vector.length,
        graphRelationshipsTraversed: hybrid.graphDetails.length,
        finalEvidence: hybrid.bundle.reranked.length,
        citations: grounded.sources.length,
        grounded: grounded.grounded,
        confidence: grounded.confidence,
        latencyMs: Math.round(performance.now() - start),
        model: process.env.AI_PROVIDER ?? "openai"
      },
      requestId: req.requestId
    });

    res.json({
      conversationId: conversation.id,
      messageId: assistantMsg.id,
      question: resolvedQuestion,
      answer: grounded.answer,
      grounded: grounded.grounded,
      confidence: grounded.confidence,
      sources: grounded.sources,
      graphEvidence: grounded.graphEvidence,
      paths: grounded.paths,
      entities: hybrid.plan.detectedEntities,
      explanationId: traceId,
      explanation: explanation,
      retrievalMeta: { plan: hybrid.plan, stats: hybrid.retrievalMeta }
    });
  })
);

chatRoutes.get(
  "/conversations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    res.json(await listConversations(p));
  })
);

chatRoutes.get(
  "/conversations/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const conversation = await getConversation(p, req.params.id);
    res.json(conversation);
  })
);

/**
 * GET /answers/:messageId/explanation
 *
 * Returns the stored, ACL-scoped explanation trace for one assistant answer.
 *
 * Authorization model:
 *  - Requires a company session.
 *  - The message must belong to the caller's tenant (companyId).
 *  - The message's conversation must belong to the caller (userId).
 *  - Only the persisted trace (already ACL-filtered at generation time) is
 *    returned; it is re-scoped to the caller's tenant on read.
 */
chatRoutes.get(
  "/answers/:messageId/explanation",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const message = await prisma.message.findFirst({
      where: {
        id: req.params.messageId,
        companyId: p.companyId,
        role: "assistant",
        conversation: { userId: p.userId }
      },
      select: { id: true, explanation: true }
    });
    if (!message) throw new NotFoundError("Explanation not found");

    if (!message.explanation) {
      res.status(404).json({ error: "No explanation available for this answer", code: "NO_EXPLANATION" });
      return;
    }
    res.json(message.explanation as unknown);
  })
);

chatRoutes.post(
  "/feedback",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const parsed = z
      .object({
        messageId: z.string(),
        rating: z.enum(["HELPFUL", "NOT_HELPFUL"]),
        reason: z.enum(["INCORRECT", "MISSING_INFORMATION", "WRONG_SOURCE", "OUTDATED", "OTHER"]).optional()
      })
      .safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Invalid feedback payload");

    const message = await prisma.message.findFirst({
      where: { id: parsed.data.messageId, companyId: p.companyId }
    });
    if (!message) throw new ValidationError("Message not found");

    await prisma.answerFeedback.upsert({
      where: { messageId: message.id },
      create: { companyId: p.companyId, userId: p.userId, messageId: message.id, rating: parsed.data.rating, reason: parsed.data.reason },
      update: { rating: parsed.data.rating, reason: parsed.data.reason }
    });
    await new Auditor().record({
      companyId: p.companyId,
      userId: p.userId,
      action: "FEEDBACK",
      detail: { messageId: message.id, rating: parsed.data.rating },
      requestId: req.requestId
    });
    res.json({ ok: true });
  })
);

/** Suggested questions for the tenant. */
chatRoutes.get(
  "/suggested",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = requireCompanyPrincipal(req);
    const items = await prisma.suggestedQuestion.findMany({
      where: { companyId: p.companyId },
      orderBy: { rank: "asc" },
      take: 8
    });
    res.json(items.map((i) => i.question));
  })
);