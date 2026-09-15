import type { Board, OrganisationMember, Task } from "db/client";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      /** Set by requireAuth. */
      user?: {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
        mfaEnabled: boolean;
        /** How this session was established — see lib/tokens.ts. */
        session: import("../lib/tokens").SessionContext;
      };
      /** Set by requireOrgMember / requireBoardAccess / requireTaskAccess. */
      membership?: OrganisationMember;
      board?: Board;
      task?: Task;
    }
  }
}

export {};
