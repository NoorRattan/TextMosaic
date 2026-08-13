import { useMemo, useRef, useState } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-3d";
import { CanvasTexture, Sprite, SpriteMaterial } from "three";

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

function createNodeLabel(node: GraphNode): Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return new Sprite();

  const label =
    node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label;
  context.font = '600 42px "DM Sans", sans-serif';
  const width = Math.max(250, Math.ceil(context.measureText(label).width + 76));
  canvas.width = width;
  canvas.height = 82;

  context.font = '600 42px "DM Sans", sans-serif';
  context.fillStyle = "rgba(7, 19, 17, 0.92)";
  context.strokeStyle = node.color;
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(3, 3, width - 6, 76, 18);
  context.fill();
  context.stroke();
  context.fillStyle = "#f3eddf";
  context.fillText(label, 34, 53);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new Sprite(
    new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set((width / 82) * 6.4, 6.4, 1);
  sprite.position.set(0, 8.2, 0);
  return sprite;
}

function toGraphData(result: ExtractResponse): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const allNodes = result.concepts.map((concept, index) => ({
    ...concept,
    color: palette[index % palette.length],
  }));
  const ids = new Set(allNodes.map((node) => node.id));
  const links = result.graphRelations.filter(
    (relation) => ids.has(relation.source) && ids.has(relation.target),
  );
  const connectedIds = new Set(
    links.flatMap((relation) => [relation.source, relation.target]),
  );
  const nodes = links.length
    ? allNodes.filter((node) => connectedIds.has(node.id))
    : allNodes;
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
  const graphRef =
    useRef<
      ForceGraphMethods<NodeObject<object>, LinkObject<object, GraphLink>>
    >(undefined);
  const nodeLabelObject = useMemo(
    () => (node: object) => createNodeLabel(node as GraphNode),
    [],
  );
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
          ref={graphRef}
          graphData={graphData}
          backgroundColor="#0B0F14"
          nodeLabel={(node) => {
            const concept = node as GraphNode;
            return `<strong>${escapeHtml(concept.label)}</strong><br/>${escapeHtml(concept.kind)}`;
          }}
          nodeColor={(node) => (node as GraphNode).color}
          nodeRelSize={5}
          nodeThreeObject={nodeLabelObject}
          nodeThreeObjectExtend
          onNodeClick={(node) => setSelectedId((node as GraphNode).id)}
          linkColor={() => "#FB7185"}
          linkWidth={1.8}
          linkDirectionalArrowLength={3.5}
          linkDirectionalArrowRelPos={1}
          linkLabel={(link) => escapeHtml((link as GraphLink).label)}
          onEngineStop={() => graphRef.current?.zoomToFit(420, 84)}
          showNavInfo={false}
        />
        <p className="graph-canvas-caption">
          <span>{graphData.nodes.length} extracted concepts</span>
          <span>Drag to explore · click a concept for its evidence</span>
        </p>
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
