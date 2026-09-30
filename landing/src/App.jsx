import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { createState } from './three/state.js'
import useScrollStory, { SCENES } from './hooks/useScrollStory.js'
import useLiveStats from './hooks/useLiveStats.js'
import useSmoothScroll from './hooks/useSmoothScroll.js'
import Lines from './components/Lines.jsx'
import LatticeLoader from './components/reactbits/LatticeLoader.jsx'
import GlassButton from './components/GlassButton.jsx'
import GlassAiButton from './components/GlassAiButton.jsx'
import { tokenHex, prefersReducedMotion } from './lib/tokens.js'

/* Code-split: only the capsule stage, GSAP and the copy are in the first chunk. The
   ogl backdrops, the carousel, the ribbon and the motion-based ticker load on demand,
   and each ogl canvas is mounted only while its scene is current or adjacent. */
const GradientWaves = lazy(() => import('./components/reactbits/GradientWaves.jsx'))
const WebThreads = lazy(() => import('./components/reactbits/WebThreads.jsx'))
const TextLoop = lazy(() => import('./components/reactbits/TextLoop.jsx'))
const NumberTicker = lazy(() => import('./components/21st/NumberTicker.jsx'))

/* The control room lives two levels up from landing/dist/ when served by the gateway. */
const CONSOLE = import.meta.env.DEV ? 'http://localhost:8080/index.html' : '../../index.html'


export default function App() {
  const root = useRef(null)
  const track = useRef(null)
  const canvasRef = useRef(null)
  const labelsRef = useRef(null)
  const tick0 = useRef(null)
  const tick1 = useRef(null)
  const tick2 = useRef(null)
  const state = useMemo(createState, [])
  const reduced = useMemo(prefersReducedMotion, [])
  const stats = useLiveStats()

  const [scene, setScene] = useState(0)
  const [loaded, setLoaded] = useState('working')
  const [webgl, setWebgl] = useState(true)
  const [probe, setProbe] = useState({ status: 'working', elapsed: undefined, text: '' })
  const [colors, setColors] = useState(null)

  // colours for the ogl components, resolved from the tokens once fonts/CSS are in
  useEffect(() => {
    setColors({
      paper: tokenHex('--paper'), deep: tokenHex('--paper-deep'), line: tokenHex('--line'),
      ink: tokenHex('--ink'), muted: tokenHex('--muted'), panel: tokenHex('--panel'),
    })
  }, [])

  // the 3D stage
  useEffect(() => {
    // three.js arrives as its own chunk after the copy has painted
    let stage
    let cancelled = false
    const t0 = performance.now()
    import('./three/Stage.js').then(({ Stage }) => {
      if (cancelled) return
      try {
        stage = new Stage({ canvas: canvasRef.current, labels: labelsRef.current, state, reducedMotion: reduced })
      } catch {
        setWebgl(false)
        setLoaded({ status: 'error', elapsed: (performance.now() - t0) / 1000 })
        return
      }
      stage.ready.then(() => { setLoaded({ status: 'done', elapsed: (performance.now() - t0) / 1000 }) })
        .catch(() => setLoaded({ status: 'error', elapsed: (performance.now() - t0) / 1000 }))
    }).catch(() => setLoaded({ status: 'error', elapsed: (performance.now() - t0) / 1000 }))
    return () => { cancelled = true; stage?.destroy() }
  }, [state, reduced])

  useSmoothScroll(reduced)

  useScrollStory({
    root, track, state, reducedMotion: reduced,
    onScene: (i) => setScene((prev) => (prev === i ? prev : i)),
    onProgress: () => {},
  })

  // scene 03: the 21st.dev tickers count as the capsule bursts (pinned = always in view,
  // so they are triggered by scene arrival, not by an IntersectionObserver)
  useEffect(() => {
    if (scene !== 2) return
    ;[tick0, tick1, tick2].forEach((t, i) => setTimeout(() => t.current?.startAnimation(), 250 + i * 120))
  }, [scene])

  // scene 04: a real probe of the six registries, run each time the scene arrives
  useEffect(() => {
    if (scene !== 3) return undefined
    const ctl = new AbortController()
    const t0 = performance.now()
    setProbe({ status: 'working', elapsed: undefined, text: '' })
    fetch('/api/network', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((n) => {
        const up = n.mode === 'rmi-live' ? `${n.reachableNodes}/${n.totalNodes} registries answered` : 'catalog mode · registries not running'
        const ms = performance.now() - t0
        setProbe({ status: 'done', elapsed: ms / 1000, text: `${Math.round(ms)} ms · ${up}${n.coordinator ? ` · coordinator ${n.coordinator}` : ''}` })
      })
      .catch((e) => { if (e?.name !== 'AbortError') setProbe({ status: 'error', elapsed: (performance.now() - t0) / 1000, text: 'gateway unreachable — run ./scripts/start-web.sh' }) })
    return () => ctl.abort()
  }, [scene])


  const near = (i) => Math.abs(scene - i) <= 1
  const loadStatus = typeof loaded === 'string' ? loaded : loaded.status
  const loadElapsed = typeof loaded === 'string' ? undefined : loaded.elapsed
  const n = (v) => (v == null ? '—' : v)
  const counts = `${n(stats.prescriptions)} prescriptions · ${n(stats.medicines)} medicines · ${n(stats.inventory)} stock rows`

  return (
    <div ref={root} className={`landing ${webgl ? '' : 'no-webgl'}`} data-scene-active={SCENES[scene].id}>
      <a className="skip-link" href={CONSOLE}>Skip to the control room</a>

      {/* ── fixed stage: backdrops → capsule → copy → labels → chrome ── */}
      <div className="stage" aria-hidden="false">
        <div className="backdrop backdrop-waves" aria-hidden="true">
          {colors && near(0) && (
            <Suspense fallback={null}><GradientWaves horizonColor={colors.paper} waveColor={colors.line} crestColor={colors.panel}
              speed={reduced ? 0 : 0.18} amplitude={2.2} waveScale={0.55} swell={30} turbulence={18}
              tilt={1.16} height={6.5} fogDepth={13} detail="low" brightness={1} opacity={0.9}
              parallaxStrength={0.35} grain grainIntensity={0.035} paused={scene !== 0} /></Suspense>
          )}
        </div>
        <div className="backdrop backdrop-threads" aria-hidden="true">
          {colors && near(1) && (
            /* Six threads = the six RMI registries, fanning out from the capsule's side.
               inkMode: crisp token-ink threads over the paper, transparent elsewhere. */
            <Suspense fallback={null}><WebThreads color1={colors.ink} color2={colors.muted} color3={colors.ink} inkMode
              threadCount={6} speed={reduced ? 0 : 0.18} frequency={2.4} spread={0.05} taper={0.4}
              position={typeof window !== "undefined" && innerWidth < 900 ? 0.6 : 0.15} fanMode="right" mirror={false} glow={0.0009} falloff={1.1} thickness={1}
              brightness={1} opacity={0.75} shimmer grain={false}
              mouseInteraction mouseStrength={0.35} paused={scene !== 1} /></Suspense>
          )}
        </div>

        <canvas ref={canvasRef} className="capsule-canvas" aria-hidden="true" />
        <svg className="capsule-fallback" viewBox="0 0 200 480" aria-hidden="true">
          <rect x="40" y="20" width="120" height="220" rx="60" className="cf-ink" />
          <rect x="40" y="240" width="120" height="220" rx="60" className="cf-paper" />
        </svg>

        <div className="scenes">
          {/* 01 — CAPSULE */}
          <section className="scene scene-capsule" data-scene="capsule" aria-labelledby="h-capsule">
            <p className="eyebrow mono reveal">HELIXIS / DISTRIBUTED PHARMACY</p>
            <Lines as="h1" id="h-capsule" lines={['Medicine,', <em key="e">made for life.</em>]} />
            <p className="lead reveal">One prescription, six pharmacy nodes, zero records lost. Scroll to turn the capsule — and then break it open.</p>
            <dl className="readout mono reveal">
              <div><dt>SOURCE</dt><dd>{stats.source}</dd></div>
              <div><dt>NODES</dt><dd>{stats.reachable != null ? `${stats.reachable} / ${stats.nodes} up` : `${n(stats.nodes)} registered`}</dd></div>
              <div><dt>COORDINATOR</dt><dd>{stats.coordinator ?? '—'}</dd></div>
            </dl>
            <p className="scroll-cue mono reveal" aria-hidden="true"><i /> SCROLL</p>
          </section>

          {/* 02 — OVERVIEW */}
          <section className="scene scene-overview" data-scene="overview" aria-labelledby="h-overview">
            <div className="overview-head">
              <Lines as="h2" id="h-overview" lines={['One capsule.', <em key="e">Six nodes.</em>]} />
              <p className="lead reveal">Each small capsule orbiting the big one is a Java RMI registry — Mumbai to Chennai, ports 1099–1104 — each one holding its own branch's stock, prescriptions and ledger, and all six answering every query together.</p>
            </div>
          </section>

          {/* 03 — BURST */}
          <section className="scene scene-burst" data-scene="burst" aria-labelledby="h-burst">
            <Lines as="h2" id="h-burst" lines={['Break the capsule.', <em key="e">Find the network.</em>]} />
            <ul className="facts mono">
              <li className="reveal"><b>{stats.prescriptions == null ? '—' : <Suspense fallback={stats.prescriptions}><NumberTicker ref={tick0} from={0} target={stats.prescriptions} autoStart={false} /></Suspense>}</b> prescriptions sealed into a SHA-256 chain</li>
              <li className="reveal"><b>{stats.nodes == null ? '—' : <Suspense fallback={stats.nodes}><NumberTicker ref={tick1} from={0} target={stats.nodes} autoStart={false} /></Suspense>}</b> nodes, one coordinator chosen by bully election</li>
              <li className="reveal"><b>{0 == null ? '—' : <Suspense fallback={0}><NumberTicker ref={tick2} from={9} target={0} autoStart={false} /></Suspense>}</b> records written by this page — it only reads</li>
            </ul>
            <div className="burst-loop reveal" aria-hidden="true">
              {colors && near(2) && (
                <Suspense fallback={null}><TextLoop text="bully election ✦ primary–backup failover ✦ vector clocks ✦ optimistic concurrency ✦ sha-256 chain"
                  separator="✦" shape="wave" curviness={34} speed={reduced ? 0 : 70} fontSize={30} fontWeight={500}
                  letterSpacing={3} color="var(--paper)" ribbonColor="var(--ink)" ribbonWidth={64} pauseOnHover={false}
                  paused={scene !== 2} style={{ fontFamily: 'var(--mono)' }} /></Suspense>
              )}
            </div>
          </section>

          {/* 04 — ENTER */}
          <section className="scene scene-enter" data-scene="enter" aria-labelledby="h-enter">
            <Lines as="h2" id="h-enter" lines={['Step inside', <em key="e">the control room.</em>]} />
            <p className="lead reveal">Every granule from the capsule has landed on a node. That is the system: {counts}, spread across six branches and kept honest by the protocol.</p>
            <div className="probe reveal">
              <LatticeLoader status={probe.status} elapsed={probe.elapsed} label="Probing six registries" doneLabel="Answered in"
                errorLabel="No answer after" pattern="orbit" grid={3} shape="round" cellSize={6} gap={2} fontSize={13} />
              <span className="probe-detail mono">{probe.text}</span>
            </div>
            <div className="cta reveal">
              <GlassAiButton href={CONSOLE} label="Control room" />
              <GlassAiButton href={`${CONSOLE}#integrity`} label="017 verification" />
            </div>
          </section>
        </div>

        <div ref={labelsRef} className="node-labels" aria-hidden="true" />

        <header className="topbar">
          <a className="brand" href={CONSOLE} aria-label="Helixis control room"><span className="brand-symbol" aria-hidden="true">+</span><span>HELIXIS</span></a>
          <span className="topbar-status mono">{stats.source}{stats.rtt ? ` · ${stats.rtt.toFixed(0)} MS` : ''}</span>
          <GlassAiButton href={CONSOLE} label="Control room" className="glass-ai--sm topbar-link" />
        </header>
      </div>

      {/* model load status: measured, but never blocks the copy from painting */}
      <div className={`load-chip ${loadStatus !== 'working' ? 'is-done' : ''}`}>
        <LatticeLoader status={loadStatus} elapsed={loadElapsed} label="Loading capsule" doneLabel="Capsule ready in"
          errorLabel="3D unavailable after" pattern="spiral" grid={3} shape="round" cellSize={7} gap={3} fontSize={14} />
      </div>

      {/* the invisible track: native scroll length that drives the whole story */}
      <div ref={track} className="track" aria-hidden="true" />
    </div>
  )
}
