import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember, requireOrgRole } from "../middleware/access";
import * as ctrl from "../controllers/team.controller";

// Mounted at /organisations/:orgId/teams
export const nestedTeamRouter = Router({ mergeParams: true });
nestedTeamRouter.post(
  "/",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.createTeam as any)
);
nestedTeamRouter.get("/", requireOrgMember(), asyncHandler(ctrl.listTeams as any));

// Mounted at /teams
export const teamRouter = Router();
teamRouter.get("/:teamId", asyncHandler(ctrl.getTeam as any));
teamRouter.patch("/:teamId", asyncHandler(ctrl.updateTeam as any));
teamRouter.delete("/:teamId", asyncHandler(ctrl.deleteTeam as any));
teamRouter.post("/:teamId/members", asyncHandler(ctrl.addTeamMember as any));
teamRouter.delete("/:teamId/members/:memberId", asyncHandler(ctrl.removeTeamMember as any));
