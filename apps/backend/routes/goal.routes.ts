import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember } from "../middleware/access";
import * as ctrl from "../controllers/goal.controller";

// Mounted at /organisations/:orgId/goals
export const nestedGoalRouter = Router({ mergeParams: true });
nestedGoalRouter.post("/", requireOrgMember(), asyncHandler(ctrl.createGoal as any));
nestedGoalRouter.get("/", requireOrgMember(), asyncHandler(ctrl.listGoals as any));
nestedGoalRouter.delete("/:goalId", requireOrgMember(), asyncHandler(ctrl.deleteGoal as any));
