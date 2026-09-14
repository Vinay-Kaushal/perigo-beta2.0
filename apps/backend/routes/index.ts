import { Router } from "express";
import { asyncHandler as h } from "../lib/http";
import { env } from "../lib/env";
import { requireAuth } from "../middleware/auth";
import { requireBoardAccess, requireOrgMember, requireOrgRole, requireTaskAccess } from "../middleware/access";
import { rateLimit } from "../middleware/rateLimit";

import * as auth from "../controllers/auth.controller";
import * as orgs from "../controllers/organisation.controller";
import * as invites from "../controllers/invitation.controller";
import * as teams from "../controllers/team.controller";
import * as tickets from "../controllers/ticket.controller";
import * as boards from "../controllers/board.controller";
import * as tasks from "../controllers/task.controller";
import * as expenses from "../controllers/expense.controller";
import * as goals from "../controllers/goal.controller";
import * as analytics from "../controllers/analytics.controller";
import * as dashboard from "../controllers/dashboard.controller";
import * as notifications from "../controllers/notification.controller";
import * as attachments from "../controllers/attachment.controller";

const ADMIN = ["OWNER", "ADMIN"] as const;
const uploadLimiter = rateLimit({ name: "upload", windowSec: 60, max: () => 60, key: (req) => req.user!.id });

// ---------------------------------------------------------------- public (no token)

export const publicRouter = Router();

const credentialKey = (req: import("express").Request) =>
  `${req.ip}:${typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : ""}`;
const loginLimiter = rateLimit({ name: "login", windowSec: 15 * 60, max: () => env().RATE_LIMIT_AUTH_MAX, key: credentialKey });
const signupLimiter = rateLimit({ name: "signup", windowSec: 60 * 60, max: () => env().RATE_LIMIT_SIGNUP_MAX });
const inviteLookupLimiter = rateLimit({ name: "invite-lookup", windowSec: 60, max: () => env().RATE_LIMIT_TOKEN_MAX });
const verifyLimiter = rateLimit({ name: "verify-email", windowSec: 60, max: () => env().RATE_LIMIT_TOKEN_MAX });

publicRouter.post("/auth/register", signupLimiter, h(auth.register));
publicRouter.post("/auth/login", loginLimiter, h(auth.login));
publicRouter.post("/auth/google", loginLimiter, h(auth.googleAuth));
publicRouter.get("/invitations/:token", inviteLookupLimiter, h(invites.previewInvitation));
publicRouter.post("/auth/logout", h(auth.logout));
publicRouter.post("/email/unsubscribe", rateLimit({ name: "unsubscribe", windowSec: 60, max: () => env().RATE_LIMIT_TOKEN_MAX }), h(notifications.unsubscribe));
publicRouter.post("/auth/verify-email", verifyLimiter, h(auth.verifyEmail));
publicRouter.post("/auth/forgot-password", loginLimiter, h(auth.forgotPassword));
publicRouter.post("/auth/reset-password", loginLimiter, h(auth.resetPassword));

// ---------------------------------------------------------------- authenticated

export const privateRouter = Router();
privateRouter.use(requireAuth);
privateRouter.use(rateLimit({ name: "user", windowSec: 60, max: () => env().RATE_LIMIT_USER_MAX, key: (req) => req.user!.id }));

// Account
privateRouter.get("/auth/me", h(auth.me));
privateRouter.patch("/auth/me", h(auth.updateMe));
privateRouter.post("/auth/change-password", loginLimiter, h(auth.changePassword));
privateRouter.post("/auth/logout-all", h(auth.logoutAll));
privateRouter.post("/auth/ws-ticket", h(auth.createWsTicket));
privateRouter.post("/auth/resend-verification", rateLimit({ name: "resend-verification", windowSec: 15 * 60, max: () => 5, key: (req) => req.user!.id }), h(auth.resendVerification));

// Personal
privateRouter.get("/me/dashboard", h(dashboard.myDashboard));
privateRouter.get("/me/join-requests", h(invites.myJoinRequests));
privateRouter.get("/me/notifications", h(notifications.listNotifications));
privateRouter.get("/me/notifications/unread-count", h(notifications.unreadCount));
privateRouter.post("/me/notifications/read-all", h(notifications.markAllRead));
privateRouter.get("/me/notification-preferences", h(notifications.getPreferences));
privateRouter.patch("/me/notification-preferences", h(notifications.updatePreferences));
privateRouter.post("/me/notifications/:notificationId/read", h(notifications.markRead));

// Invitee side of an invitation
privateRouter.post("/invitations/:token/accept", inviteLookupLimiter, h(invites.acceptInvitation));
privateRouter.post("/invitations/:token/decline", inviteLookupLimiter, h(invites.declineInvitation));

// Organisations
privateRouter.post("/organisations", h(orgs.createOrganisation));
privateRouter.get("/organisations", h(orgs.listMyOrganisations));

const org = Router({ mergeParams: true });
privateRouter.use("/organisations/:orgId", requireOrgMember(), org);

org.get("/", h(orgs.getOrganisation));
org.patch("/", requireOrgRole(...ADMIN), h(orgs.updateOrganisation));
org.delete("/", requireOrgRole("OWNER"), h(orgs.deleteOrganisation));
org.get("/audit-logs", requireOrgRole(...ADMIN), h(orgs.listAuditLogs));

org.get("/members", h(orgs.listMembers));
org.delete("/members/me", h(orgs.leaveOrganisation));
org.patch("/members/:memberId", requireOrgRole("OWNER"), h(orgs.updateMemberRole));
org.delete("/members/:memberId", requireOrgRole(...ADMIN), h(orgs.removeMember));

org.post("/invitations", h(invites.createInvitation));
org.get("/invitations", requireOrgRole(...ADMIN), h(invites.listInvitations));
org.delete("/invitations/:invitationId", h(invites.revokeInvitation));
org.post("/invitations/:invitationId/resend", h(invites.resendInvitation));
org.post("/invitations/:invitationId/approve", requireOrgRole(...ADMIN), h(invites.approveInvitation));
org.post("/invitations/:invitationId/reject", requireOrgRole(...ADMIN), h(invites.rejectInvitation));

org.get("/teams", h(teams.listTeams));
org.post("/teams", requireOrgRole(...ADMIN), h(teams.createTeam));
org.patch("/teams/:teamId", requireOrgRole(...ADMIN), h(teams.updateTeam));
org.delete("/teams/:teamId", requireOrgRole(...ADMIN), h(teams.deleteTeam));
org.post("/teams/:teamId/members", requireOrgRole(...ADMIN), h(teams.addTeamMember));
org.delete("/teams/:teamId/members/:userId", requireOrgRole(...ADMIN), h(teams.removeTeamMember));

org.get("/tickets", h(tickets.listTickets));
org.post("/tickets", h(tickets.createTicket));
org.get("/tickets/stats", h(tickets.ticketStats));
org.get("/tickets/:ticketRef", h(tickets.getTicket));
org.patch("/tickets/:ticketRef", h(tickets.updateTicket));
org.delete("/tickets/:ticketRef", requireOrgRole(...ADMIN), h(tickets.deleteTicket));
org.post("/tickets/:ticketRef/assign", h(tickets.assignTicket));
org.post("/tickets/:ticketRef/status", h(tickets.changeTicketStatus));
org.post("/tickets/:ticketRef/watch", h(tickets.watchTicket));
org.delete("/tickets/:ticketRef/watch", h(tickets.unwatchTicket));
org.post("/tickets/:ticketRef/comments", h(tickets.addTicketComment));
org.post("/tickets/:ticketRef/attachments", uploadLimiter, h(attachments.uploadAttachment));
org.get("/tickets/:ticketRef/attachments/:attachmentId", h(attachments.downloadAttachment));
org.delete("/tickets/:ticketRef/attachments/:attachmentId", h(attachments.deleteAttachment));
org.patch("/tickets/:ticketRef/comments/:commentId", h(tickets.updateTicketComment));
org.delete("/tickets/:ticketRef/comments/:commentId", h(tickets.deleteTicketComment));

org.get("/boards", h(boards.listBoards));
org.post("/boards", h(boards.createBoard));

org.get("/expenses", h(expenses.listExpenses));
org.post("/expenses", h(expenses.createExpense));
org.get("/expenses/summary", h(expenses.expenseSummary));
org.get("/expenses/categories", h(expenses.expenseCategories));
org.patch("/expenses/:expenseId", h(expenses.updateExpense));
org.delete("/expenses/:expenseId", h(expenses.deleteExpense));
org.post("/expenses/:expenseId/approve", requireOrgRole(...ADMIN), h(expenses.approveExpense));
org.post("/expenses/:expenseId/reject", requireOrgRole(...ADMIN), h(expenses.rejectExpense));

org.get("/goals", h(goals.listGoals));
org.post("/goals", h(goals.createGoal));
org.get("/goals/:goalId", h(goals.getGoal));
org.patch("/goals/:goalId", h(goals.updateGoal));
org.delete("/goals/:goalId", h(goals.deleteGoal));
org.post("/goals/:goalId/check-ins", h(goals.addCheckIn));

org.get("/analytics/overview", h(analytics.overview));
org.get("/analytics/activity", h(analytics.activity));
org.get("/analytics/calendar", h(analytics.calendar));
org.get("/analytics/report.pdf", requireOrgRole(...ADMIN), h(analytics.reportPdf));

// Boards (kanban)
const board = Router({ mergeParams: true });
privateRouter.use("/boards/:boardId", requireBoardAccess(), board);

board.get("/", h(boards.getBoard));
board.patch("/", h(boards.updateBoard));
board.delete("/", h(boards.deleteBoard));
board.post("/members", h(boards.addBoardMember));
board.delete("/members/:userId", h(boards.removeBoardMember));
board.post("/statuses", h(boards.createStatus));
board.patch("/statuses/:statusId", h(boards.updateStatus));
board.patch("/statuses/:statusId/reorder", h(boards.reorderStatus));
board.delete("/statuses/:statusId", h(boards.deleteStatus));
board.get("/tasks", h(tasks.listTasks));
board.post("/tasks", h(tasks.createTask));

const task = Router({ mergeParams: true });
privateRouter.use("/tasks/:taskId", requireTaskAccess(), task);

task.get("/", h(tasks.getTask));
task.patch("/", h(tasks.updateTask));
task.delete("/", h(tasks.deleteTask));
task.patch("/move", h(tasks.moveTask));
task.post("/assignees", h(tasks.addAssignee));
task.delete("/assignees/:userId", h(tasks.removeAssignee));
task.get("/comments", h(tasks.listComments));
task.post("/comments", h(tasks.addComment));
task.patch("/comments/:commentId", h(tasks.updateComment));
task.delete("/comments/:commentId", h(tasks.deleteComment));
