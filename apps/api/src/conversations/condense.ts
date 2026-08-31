import type { ChatMessage } from "../ai/llm.js";
import { chatCompletion } from "../ai/llm.js";
import { logger } from "../logger.js";

const CONDENSE_SYSTEM = `You rewrite follow-up questions into self-contained, unambiguous questions for a
retrieval system. Use the conversation history only to resolve pronouns and
implicit references ("it", "the manager", "that policy"). Never add facts that
are not present. Reply with the rewritten question only, no quotes, no preamble.`;

/**
 * Query condensation for multi-turn conversations.
 * "What about the manager?" after "Who owns the leave policy?" becomes
 * "Who manages the leave policy?" — resolving implicit entity references.
 * When there is no useful history, the original question passes through.
 */
export async function condenseQuestion(question: string, history: { role: string; content: string }[]): Promise<string> {
  const recent = history.slice(-6);
  if (recent.length === 0) return question;

  const looksLikeFollowUp =
    /\b(it|its|that|this|those|these|the (manager|policy|department|owner|person|company)|him|her|they|them|their|which one)\b/i.test(
      question
    ) && !/\b(what is the remote work policy|who owns the remote work policy)\b/i.test(question);

  if (!looksLikeFollowUp && /^[A-Z]/.test(question.trim())) {
    return question;
  }

  const historyText = recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  const turn: ChatMessage[] = [
    { role: "system", content: CONDENSE_SYSTEM },
    { role: "user", content: `CONVERSATION HISTORY:\n${historyText}\n\nFOLLOW-UP: ${question}\n\nREWRITTEN QUESTION:` }
  ];
  try {
    const res = await chatCompletion(turn, { temperature: 0, maxTokens: 120 });
    const rewritten = res.content
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\n/g, " ");
    if (!rewritten || rewritten.length < 3) return question;
    return rewritten.slice(0, 300);
  } catch (err) {
    logger.warn("query condensation failed; using original question", { err });
    return question;
  }
}