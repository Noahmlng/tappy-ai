export class TtlCache {
  constructor(options = {}) {
    this.maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : 500
    this.store = new Map()
  }

  _isExpired(entry, now = Date.now()) {
    if (!entry || typeof entry.expiresAt !== 'number') return true
    return entry.expiresAt <= now
  }

  _evictExpired(now = Date.now()) {
    for (const [key, entry] of this.store.entries()) {
      if (this._isExpired(entry, now)) {
        this.store.delete(key)
      }
    }
  }

  _evictOverflow() {
    while (this.store.size > this.maxEntries) {
      const firstKey = this.store.keys().next().value
      if (firstKey === undefined) break
      this.store.delete(firstKey)
    }
  }

  get(key) {
    if (typeof key !== 'string' || !key) return null
    const entry = this.store.get(key)
    if (!entry) return null

    if (this._isExpired(entry)) {
      this.store.delete(key)
      return null
    }

    return entry.value
  }

  set(key, value, ttlMs) {
    if (typeof key !== 'string' || !key) return
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return

    const now = Date.now()
    const expiresAt = now + ttlMs
    this._evictExpired(now)
    this.store.set(key, { value, expiresAt })
    this._evictOverflow()
  }

  delete(key) {
    if (typeof key !== 'string' || !key) return
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }

  size() {
    this._evictExpired(Date.now())
    return this.store.size
  }
}
