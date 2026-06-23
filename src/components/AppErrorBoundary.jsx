import React from 'react';
import { replaceInAppRoute, resetSignInAndReload } from '@/lib/nativeAuthRedirect';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorClassification: null, isResettingSignIn: false };
    this.resetSignInStarted = false;
  }

  static getDerivedStateFromError() {
    return { hasError: true, errorClassification: 'render_error', isResettingSignIn: false };
  }

  componentDidCatch() {
    console.warn('[AppErrorBoundary] App render failed', 'render_error');
  }

  handleTryAgain = () => {
    if (this.state.isResettingSignIn) return;
    this.setState({ hasError: false, errorClassification: null });
  };

  handleReturnHome = () => {
    if (this.state.isResettingSignIn) return;
    replaceInAppRoute('/');
    this.setState({ hasError: false, errorClassification: null });
  };

  handleResetSignIn = () => {
    if (this.resetSignInStarted) return;
    this.resetSignInStarted = true;
    this.setState({ isResettingSignIn: true });
    resetSignInAndReload('/account');
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { isResettingSignIn } = this.state;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6" role="alert" aria-live="assertive">
        <div className="w-full max-w-sm text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-6 h-9 opacity-90" />
          <div className="nuvira-premium-card rounded-3xl p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">App recovery</p>
            <h1 className="font-heading mt-2 text-2xl font-bold">NuVira hit a loading issue</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The app stopped loading safely. It will not keep refreshing or reset your sign-in unless you choose that option.
            </p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={this.handleTryAgain}
                disabled={isResettingSignIn}
                className="nuvira-gradient-button h-11 w-full rounded-2xl text-sm font-semibold"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReturnHome}
                disabled={isResettingSignIn}
                className="h-11 w-full rounded-2xl border border-border bg-card text-sm font-semibold text-foreground"
              >
                Return Home
              </button>
              <button
                type="button"
                onClick={this.handleResetSignIn}
                disabled={isResettingSignIn}
                className="h-11 w-full rounded-2xl border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-900 disabled:opacity-70"
              >
                {isResettingSignIn ? 'Resetting Sign-In…' : 'Reset Sign-In'}
              </button>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              If this keeps happening, contact NuVira support and mention app recovery.
            </p>
          </div>
        </div>
      </div>
    );
  }
}
