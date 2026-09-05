import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import * as ctrl from "../controllers/dashboard.controller";

// Mounted at /me/dashboard, after the app-wide requireAuth — this is not
// org-scoped, so it needs no requireOrgMember() check; the query itself
// only ever touches orgs the caller is actually a member of.
export const meDashboardRouter = Router();
meDashboardRouter.get("/", asyncHandler(ctrl.myDashboard as any));
