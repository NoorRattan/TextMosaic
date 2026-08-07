import ForceGraph3D from "react-force-graph-3d";

import type { ExtractResponse } from "../types";
import { escapeHtml } from "./graphHtml";

interface GraphViewProps {
  result: ExtractResponse;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  color: string;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
}

const entityColor = "#2DD4BF";
const relationColor = "#FB7185";

function toGraphData(result: ExtractResponse): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodes = result.entities.map((entity, index) => ({
    id: String(index),
    label: result.tokens.slice(entity.start, entity.end).join(" "),
    type: entity.type,
    color: entityColor,
  }));
  const links = result.relations
    .filter(
      (relation) =>
        nodes[relation.head] !== undefined &&
        nodes[relation.tail] !== undefined,
    )
    .map((relation) => ({
      source: String(relation.head),
      target: String(relation.tail),
      label: relation.type.replaceAll("_", " "),
    }));
  return { nodes, links };
}

export default function GraphView({ result }: GraphViewProps) {
  const graphData = toGraphData(result);
  if (graphData.nodes.length === 0) {
    return (
      <section className="graph-empty">
        No entities were found in this text.
      </section>
    );
  }

  return (
    <section
      className="graph-canvas"
      aria-label="Interactive 3D entity relation graph"
    >
      <ForceGraph3D
        graphData={graphData}
        backgroundColor="#0B0F14"
        nodeLabel={(node) =>
          `<strong>${escapeHtml((node as GraphNode).label)}</strong><br/>${escapeHtml((node as GraphNode).type)}`
        }
        nodeColor={(node) => (node as GraphNode).color}
        nodeRelSize={5}
        linkColor={() => relationColor}
        linkWidth={1.5}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkLabel={(link) => escapeHtml((link as GraphLink).label)}
        showNavInfo={false}
      />
    </section>
  );
}
