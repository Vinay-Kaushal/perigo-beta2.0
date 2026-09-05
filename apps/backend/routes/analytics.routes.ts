import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember } from "../middleware/access";
import * as ctrl from "../controllers/analytics.controller";

// Mounted at /organisations/:orgId/analytics
export const nestedAnalyticsRouter = Router({ mergeParams: true });
nestedAnalyticsRouter.get("/overview", requireOrgMember(), asyncHandler(ctrl.overview as any));
nestedAnalyticsRouter.get("/activity", requireOrgMember(), asyncHandler(ctrl.activity as any));
nestedAnalyticsRouter.get("/calendar", requireOrgMember(), asyncHandler(ctrl.calendar as any));
nestedAnalyticsRouter.get("/report.pdf", requireOrgMember(), asyncHandler(ctrl.reportPdf as any));
