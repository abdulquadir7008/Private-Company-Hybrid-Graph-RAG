import { config } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { initializeGraph, graphHealthcheck, closeGraph } from "./graph/driver.js";
import { hashPassword } from "./auth/passwords.js";
import { seedDemoCompany } from "./demo/seed.js";

async function bootstrap(): Promise<void> {
  // 1. PostgreSQL ready.
  await prisma.$connect();

  // 2. Neo4j schema + connectivity.
  await initializeGraph();
  const healthy = await graphHealthcheck();
  if (!healthy) logger.warn("neo4j did not report healthy at startup");

  // 3. Optional root admin (platform operator).
  if (config.ROOT_ADMIN_EMAIL && config.ROOT_ADMIN_PASSWORD) {
    const existing = await prisma.rootAdmin.findUnique({ where: { email: config.ROOT_ADMIN_EMAIL } });
    if (!existing) {
      await prisma.rootAdmin.create({
        data: {
          email: config.ROOT_ADMIN_EMAIL.toLowerCase().trim(),
          passwordHash: await hashPassword(config.ROOT_ADMIN_PASSWORD)
        }
      });
      logger.info("root admin created", { scope: "bootstrap" });
    }
  }

  // 4. Demo company (idempotent) so the stack works out of the box.
  if (config.isDemoSetupEnabled) {
    try {
      await seedDemoCompany();
    } catch (err) {
      logger.warn("demo seeding failed; continuing", { err });
    }
  }

  // Chroma is lazily connected at first use; verify now for a clean health signal.
  try {
    const { getCollection } = await import("./vector/chroma.js");
    await getCollection();
  } catch (err) {
    logger.warn("chroma initial connection failed", { err });
  }

  const app = createApp();
  const port = config.API_PORT;
  app.listen(port, () => {
    logger.info(`api listening on :${port}`, { scope: "bootstrap" });
  });
}

bootstrap().catch(async (err) => {
  logger.error("fatal startup error", { err });
  await prisma.$disconnect().catch(() => undefined);
  await closeGraph().catch(() => undefined);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect().catch(() => undefined);
  await closeGraph().catch(() => undefined);
  process.exit(0);
});