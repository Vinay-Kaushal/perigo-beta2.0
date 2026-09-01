import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember, requireBoardMember } from "../middleware/access";
import * as ctrl from "../controllers/board.controller";

// Mounted at /organisations/:orgId/boards
export const nestedBoardRouter = Router({ mergeParams: true });
nestedBoardRouter.post("/", requireOrgMember(), asyncHandler(ctrl.createBoard as any));
nestedBoardRouter.get("/", requireOrgMember(), asyncHandler(ctrl.listBoards as any));

// Mounted at /boards
export const boardRouter = Router();
boardRouter.get("/:boardId", requireBoardMember(), asyncHandler(ctrl.getBoard as any));
boardRouter.patch("/:boardId", requireBoardMember(), asyncHandler(ctrl.updateBoard as any));
boardRouter.delete("/:boardId", requireBoardMember(), asyncHandler(ctrl.deleteBoard as any));

boardRouter.post("/:boardId/members", requireBoardMember(), asyncHandler(ctrl.addBoardMember as any));
boardRouter.delete(
  "/:boardId/members/:memberId",
  requireBoardMember(),
  asyncHandler(ctrl.removeBoardMember as any)
);

boardRouter.post("/:boardId/statuses", requireBoardMember(), asyncHandler(ctrl.createStatus as any));
boardRouter.patch(
  "/:boardId/statuses/:statusId",
  requireBoardMember(),
  asyncHandler(ctrl.updateStatus as any)
);
boardRouter.patch(
  "/:boardId/statuses/:statusId/reorder",
  requireBoardMember(),
  asyncHandler(ctrl.reorderStatus as any)
);
boardRouter.delete(
  "/:boardId/statuses/:statusId",
  requireBoardMember(),
  asyncHandler(ctrl.deleteStatus as any)
);
