import { useMemo, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";

import type { Concept, ExtractResponse, GraphRelation } from "../types";
import { escapeHtml } from "./graphHtml";

interface GraphViewProps {
  result: ExtractResponse;
}

interface GraphNode extends Concept {
  color: string;
}

interface GraphLink extends GraphRelation {
  source: string;
  target: string;
}

const palette = ["#2DD4BF", "#FBBF24", "#FB7185", "#A78BFA", "#60A5FA"];

function toGraphData(result: ExtractResponse): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodes = result.concepts.map((concept, index) => ({
    ...concept,
    color: palette[index % palette.length],
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const links = result.graphRelations.filter(
    (relation) => ids.has(relation.source) && ids.has(relation.target),
  );
  return { nodes, links };
}

function modelSignalLabel(confidence: number): string {
  if (confidence >= 0.8) return "named-entity signal";
  if (confidence >= 0.55) return "local graph signal";
  return "local relationship signal";
}

function ConceptDetail({ concept }: { concept: GraphNode }) {
  return (
    <aside
      className="concept-detail"
      aria-live="polite"
      aria-label="Selected concept details"
    >
      <p className="detail-kicker">Selected concept / {concept.kind}</p>
      <h3>{concept.label}</h3>
      <p className="detail-explanation">{concept.explanation}</p>
      <span className="confidence-chip">
        {modelSignalLabel(concept.confidence)}
      </span>
      <blockquote>{concept.evidence[0]?.quote}</blockquote>
    </aside>
  );
}

export default function GraphView({ result }: GraphViewProps) {
  const graphData = useMemo(() => toGraphData(result), [result]);
  const [selectedId, setSelectedId] = useState<string | null>(
    graphData.nodes[0]?.id ?? null,
  );
  const selected =
    graphData.nodes.find((node) => node.id === selectedId) ??
    graphData.nodes[0];

  if (graphData.nodes.length === 0) {
    return (
      <section className="graph-empty">
        <p>{result.analysis.notice}</p>
      </section>
    );
  }

  return (
    <section className="knowledge-map" aria-label="Interactive knowledge map">
      <div className="analysis-notice" data-coverage={result.analysis.coverage}>
        <span>
          {result.analysis.mode === "document"
            ? "Local document map"
            : "Focused relation map"}
        </span>
        <p>{result.analysis.notice}</p>
      </div>
      <div className="graph-canvas" aria-label="Interactive 3D concept graph">
        <ForceGraph3D
          graphData={graphData}
          backgroundColor="#0B0F14"
          nodeLabel={(node) => {
            const concept = node as GraphNode;
            return `<strong>${escapeHtml(concept.label)}</strong><br/>${escapeHtml(concept.kind)}`;
          }}
          nodeColor={(node) => (node as GraphNode).color}
          nodeRelSize={5}
          onNodeClick={(node) => setSelectedId((node as GraphNode).id)}
          linkColor={() => "#FB7185"}
          linkWidth={1.8}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link) => escapeHtml((link as GraphLink).label)}
          showNavInfo={false}
        />
      </div>
      <div className="map-inspector">
        <section className="concept-list" aria-label="Concepts in this map">
          <p className="detail-kicker">Concepts / click to explain</p>
          <div>
            {graphData.nodes.map((node) => (
              <button
                className={
                  node.id === selected?.id
                    ? "concept-button selected"
                    : "concept-button"
                }
                key={node.id}
                type="button"
                onClick={() => setSelectedId(node.id)}
              >
                <i style={{ background: node.color }} />
                <span>{node.label}</span>
                <small>{node.kind}</small>
              </button>
            ))}
          </div>
        </section>
        {selected ? <ConceptDetail concept={selected} /> : null}
      </div>
      <section className="relation-list" aria-label="Labeled relationships">
        <p className="detail-kicker">Labeled relationships</p>
        {graphData.links.length ? (
          <ul>
            {graphData.links.map((relation, index) => {
              const source = graphData.nodes.find(
                (node) => node.id === relation.source,
              );
              const target = graphData.nodes.find(
                (node) => node.id === relation.target,
              );
              return (
                <li
                  key={`${relation.source}-${relation.target}-${relation.label}-${index}`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(relation.source)}
                  >
                    {source?.label}
                  </button>
                  <span>{relation.label}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedId(relation.target)}
                  >
                    {target?.label}
                  </button>
                  <small title={relation.explanation}>
                    {relation.evidence[0]?.quote}
                  </small>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="no-links">
            No directly supported relationships were found between these
            concepts.
          </p>
        )}
      </section>
    </section>
  );
}
