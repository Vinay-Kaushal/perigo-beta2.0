/** Messages for `?sso_error=` codes set by the API's SSO callback. */
const SSO_ERRORS: Record<string, string> = {
  not_configured: "Single sign-on isn't set up for that email domain. Sign in with your password, or ask your admin.",
  invalid_email: "Enter your work email to continue with single sign-on.",
  provider_unavailable: "We couldn't reach your identity provider. Try again in a moment.",
  expired: "That sign-in took too long or was already used. Please try again.",
  state_mismatch: "That sign-in didn't start in this browser. Please try again.",
  domain_not_verified: "Your identity provider signed you in with an email your organisation hasn't verified.",
  no_account: "There's no perigo account for you yet. Ask your admin for an invitation.",
  idp_error: "Your identity provider couldn't sign you in.",
  token_exchange_failed: "We couldn't verify the response from your identity provider.",
  no_email: "Your identity provider didn't share an email address.",
};

export function ssoErrorMessage(code: string) {
  return Object.hasOwn(SSO_ERRORS, code) ? SSO_ERRORS[code]! : "Single sign-on failed. Please try again.";
}

/** Reasons a connection test can fail (`?sso_test=failed&reason=`), shown in organisation settings. */
export function ssoTestFailureMessage(reason: string | null) {
  if (reason === "not_owner") return "Only organisation owners can test the connection.";
  if (reason === "state_mismatch" || reason === "expired") return "The test took too long or started in another browser. Try again.";
  return reason && Object.hasOwn(SSO_ERRORS, reason) ? SSO_ERRORS[reason]! : "The identity provider didn't complete the sign-in.";
}
