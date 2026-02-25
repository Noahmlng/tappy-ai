import { handleRuntimeRequest } from '../src/devtools/simulator/simulator-gateway.js'

export default async function mediationRuntimeApiHandler(req, res) {
  await handleRuntimeRequest(req, res)
}
