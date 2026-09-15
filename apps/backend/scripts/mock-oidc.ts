/**
 * Runs the mock OpenID Connect provider for local development and the e2e
 * suite — never in production. Configure an org's SSO with:
 *   issuer http://localhost:4010, client id perigo-e2e, secret perigo-e2e-secret
 */
import { startMockOidc } from "../tests/support/mockOidc";

const port = Number(process.env.MOCK_OIDC_PORT ?? 4010);
const idp = await startMockOidc({ port, clientId: "perigo-e2e", clientSecret: "perigo-e2e-secret" });
console.log(`Mock identity provider on ${idp.issuer} (client perigo-e2e / perigo-e2e-secret)`);
