import { TtlCache } from './ttl-cache.js'

const queryCache = new TtlCache({ maxEntries: 300 })
const offerSnapshotCache = new TtlCache({ maxEntries: 800 })

function clearRuntimeCaches() {
  queryCache.clear()
  offerSnapshotCache.clear()
}

export { queryCache, offerSnapshotCache, clearRuntimeCaches }
