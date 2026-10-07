import type { PrometheusExtensionDefinition } from '../../../runtime-api.js';
import { registerSocialApiRequest } from '../_runtime/social-api-request.js';
const extension: PrometheusExtensionDefinition = {
  id: 'instagram',
  register(api) { registerSocialApiRequest(api, 'instagram', 'Instagram', 'https://graph.instagram.com', '/me?fields=id,username'); },
};
export default extension;
