import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ClearFrame UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-panel" role="alert">
        <h2>{this.props.label ?? 'Something went wrong'}</h2>
        <p>
          Your project data is saved separately and is not affected. You can try again, or go back to the project list.
        </p>
        <pre className="error-panel__detail">{this.state.error.message}</pre>
        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <a className="btn btn--secondary" href="#/">
            Back to projects
          </a>
        </div>
      </div>
    );
  }
}
