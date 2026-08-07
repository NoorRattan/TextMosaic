import { Component, type ReactNode } from "react";

interface GraphErrorBoundaryProps {
  children: ReactNode;
}

interface GraphErrorBoundaryState {
  hasError: boolean;
}

export class GraphErrorBoundary extends Component<
  GraphErrorBoundaryProps,
  GraphErrorBoundaryState
> {
  public state: GraphErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): GraphErrorBoundaryState {
    return { hasError: true };
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section className="graph-empty" role="alert">
          The interactive graph could not be rendered. Your extraction remains
          available; try another result or reload the page.
        </section>
      );
    }

    return this.props.children;
  }
}
