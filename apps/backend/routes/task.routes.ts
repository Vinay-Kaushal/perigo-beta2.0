import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireBoardMember, requireTaskAccess } from "../middleware/access";
import * as ctrl from "../controllers/task.controller";
import * as commentCtrl from "../controllers/comment.controller";

// Mounted at /boards/:boardId/tasks
export const nestedTaskRouter = Router({ mergeParams: true });
nestedTaskRouter.post("/", requireBoardMember(), asyncHandler(ctrl.createTask as any));
nestedTaskRouter.get("/", requireBoardMember(), asyncHandler(ctrl.listTasks as any));

// Mounted at /tasks — every route resolves the task's board internally via requireTaskAccess()
export const taskRouter = Router();
taskRouter.use("/:taskId", requireTaskAccess());

taskRouter.get("/:taskId", asyncHandler(ctrl.getTask as any));
taskRouter.patch("/:taskId", asyncHandler(ctrl.updateTask as any));
taskRouter.patch("/:taskId/move", asyncHandler(ctrl.moveTask as any));
taskRouter.delete("/:taskId", asyncHandler(ctrl.deleteTask as any));

taskRouter.post("/:taskId/assignees", asyncHandler(ctrl.addAssignee as any));
taskRouter.delete("/:taskId/assignees/:userId", asyncHandler(ctrl.removeAssignee as any));

taskRouter.post("/:taskId/comments", asyncHandler(commentCtrl.addComment as any));
taskRouter.get("/:taskId/comments", asyncHandler(commentCtrl.listComments as any));
taskRouter.patch("/:taskId/comments/:commentId", asyncHandler(commentCtrl.updateComment as any));
taskRouter.delete("/:taskId/comments/:commentId", asyncHandler(commentCtrl.deleteComment as any));
