import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember, requireOrgRole } from "../middleware/access";
import * as ctrl from "../controllers/invitation.controller";

// Mounted at /organisations/:orgId/invitations
export const nestedInvitationRouter = Router({ mergeParams: true });
nestedInvitationRouter.post(
  "/",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.createInvitation as any)
);
nestedInvitationRouter.get("/", requireOrgMember(), asyncHandler(ctrl.listInvitations as any));
nestedInvitationRouter.delete(
  "/:invitationId",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.revokeInvitation as any)
);

// Mounted at /invitations, BEFORE requireAuth — a public preview needs no
// token yet (someone might click the link before creating an account).
export const publicInvitationRouter = Router();
publicInvitationRouter.get("/:token", asyncHandler(ctrl.getInvitationByToken));

// Mounted at /invitations, AFTER requireAuth — accepting requires being logged in.
export const invitationRouter = Router();
invitationRouter.post("/:token/accept", asyncHandler(ctrl.acceptInvitation as any));
