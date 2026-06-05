import React from 'react';

const LOGO_URL = 'https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn('[AppErrorBoundary] App render failed', error?.message || 'unknown_error');
  }

  handleTryAgain = () => {
    this.setState({ hasError: false });
  };

  handleResetSession = () => {
    try {
      window.sessionStorage?.removeItem('splashShown');
      window.sessionStorage?.clear();
    } catch {
      // Storage can be unavailable in restricted contexts.
    }

    try {
      if (window.location.pathname !== '/') {
        window.history.replaceState({}, '', '/');
      }
    } catch {
      // History can be unavailable in restricted contexts.
    }

    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-6 h-9 opacity-90" />
          <div className="nuvira-premium-card rounded-3xl p-5">
            <h1 className="font-heading text-2xl font-bold">NuVira needs a quick reset</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The app hit a loading issue, but it will not keep refreshing. Try again or reset this app session.
            </p>
            <button
              type="button"
              onClick={this.handleTryAgain}
              className="nuvira-gradient-button mt-5 h-11 w-full rounded-2xl text-sm font-semibold"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleResetSession}
              className="mt-3 h-11 w-full rounded-2xl border border-border bg-card text-sm font-semibold text-foreground"
            >
              Reset App Session
            </button>
          </div>
        </div>
      </div>
    );
  }
}
