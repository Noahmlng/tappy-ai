import { handleControlPlaneRequest } from '../../../mediation/src/devtools/mediation/mediation-gateway.js'

export default async function controlPlaneApiIndexHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
