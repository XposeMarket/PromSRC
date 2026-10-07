import type { PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { registerSocialApiRequest } from '../_runtime/social-api-request.js';
const extension: PrometheusExtensionDefinition = {
  id: 'linkedin',
  register(api) { registerSocialApiRequest(api, 'linkedin', 'LinkedIn', 'https://api.linkedin.com', '/v2/userinfo', { 'X-Restli-Protocol-Version': '2.0.0' }); },
};
export default extension;
