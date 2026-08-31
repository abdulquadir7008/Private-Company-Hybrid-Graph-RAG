import { Router } from "express";
import { authRoutes } from "./authRoutes.js";
import { documentRoutes } from "./documentRoutes.js";
import { chatRoutes } from "./chatRoutes.js";
import { graphRoutes } from "./graphRoutes.js";
import { adminRoutes } from "./adminRoutes.js";
import { rootRoutes } from "./rootRoutes.js";

export const apiRouter = Router();

// Root-admin platform endpoints (never mounted inside a tenant session).
apiRouter.use("/root", rootRoutes);

// Tenant endpoints.
apiRouter.use("/auth", authRoutes);
apiRouter.use("/documents", documentRoutes);
apiRouter.use("/chat", chatRoutes);
apiRouter.use("/conversations", chatRoutes);
apiRouter.use("/graph", graphRoutes);
apiRouter.use("/admin", adminRoutes);

// Suggested questions for the chat home.
apiRouter.use("/suggested", chatRoutes);