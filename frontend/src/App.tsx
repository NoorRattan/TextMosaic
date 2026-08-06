import { lazy, Suspense, useEffect, useState } from "react";

import { extractText, getTiers } from "./api/client";
import { TextInput } from "./components/TextInput";
import { TierSelector } from "./components/TierSelector";
import type { ExtractResponse, TierInfo, TierName } from "./types";

const initialText =
  "Havana Radio Reloj Network broadcast the interview from Cuba.";
const GraphView = lazy(() => import("./components/GraphView"));

export default function App() {
  const [text, setText] = useState(initialText);
  const [tiers, setTiers] = useState<TierInfo[]>([]);
  const [selectedTier, setSelectedTier] = useState<TierName>("balanced");
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTiers()
      .then((availableTiers) => {
        setTiers(availableTiers);
        if (!availableTiers.some((tier) => tier.name === selectedTier)) {
          setSelectedTier(availableTiers[0]?.name ?? "balanced");
        }
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load model tiers.",
        );
      });
  }, [selectedTier]);

  const runExtraction = async () => {
    setError(null);
    setIsLoading(true);
    try {
      setResult(await extractText(text, selectedTier));
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Extraction could not be completed.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <a className="brand" href="/" aria-label="TextMosaic home">
          <span className="brand-mark">TM</span>
          <span>TextMosaic</span>
        </a>
        <div className="hero-copy">
          <p className="eyebrow">Self-trained knowledge extraction</p>
          <h1>Turn language into a living relationship map.</h1>
          <p className="hero-description">
            A shared BiLSTM finds entities and relations, then renders the
            result as a manipulable 3D graph.
          </p>
        </div>
        <div className="legend" aria-label="Graph legend">
          <span>
            <i className="legend-node" /> Entities
          </span>
          <span>
            <i className="legend-edge" /> Relations
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="control-column">
          <TextInput
            value={text}
            disabled={isLoading}
            onChange={setText}
            onSubmit={() => void runExtraction()}
          />
          <TierSelector
            tiers={tiers}
            selectedTier={selectedTier}
            disabled={isLoading || tiers.length === 0}
            onChange={setSelectedTier}
          />
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
        </aside>
        <section className="graph-panel" aria-labelledby="graph-heading">
          <div className="graph-header">
            <div>
              <p className="eyebrow">Knowledge graph</p>
              <h2 id="graph-heading">Explore the extracted connections</h2>
            </div>
            {result ? (
              <span className="result-count">
                {result.entities.length} entities · {result.relations.length}{" "}
                relations
              </span>
            ) : null}
          </div>
          {result ? (
            <Suspense
              fallback={<GraphPlaceholder message="Preparing the 3D graph…" />}
            >
              <GraphView result={result} />
            </Suspense>
          ) : (
            <GraphPlaceholder
              message={
                isLoading
                  ? "Mapping entities and relations…"
                  : "Your extracted graph will appear here."
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}

function GraphPlaceholder({ message }: { message: string }) {
  return (
    <section className="graph-empty" aria-live="polite">
      <div className="empty-orb" />
      <p>{message}</p>
    </section>
  );
}
