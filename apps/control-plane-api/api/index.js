import { handleControlPlaneRequest } from '../../../projects/ad-aggregation-platform/src/devtools/simulator/simulator-gateway.js'

export default async function controlPlaneApiIndexHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
