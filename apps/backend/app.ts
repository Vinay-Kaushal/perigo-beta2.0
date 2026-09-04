import express from "express";
import cors from "cors";
import helmet from "helmet";

import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

import { authRouter } from "./routes/auth.routes";
import { organisationRouter } from "./routes/organisation.routes";
import { nestedTeamRouter, teamRouter } from "./routes/team.routes";
import { nestedBoardRouter, boardRouter } from "./routes/board.routes";
import { nestedTaskRouter, taskRouter } from "./routes/task.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Register/login must run before requireAuth — there's no token yet.
  app.use("/auth", authRouter);

  // Everything below requires a valid JWT.
  app.use(requireAuth);

  app.use("/organisations", organisationRouter);
  app.use("/organisations/:orgId/teams", nestedTeamRouter);
  app.use("/organisations/:orgId/boards", nestedBoardRouter);
  app.use("/boards/:boardId/tasks", nestedTaskRouter);

  app.use("/teams", teamRouter);
  app.use("/boards", boardRouter);
  app.use("/tasks", taskRouter);

  app.use(errorHandler);

  return app;
}
