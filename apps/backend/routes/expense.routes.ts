import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireOrgMember } from "../middleware/access";
import * as ctrl from "../controllers/expense.controller";

// Mounted at /organisations/:orgId/expenses
export const nestedExpenseRouter = Router({ mergeParams: true });
nestedExpenseRouter.post("/", requireOrgMember(), asyncHandler(ctrl.createExpense as any));
nestedExpenseRouter.get("/", requireOrgMember(), asyncHandler(ctrl.listExpenses as any));
nestedExpenseRouter.get("/summary", requireOrgMember(), asyncHandler(ctrl.expenseSummary as any));
nestedExpenseRouter.patch("/:expenseId", requireOrgMember(), asyncHandler(ctrl.updateExpense as any));
nestedExpenseRouter.delete("/:expenseId", requireOrgMember(), asyncHandler(ctrl.deleteExpense as any));
