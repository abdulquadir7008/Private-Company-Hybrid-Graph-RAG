import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { attachRequestId, health, healthFull } from "./access/middleware.js";
import { apiRouter } from "./http/routes.js";
import { AppError, isAppError } from "./errors.js";
import { logger } from "./logger.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: config.WEB_URL || true,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(attachRequestId);

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many requests",
    skip: (_req) => config.isDemoSetupEnabled
  });
  app.use("/api", apiLimiter);

  app.get("/api/health", health);
  app.get("/api/health/full", healthFull);

  app.use("/api", apiRouter);

  // 404 for unknown API routes.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Central error handler: typed, constant-shape JSON.
  app.use(
    (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      let status = 500;
      let message = "Internal server error";
      let code: string | undefined;
      let field: string | undefined;

      if (isAppError(err)) {
        status = err.statusCode;
        message = err.message;
        code = err.code;
        field = err.field;
      } else if (err instanceof SyntaxError) {
        status = 400;
        message = "Malformed JSON body";
        code = "BAD_JSON";
      } else if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
        status = 404;
        message = "Not found";
        code = "NOT_FOUND";
      }

      if (status >= 500) {
        logger.error("unhandled error", { requestId: req.requestId, err });
      }
      res.status(status).json({ error: message, code, field });
    }
  );

  return app;
}

export function notFound(): AppError {
  return new AppError(404, "Not found", "NOT_FOUND");
}