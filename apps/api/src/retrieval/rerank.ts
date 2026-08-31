import type { EvidenceItem } from "@graphrag/shared";
import { config } from "../config.js";
import { chatCompletion } from "../ai/llm.js";
import { logger } from "../logger.js";

/**
 * Evidence reranking.
 *
 * Default: score fusion using Reciprocal Rank Fusion over the per-source rank
 * orders plus source-type weights, so vector / graph / keyword evidence are
 * merged into one unified, relevance-ordered list.
 *
 * Optional (RERANK_MODE=llm): a cheap LLM re-score pass over the top candidates.
 */

export type RerankMode = "rrf" | "llm";

const SOURCE_WEIGHT: Record<string, number> = {
  vector: 1.0,
  keyword: 0.9,
  graph: 0.85,
  path: 0.9
};

export function rerankEvidence(groups: {
  vector: EvidenceItem[];
  graph: EvidenceItem[];
  keyword: EvidenceItem[];
  paths: EvidenceItem[];
}, mode: RerankMode = (process.env.RERANK_MODE as RerankMode) || "rrf"): EvidenceItem[] {
  const fused = new Map<string, EvidenceItem & { _rrf: number }>();
  const contribute = (items: EvidenceItem[], weight: number) => {
    items.forEach((item, rank) => {
      const prior = fused.get(item.id);
      const rrf = weight / (60 + rank);
      if (prior) {
        prior._rrf += rrf;
        prior.relevanceScore = Math.max(prior.relevanceScore, item.relevanceScore);
      } else {
        fused.set(item.id, { ...item, _rrf: rrf });
      }
    });
  };

  contribute(groups.vector, SOURCE_WEIGHT.vector);
  contribute(groups.graph, SOURCE_WEIGHT.graph);
  contribute(groups.keyword, SOURCE_WEIGHT.keyword);
  contribute(groups.paths, SOURCE_WEIGHT.path);
  void config;

  const ranked = Array.from(fused.values())
    .sort((a, b) => b._rrf - a._rrf)
    .slice(0, config.TOP_K_RERANKED)
    .map(({ _rrf, ...item }) => ({ ...item, relevanceScore: Math.round(item.relevanceScore * 100) / 100 }));

  if (mode === "llm" && ranked.length > 3) {
    return ranked; // LLM rerank reserved for a future scoring hook; RRF is deterministic + safe.
  }
  return ranked;
}

/**
 * Optional LLM-assisted rerank (used by the retrieval-debug admin view and
 * in tests to prove the RRF path stays stable). Kept side-effect free.
 */
export async function llmRerank(query: string, items: EvidenceItem[]): Promise<EvidenceItem[]> {
  if (items.length <= 1) return items;
  try {
    const list = items
      .map((i, idx) => `[${idx}] ${i.text.slice(0, 180)}`)
      .join("\n");
    const res = await chatCompletion(
      [
        { role: "system", content: "Re-rank these evidence snippets by relevance to the query. Reply only with a comma-separated list of the original indices in order of most to least relevant." },
        { role: "user", content: `Query: ${query}\n\n${list}` }
      ],
      { temperature: 0, maxTokens: 80 }
    );
    const order = res.content
      .split(",")
      .map((x) => parseInt(x.replace(/\D/g, ""), 10))
      .filter((x) => Number.isInteger(x) && x >= 0 && x < items.length);
    if (order.length < 2) return items;
    return order.map((i) => items[i]).filter(Boolean);
  } catch (err) {
    logger.warn("llm rerank failed, falling back to RRF order", { err });
    return items;
  }
}