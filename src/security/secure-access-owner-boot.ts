// Side-effect import. Must stay the FIRST import of src/gateway/server-v2.ts so
// owner/pairing/browser-RPC secrets leave process.env before any child spawn.
import { captureGatewayOwnerSecrets } from './secure-access-owner';

captureGatewayOwnerSecrets();
