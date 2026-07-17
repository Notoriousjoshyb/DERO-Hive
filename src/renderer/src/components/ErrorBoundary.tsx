import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  name?: string;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.name || 'unknown'}]`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-6 text-center min-h-[120px]">
          <div className="w-10 h-10 rounded-full bg-danger/15 text-danger flex items-center justify-center mb-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M8 5v4M8 11.5v.01" />
              <path d="M7.13 2.5a1 1 0 011.74 0l5.5 9.5a1 1 0 01-.87 1.5H2.5a1 1 0 01-.87-1.5l5.5-9.5z" strokeLinejoin="round" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-fg mb-1">Something went wrong</h3>
          <p className="text-xs text-fg-subtle mb-3 max-w-xs leading-relaxed">
            {this.props.name ? `${this.props.name} ` : ''}{this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 text-xs rounded-lg bg-accent hover:bg-accent-hover text-white transition"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function crash(...args: unknown[]): never {
  console.error(...args);
  throw new Error(args.map(String).join(' '));
}
