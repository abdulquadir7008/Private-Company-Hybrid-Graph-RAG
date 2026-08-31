import type { EntityType, RelationshipType } from "@graphrag/shared";
import { assertRelationshipSupported } from "@graphrag/shared";
import { runQuery } from "./driver.js";
import { graphId } from "../util/ids.js";
import { assertEntityType, assertRelationshipType } from "./ontologyGuard.js";

export interface GraphEntityInput {
  tenantId: string;
  name: string;
  normalizedName: string;
  type: EntityType;
  description?: string | null;
  confidence: number;
  documentId: string;
  chunkId: string;
  page?: number | null;
  section?: string | null;
  sourceText?: string | null;
}

export interface GraphRelationshipInput {
  tenantId: string;
  sourceName: string;
  sourceType: EntityType;
  targetName: string;
  targetType: EntityType;
  type: RelationshipType;
  confidence: number;
  documentId: string;
  chunkId: string;
  page?: number | null;
  section?: string | null;
  sourceText?: string | null;
}

function mergeStringArrays(a: string[] | undefined, b: string[] | null | undefined): string[] {
  return Array.from(new Set([...(a ?? []), ...(b ?? [])]));
}

/** Upsert an entity identified by (tenantId, name). Never crosses tenants. */
export async function upsertEntity(input: GraphEntityInput): Promise<{ id: string; created: boolean }> {
  assertEntityType(input.type);
  const existing = await runQuery<{ e: { id: string; sourceDocuments: string[]; sourceChunks: string[]; aliases: string[] }; id: string }>(
    `MATCH (e:Entity {tenantId: $tenantId, name: $name}) RETURN properties(e) AS e, e.id AS id`,
    { tenantId: input.tenantId, name: input.name }
  );

  if (existing.length > 0) {
    const rec = existing[0];
    const e = rec.e as unknown as { id: string; sourceDocuments: string[]; sourceChunks: string[]; aliases: string[] };
    const docs = mergeStringArrays(e.sourceDocuments, [input.documentId]);
    const chunks = mergeStringArrays(e.sourceChunks, [input.chunkId]);
    const aliases = mergeStringArrays(e.aliases ?? [], [input.normalizedName]);
    await runQuery(
      `MATCH (e:Entity {tenantId: $tenantId, name: $name})
       SET e.normalizedName = $normalizedName,
           e.description = coalesce($description, e.description),
           e.confidence = CASE WHEN e.confidence IS NULL OR $confidence > e.confidence THEN $confidence ELSE e.confidence END,
           e.sourceDocuments = $docs,
           e.sourceChunks = $chunks,
           e.aliases = $aliases
       RETURN e.id AS id`,
      { tenantId: input.tenantId, name: input.name, normalizedName: input.normalizedName, description: input.description ?? null, confidence: input.confidence, docs, chunks, aliases }
    );
    return { id: String(rec.id), created: false };
  }

  const id = graphId();
  await runQuery(
    `MERGE (e:Entity {tenantId: $tenantId, name: $name})
     ON CREATE SET e.id = $id
     SET e.type = $type,
         e.normalizedName = $normalizedName,
         e.description = $description,
         e.confidence = $confidence,
         e.sourceDocuments = $docs,
         e.sourceChunks = $chunks,
         e.aliases = $aliases
     RETURN e.id AS id`,
    { tenantId: input.tenantId, name: input.name, id, type: input.type, normalizedName: input.normalizedName, description: input.description ?? null, confidence: input.confidence, docs: [input.documentId], chunks: [input.chunkId], aliases: [input.normalizedName] }
  );
  return { id, created: true };
}

/** Create/refresh the provenance anchors Document -> Chunk. */
export async function upsertDocumentChunkProvenance(opts: {
  tenantId: string;
  pgDocumentId: string;
  title: string;
  pgChunkId: string;
  chunkIndex: number;
  section?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  text?: string;
}): Promise<void> {
  await runQuery(
    `MERGE (d:Document {pgDocumentId: $pgDocumentId})
     ON CREATE SET d.id = $docId, d.tenantId = $tenantId
     SET d.title = $title, d.tenantId = $tenantId
     MERGE (c:Chunk {pgChunkId: $pgChunkId})
     ON CREATE SET c.id = $chunkId, c.tenantId = $tenantId
     SET c.tenantId = $tenantId, c.index = $chunkIndex, c.section = $section,
         c.pageStart = $pageStart, c.pageEnd = $pageEnd, c.textExcerpt = $text
     MERGE (d)-[r:CONTAINS_SECTION]->(c)
     SET r.tenantId = $tenantId`,
    { pgDocumentId: opts.pgDocumentId, docId: graphId(), tenantId: opts.tenantId, title: opts.title, pgChunkId: opts.pgChunkId, chunkId: graphId(), chunkIndex: opts.chunkIndex, section: opts.section ?? null, pageStart: opts.pageStart ?? null, pageEnd: opts.pageEnd ?? null, text: opts.text?.slice(0, 500) }
  );
}

/** Link a Chunk to an Entity it mentions, with provenance. */
export async function linkChunkMention(opts: {
  tenantId: string;
  pgChunkId: string;
  entityName: string;
  confidence: number;
  sourceText?: string | null;
  section?: string | null;
  page?: number | null;
}): Promise<void> {
  await runQuery(
    `MATCH (c:Chunk {pgChunkId: $pgChunkId, tenantId: $tenantId})
     MATCH (e:Entity {name: $entityName, tenantId: $tenantId})
     MERGE (c)-[m:MENTIONS]->(e)
     SET m.confidence = $confidence,
         m.sourceText = $sourceText,
         m.section = $section,
         m.page = $page,
         m.tenantId = $tenantId
     RETURN m`,
    { pgChunkId: opts.pgChunkId, tenantId: opts.tenantId, entityName: opts.entityName, confidence: opts.confidence, sourceText: opts.sourceText ?? null, section: opts.section ?? null, page: opts.page ?? null }
  );
}

/** Upsert an ontology-validated relationship between two entities. */
export async function upsertRelationship(input: GraphRelationshipInput): Promise<void> {
  assertRelationshipType(input.type);
  assertRelationshipSupported(input.sourceType, input.type, input.targetType);

  const existing = await runQuery<{ rrid: string; sources: string[]; rels: unknown[] }>(
    `MATCH (s:Entity {tenantId: $tenantId, name: $sourceName})
     MATCH (t:Entity {tenantId: $tenantId, name: $targetName})
     MATCH (s)-[r:${input.type}]->(t)
     RETURN r.rid AS rrid, r.sources AS sources`,
    { tenantId: input.tenantId, sourceName: input.sourceName, targetName: input.targetName }
  );

  if (existing.length > 0) {
    const sources = mergeStringArrays(existing[0].sources, [input.chunkId]);
    await runQuery(
      `MATCH (s:Entity {tenantId: $tenantId, name: $sourceName})
       MATCH (t:Entity {tenantId: $tenantId, name: $targetName})
       MATCH (s)-[r:${input.type}]->(t)
       SET r.confidence = CASE WHEN r.confidence IS NULL OR $confidence > r.confidence THEN $confidence ELSE r.confidence END,
           r.sources = $sources,
           r.documentIds = apoc.coll.toSet(coalesce(r.documentIds, []) + [$documentId]),
           r.sourceText = $sourceText,
           r.section = coalesce($section, r.section),
           r.page = coalesce($page, r.page)`,
      { tenantId: input.tenantId, sourceName: input.sourceName, targetName: input.targetName, confidence: input.confidence, sources, documentId: input.documentId, sourceText: input.sourceText ?? null, section: input.section ?? null, page: input.page ?? null }
    );
    return;
  }

  await runQuery(
    `MATCH (s:Entity {tenantId: $tenantId, name: $sourceName})
     MATCH (t:Entity {tenantId: $tenantId, name: $targetName})
     CREATE (s)-[r:${input.type}]->(t)
     SET r.rid = $rid, r.tenantId = $tenantId,
         r.confidence = $confidence,
         r.sources = [$chunkId],
         r.documentIds = [$documentId],
         r.sourceText = $sourceText,
         r.section = $section,
         r.page = $page
     RETURN r`,
    { tenantId: input.tenantId, sourceName: input.sourceName, targetName: input.targetName, rid: graphId(), confidence: input.confidence, chunkId: input.chunkId, documentId: input.documentId, sourceText: input.sourceText ?? null, section: input.section ?? null, page: input.page ?? null }
  );
}

/** Remove a document's whole subgraph from the tenant graph. */
export async function deleteDocumentSubgraph(tenantId: string, pgDocumentId: string): Promise<void> {
  // Remove document/chunk anchors and their mention links.
  await runQuery(
    `MATCH (d:Document {tenantId: $tenantId, pgDocumentId: $pgDocumentId}) OPTIONAL MATCH (d)-[rd:CONTAINS_SECTION]->(c:Chunk)
     OPTIONAL MATCH (c)-[rm:MENTIONS]->()
     DELETE rm, rd, c, d`,
    { tenantId, pgDocumentId }
  );
  // Remove document id from entity source lists, then drop orphaned entities.
  const entities = await runQuery<{ name: string; sourceDocuments: string[] }>(
    `MATCH (e:Entity {tenantId: $tenantId}) WHERE $pgDocumentId IN e.sourceDocuments RETURN e.name AS name, e.sourceDocuments AS sourceDocuments`,
    { tenantId, pgDocumentId }
  );
  for (const ent of entities) {
    const docs = (ent.sourceDocuments ?? []).filter((d) => d !== pgDocumentId);
    const relCount = await runQuery<{ n: number }>(
      `MATCH (e:Entity {tenantId: $tenantId, name: $name})-[r]-()
       RETURN count(r) AS n`,
      { tenantId, name: ent.name }
    );
    if (docs.length === 0 && (relCount[0]?.n ?? 0) === 0) {
      await runQuery(
        `MATCH (e:Entity {tenantId: $tenantId, name: $name}) DETACH DELETE e`,
        { tenantId, name: ent.name }
      );
    } else if (docs.length === 0) {
      await runQuery(
        `MATCH (e:Entity {tenantId: $tenantId, name: $name})
         SET e.sourceDocuments = [], e.sourceChunks = []
         REMOVE e.id`,
        { tenantId, name: ent.name }
      );
    } else {
      await runQuery(
        `MATCH (e:Entity {tenantId: $tenantId, name: $name})
         SET e.sourceDocuments = $docs`,
        { tenantId, name: ent.name, docs }
      );
    }
  }
}

export async function graphStats(tenantId: string, authDocs?: string[]) {
  const isAuthed = Array.isArray(authDocs) && authDocs.length > 0;
  const docFilter = isAuthed ? "AND all(d IN e.sourceDocuments WHERE d IN $authDocs)" : "";
  const res = await runQuery<{ entities: unknown; relationships: unknown; chunks: unknown; documents: unknown }>(
    `MATCH (e:Entity {tenantId: $tenantId}) WHERE e.sourceDocuments IS NOT NULL ${docFilter} WITH count(e) AS entities
     MATCH (a:Entity {tenantId: $tenantId})-[r]->(b:Entity {tenantId: $tenantId}) WHERE r.tenantId = $tenantId WITH entities, count(r) AS relationships
     MATCH (c:Chunk {tenantId: $tenantId}) WITH entities, relationships, count(c) AS chunks
     MATCH (d:Document {tenantId: $tenantId}) RETURN entities, relationships, chunks, count(d) AS documents`,
    { tenantId, ...(isAuthed ? { authDocs } : {}) }
  );
  const s = res[0] ?? { entities: 0, relationships: 0, chunks: 0, documents: 0 };
  return {
    entities: Number(s.entities),
    relationships: Number(s.relationships),
    chunks: Number(s.chunks),
    documents: Number(s.documents)
  };
}