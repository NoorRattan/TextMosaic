import { motion, useMotionValue, useScroll, useSpring } from "framer-motion";
import type { Variants } from "framer-motion";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";

import { extractText } from "./api/client";
import { GraphErrorBoundary } from "./components/GraphErrorBoundary";
import { TextInput } from "./components/TextInput";
import type { ExtractResponse } from "./types";

const initialText =
  "Havana Radio Reloj Network broadcast the interview from Cuba.";
const GraphView = lazy(() => import("./components/GraphView"));
type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  try {
    return globalThis.localStorage?.getItem("textmosaic-theme") === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

const reveal: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.12 + index * 0.08,
      duration: 0.72,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  }),
};

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [signal, setSignal] = useState({ x: 50, y: 45 });
  const cursorX = useMotionValue(-80);
  const cursorY = useMotionValue(-80);
  const cursorSpringX = useSpring(cursorX, {
    stiffness: 420,
    damping: 34,
    mass: 0.35,
  });
  const cursorSpringY = useSpring(cursorY, {
    stiffness: 420,
    damping: 34,
    mass: 0.35,
  });
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 26,
    mass: 0.2,
  });

  useEffect(() => {
    const updateCursor = (event: PointerEvent) => {
      cursorX.set(event.clientX - 12);
      cursorY.set(event.clientY - 12);
    };
    window.addEventListener("pointermove", updateCursor);
    return () => window.removeEventListener("pointermove", updateCursor);
  }, [cursorX, cursorY]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      globalThis.localStorage?.setItem("textmosaic-theme", theme);
    } catch {
      // Theme persistence is optional when browser storage is unavailable.
    }
  }, [theme]);

  const runExtraction = async () => {
    setExtractionError(null);
    setModelProgress(0);
    setIsLoading(true);
    try {
      setResult(await extractText(text, setModelProgress));
    } catch (reason: unknown) {
      setExtractionError(
        reason instanceof Error
          ? reason.message
          : "Extraction could not be completed.",
      );
    } finally {
      setIsLoading(false);
      setModelProgress(null);
    }
  };

  return (
    <main className="site-shell">
      <motion.div className="reading-progress" style={{ scaleX: progress }} />
      <motion.div
        className="cursor-halo"
        aria-hidden="true"
        style={{ x: cursorSpringX, y: cursorSpringY }}
      />

      <section
        className="hero-stage"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setSignal({
            x: ((event.clientX - bounds.left) / bounds.width) * 100,
            y: ((event.clientY - bounds.top) / bounds.height) * 100,
          });
        }}
        style={
          {
            "--signal-x": `${signal.x}%`,
            "--signal-y": `${signal.y}%`,
          } as CSSProperties
        }
      >
        <div className="paper-noise" aria-hidden="true" />
        <nav className="masthead" aria-label="Primary navigation">
          <a className="wordmark" href="#top" aria-label="TextMosaic home">
            <span className="wordmark-glyph">T</span>
            <span>TextMosaic</span>
          </a>
          <div className="masthead-note">Neural extraction / 01–06</div>
          <div className="masthead-actions">
            <button
              className="theme-toggle"
              type="button"
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              aria-pressed={theme === "light"}
              onClick={() =>
                setTheme((currentTheme) =>
                  currentTheme === "dark" ? "light" : "dark",
                )
              }
            >
              <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
            <a className="masthead-link" href="#studio">
              Open the studio <span aria-hidden="true">↘</span>
            </a>
          </div>
        </nav>

        <div className="hero-copy" id="top">
          <motion.p
            className="kicker"
            custom={0}
            initial="hidden"
            animate="visible"
            variants={reveal}
          >
            From dense text to a system of meaning
          </motion.p>
          <h1>
            {["Make", "language", "legible."].map((word, index) => (
              <span className="hero-word" key={word}>
                <motion.span
                  custom={index + 1}
                  initial="hidden"
                  animate="visible"
                  variants={reveal}
                >
                  {word}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p
            className="hero-intro"
            custom={4}
            initial="hidden"
            animate="visible"
            variants={reveal}
          >
            TextMosaic turns raw language into an evidence-grounded field of
            concepts and directed relationships, with the source still in view.
          </motion.p>
        </div>

        <div className="hero-index" aria-label="Product characteristics">
          <span>01 / evidence grounded</span>
          <span>02 / plain language</span>
          <span>03 / graph native</span>
        </div>
        <div className="signal-orbit" aria-hidden="true">
          <span className="signal-dot dot-one" />
          <span className="signal-dot dot-two" />
          <span className="signal-dot dot-three" />
          <svg viewBox="0 0 600 460" role="presentation">
            <path d="M36 322 C150 212 214 392 307 238 S456 92 567 185" />
            <path d="M34 120 C144 232 253 48 353 177 S452 392 580 322" />
            <path d="M111 399 C210 304 271 237 410 312" />
          </svg>
        </div>
      </section>

      <section
        className="editorial-section conflict-section"
        aria-labelledby="conflict-title"
      >
        <p className="section-number">A / The friction</p>
        <div className="conflict-grid">
          <h2 id="conflict-title">
            Text is dense.
            <em> Context should not be.</em>
          </h2>
          <div className="conflict-copy">
            <p>
              Reading reveals facts one line at a time. TextMosaic makes the
              structure visible at once: who appears, what belongs together, and
              which direction each relationship takes.
            </p>
            <span className="focus-rule">Entity → relation → evidence</span>
          </div>
        </div>
      </section>

      <section
        className="studio-section"
        id="studio"
        aria-labelledby="studio-title"
      >
        <div className="studio-heading">
          <p className="section-number">B / The extraction studio</p>
          <h2 id="studio-title">Feed the model a thought.</h2>
          <p>
            It will return the relationships it can justify from the tokens.
          </p>
        </div>
        <div className="studio-layout">
          <aside className="control-column">
            <TextInput
              value={text}
              isLoading={isLoading}
              canExtract
              onChange={setText}
              onSubmit={() => void runExtraction()}
            />
            <section className="local-model-note" aria-live="polite">
              <p className="eyebrow">Private by design</p>
              <strong>Model runs inside your browser.</strong>
              <span>
                The ONNX model is bundled with this site. Your source text is
                never uploaded or sent to an API.
              </span>
              {modelProgress !== null && modelProgress < 100 ? (
                <span>Loading local model {modelProgress}%</span>
              ) : null}
            </section>
            {extractionError ? (
              <p className="error-message" role="alert">
                {extractionError}
              </p>
            ) : null}
          </aside>
          <section className="graph-panel" aria-labelledby="graph-heading">
            <div className="graph-header">
              <div>
                <p className="kicker">Live relationship field</p>
                <h2 id="graph-heading">The map’s reasoning</h2>
              </div>
              {result ? (
                <span className="result-count">
                  {result.concepts.length} concepts /{" "}
                  {result.graphRelations.length} relationships
                </span>
              ) : (
                <span className="result-count">Awaiting source text</span>
              )}
            </div>
            {result ? (
              <GraphErrorBoundary>
                <Suspense
                  fallback={
                    <GraphPlaceholder message="Assembling the field…" />
                  }
                >
                  <GraphView result={result} />
                </Suspense>
              </GraphErrorBoundary>
            ) : (
              <GraphPlaceholder
                message={
                  isLoading
                    ? "Tracing concepts, evidence, and relationships through the source…"
                    : "A source-grounded knowledge map will appear here."
                }
              />
            )}
          </section>
        </div>
      </section>

      <section className="mosaic-section" aria-labelledby="mosaic-title">
        <div className="mosaic-header">
          <p className="section-number">C / What stays visible</p>
          <h2 id="mosaic-title">Every signal has a provenance.</h2>
        </div>
        <div className="mosaic-grid">
          <article className="mosaic-piece source-piece">
            <span>01</span>
            <h3>Tokens remain the ground truth.</h3>
            <p>
              Each entity is anchored to an end-exclusive span in your source
              text.
            </p>
          </article>
          <article className="mosaic-piece relation-piece">
            <span>02</span>
            <h3>Relationships keep their direction.</h3>
            <p>
              Edges retain head and tail indices instead of becoming decorative
              lines.
            </p>
          </article>
          <article className="mosaic-piece model-piece">
            <span>03</span>
            <h3>One on-device model. One explorable reading.</h3>
            <p>
              The bundled ML model finds named entities; local graph rules turn
              the evidence into an explorable relationship map.
            </p>
          </article>
        </div>
      </section>

      <section className="evidence-ribbon" aria-label="TextMosaic evidence">
        <div className="ribbon-track">
          {[
            "fully local inference",
            "no third-party API",
            "directed relations",
            "interactive 3D graph",
            "verbatim evidence",
            "fully local inference",
            "no third-party API",
            "directed relations",
          ].map((item, index) => (
            <span key={`${item}-${index}`}>
              {item} <i>✦</i>
            </span>
          ))}
        </div>
      </section>

      <section className="closing-section" aria-labelledby="closing-title">
        <p className="section-number">D / Begin with the source</p>
        <h2 id="closing-title">Find the shape inside the statement.</h2>
        <MagneticLink />
        <p className="closing-note">
          No decorative graph. Every concept and link is traceable back to your
          source.
        </p>
      </section>
    </main>
  );
}

function MagneticLink() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 280, damping: 16 });
  const springY = useSpring(y, { stiffness: 280, damping: 16 });

  return (
    <motion.a
      className="magnetic-link"
      href="#studio"
      style={{ x: springX, y: springY }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        x.set((event.clientX - (bounds.left + bounds.width / 2)) * 0.18);
        y.set((event.clientY - (bounds.top + bounds.height / 2)) * 0.18);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <span>Open extraction studio</span>
      <b aria-hidden="true">↘</b>
    </motion.a>
  );
}

function GraphPlaceholder({ message }: { message: string }) {
  return (
    <section className="graph-empty" aria-live="polite">
      <span className="empty-prompt-mark" aria-hidden="true">
        —
      </span>
      <p>{message}</p>
    </section>
  );
}
