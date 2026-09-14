/**
 * The ONLY shape a user may be serialised as. Never `include: { user: true }`
 * — that ships passwordHash and tokenVersion to the client.
 */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

export const publicUser = { select: publicUserSelect } as const;
