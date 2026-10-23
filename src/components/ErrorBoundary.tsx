import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown above the reset button once a child throws. */
  message: string;
  /** Label for the single recovery action. */
  resetLabel: string;
  /** Called right before the boundary re-renders its children — lets the caller also
   * reset whatever app state led into the crash (e.g. close the Inspect tool that was
   * active), so recovery doesn't just retry the exact state that just failed. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * A narrow last resort: this app otherwise has no error boundary anywhere
 * (`InspectPanel.tsx`'s Mass Properties/Measure/Section Properties/Check Geometry
 * sections each call straight into OCCT via an unguarded `useMemo`), so an unexpected
 * throw from a picked-but-momentarily-invalid kernel handle used to unmount the whole
 * panel — including its own Close button and Escape handler — leaving the app looking
 * "stuck". The specific known throw paths are now guarded at the source
 * (`kernel/measure.ts`/`kernel/checkGeometry.ts` return `null` on failure instead), so
 * this exists only to keep anything still-unguarded from taking down more than the one
 * panel it occurred in.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, info.componentStack);
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--font-size-caption)" }}>
            {this.props.message}
          </p>
          <button
            type="button"
            onClick={this.reset}
            style={{
              alignSelf: "flex-start",
              height: 28,
              padding: "0 var(--space-3)",
              border: "1px solid var(--stroke-control)",
              borderRadius: "var(--radius-sm)",
              background: "var(--fill-control)",
              color: "var(--text-primary)",
              fontSize: "var(--font-size-caption)",
            }}
          >
            {this.props.resetLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
