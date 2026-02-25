import { handleRuntimeRequest } from '../../../mediation/src/devtools/mediation/runtime-api-handler.js'

export default async function runtimeApiIndexHandler(req, res) {
  await handleRuntimeRequest(req, res)
}
