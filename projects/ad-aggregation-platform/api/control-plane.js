import { handleControlPlaneRequest } from '../src/devtools/simulator/simulator-gateway.js'

export default async function mediationControlPlaneApiHandler(req, res) {
  await handleControlPlaneRequest(req, res)
}
