import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember, requireOrgRole } from "../middleware/access";
import * as ctrl from "../controllers/organisation.controller";

export const organisationRouter = Router();

organisationRouter.post("/", asyncHandler(ctrl.createOrganisation as any));
organisationRouter.get("/", asyncHandler(ctrl.listMyOrganisations as any));

organisationRouter.get("/:orgId", requireOrgMember(), asyncHandler(ctrl.getOrganisation as any));
organisationRouter.patch(
  "/:orgId",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.updateOrganisation as any)
);
organisationRouter.delete(
  "/:orgId",
  requireOrgMember(),
  requireOrgRole("OWNER"),
  asyncHandler(ctrl.deleteOrganisation as any)
);

organisationRouter.post(
  "/:orgId/members",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.addOrganisationMember as any)
);
organisationRouter.patch(
  "/:orgId/members/:memberId",
  requireOrgMember(),
  requireOrgRole("OWNER"),
  asyncHandler(ctrl.updateMemberRole as any)
);
organisationRouter.delete(
  "/:orgId/members/:memberId",
  requireOrgMember(),
  requireOrgRole("OWNER", "ADMIN"),
  asyncHandler(ctrl.removeOrganisationMember as any)
);
