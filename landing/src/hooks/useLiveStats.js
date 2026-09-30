import { useEffect, useState } from 'react'

/** Live counts from the Java gateway (/api/overview + /api/network), i.e. from PostgreSQL.
 *  No built-in numbers: until the gateway answers, every count is null and renders as '—'. */
const EMPTY = { nodes: null, reachable: null, medicines: null, prescriptions: null, inventory: null, transactions: null, source: 'CONNECTING…' }

export default function useLiveStats() {
  const [stats, setStats] = useState(EMPTY)
  useEffect(() => {
    const ctl = new AbortController()
    const t0 = performance.now()
    Promise.all([
      fetch('/api/overview', { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))),
      fetch('/api/network', { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))),
    ]).then(([o, n]) => {
      const c = o.counts ?? {}
      setStats({
        nodes: n.totalNodes ?? null, reachable: n.mode === 'rmi-live' ? n.reachableNodes : null,
        coordinator: n.coordinator, medicines: c.medicines ?? null, prescriptions: c.prescriptions ?? null,
        inventory: c.inventoryRows ?? null, transactions: c.transactions ?? null,
        source: n.mode === 'rmi-live' ? 'LIVE · RMI' : 'LIVE · CATALOG', rtt: performance.now() - t0,
      })
    }).catch(() => setStats({ ...EMPTY, source: 'GATEWAY OFFLINE' }))
    return () => ctl.abort()
  }, [])
  return stats
}
