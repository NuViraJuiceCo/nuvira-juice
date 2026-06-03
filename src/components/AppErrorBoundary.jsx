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

  handleReload = () => {
    try {
      window.sessionStorage?.removeItem('splashShown');
    } catch {
      // Storage can be unavailable in restricted contexts.
    }
    window.location.replace('/');
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company" className="mx-auto mb-6 h-9 opacity-90" />
          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <h1 className="font-heading text-2xl font-bold">Refresh Needed</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The app hit a loading issue. Refreshing will reopen NuVira from a clean home state.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-5 h-11 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              Reopen App
            </button>
          </div>
        </div>
      </div>
    );
  }
}
