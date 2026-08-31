import neo4j, { type Driver, type Session } from "neo4j-driver";
import { config } from "../config.js";
import { logger } from "../logger.js";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(config.NEO4J_URI, neo4j.auth.basic(config.NEO4J_USERNAME, config.NEO4J_PASSWORD));
  }
  return driver;
}

export async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const d = getDriver();
  const session = d.session({ database: config.NEO4J_DATABASE });
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  return withSession(async (session) => {
    const result = await session.run(cypher, params);
    return result.records.map((r) => (r as unknown as { toObject: () => Record<string, unknown> }).toObject() as T);
  });
}

export async function initializeGraph(): Promise<void> {
  return withSession(async (session) => {
    // Schema constraints & indexes. `Entity.id` and `Relationship.rid` are
    // globally unique; every node carries tenantId for tenant-scoped queries.
    await session.run("CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT entity_tid_name IF NOT EXISTS FOR (n:Entity) REQUIRE (n.tenantId, n.name) IS UNIQUE");
    await session.run("CREATE CONSTRAINT document_id IF NOT EXISTS FOR (n:Document) REQUIRE n.pgDocumentId IS UNIQUE");
    await session.run("CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (n:Chunk) REQUIRE n.pgChunkId IS UNIQUE");
    await session.run("CREATE INDEX entity_type_idx IF NOT EXISTS FOR (n:Entity) ON (n.type)");
    await session.run("CREATE INDEX entity_norm_idx IF NOT EXISTS FOR (n:Entity) ON (n.normalizedName)");
  }).catch((err) => {
    logger.warn("neo4j index init failed (may already exist)", { err });
    throw err;
  });
}

export async function graphHealthcheck(): Promise<boolean> {
  try {
    await withSession(async (s) => s.run("RETURN 1 AS ok"));
    return true;
  } catch (err) {
    logger.error("neo4j healthcheck failed", { err });
    return false;
  }
}

export async function closeGraph(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}