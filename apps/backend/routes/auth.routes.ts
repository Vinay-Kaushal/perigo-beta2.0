import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import * as ctrl from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(ctrl.register));
authRouter.post("/login", asyncHandler(ctrl.login));
authRouter.post("/google", asyncHandler(ctrl.googleAuth));
// /auth/me needs a token, unlike the two above, so it carries its own guard
// rather than relying on the app-wide requireAuth (which is mounted after
// this router specifically so register/login can run without one).
authRouter.get("/me", requireAuth, asyncHandler(ctrl.me as any));
authRouter.patch("/me", requireAuth, asyncHandler(ctrl.updateMe as any));
authRouter.post("/change-password", requireAuth, asyncHandler(ctrl.changePassword as any));
