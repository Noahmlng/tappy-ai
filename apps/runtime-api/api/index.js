import { handleRuntimeRequest } from '../../../mediation/src/devtools/mediation/mediation-gateway.js'

export default async function runtimeApiIndexHandler(req, res) {
  await handleRuntimeRequest(req, res)
}
