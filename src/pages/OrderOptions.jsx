import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, Clock3, Droplets, RefreshCcw, ShieldCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { unwrapBase44Result } from '@/lib/base44-result';

const VALID_CHOICES = new Set(['full_order_saturday', 'oasis_saturday', 'oasis_refund']);

function parseError(error, fallback) {
  const message = error?.response?.data?.error || error?.message || fallback;
  if (['invalid_or_expired_link', 'invalid_selection'].includes(message)) {
    return 'This order-update link is invalid or has expired. Please contact NuVira support.';
  }
  if (message === 'selection_already_recorded') {
    return 'A different option was already confirmed for this order. Please contact NuVira if it needs to change.';
  }
  return fallback;
}

function ChoiceIcon({ id }) {
  if (id === 'full_order_saturday') return <Droplets className="h-5 w-5" />;
  if (id === 'oasis_saturday') return <CalendarDays className="h-5 w-5" />;
  return <RefreshCcw className="h-5 w-5" />;
}

export default function OrderOptions() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const suggestedChoice = searchParams.get('choice') || '';
  const [request, setRequest] = useState(null);
  const [selectedChoice, setSelectedChoice] = useState(
    VALID_CHOICES.has(suggestedChoice) ? suggestedChoice : '',
  );
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const selectedOption = useMemo(
    () => request?.choices?.find((choice) => choice.id === selectedChoice) || null,
    [request, selectedChoice],
  );

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) {
        setStatus('error');
        setError('This order-update link is incomplete. Please contact NuVira support.');
        return;
      }
      setStatus('loading');
      try {
        const response = await base44.functions.invoke('processManualRefund', {
          action: 'get_customer_order_adjustment',
          token,
        });
        const data = unwrapBase44Result(response);
        if (!active) return;
        if (!data?.success || !data.request) throw new Error(data?.error || 'request_unavailable');
        setRequest(data.request);
        if (data.request.selected_choice) setSelectedChoice(data.request.selected_choice);
        setStatus(data.request.request_state === 'completed'
          ? 'complete'
          : (data.request.selected_choice ? 'retry' : 'ready'));
      } catch (loadError) {
        if (!active) return;
        setStatus('error');
        setError(parseError(loadError, 'We could not load your order options. Please try again.'));
      }
    }
    load();
    return () => { active = false; };
  }, [token]);

  async function submitChoice() {
    if (!selectedChoice || status === 'submitting') return;
    setStatus('submitting');
    setError('');
    try {
      const response = await base44.functions.invoke('processManualRefund', {
        action: 'submit_customer_order_adjustment',
        token,
        choice: selectedChoice,
      });
      const data = unwrapBase44Result(response);
      if (!data?.success || !data.request) throw new Error(data?.error || 'selection_failed');
      setRequest(data.request);
      setSelectedChoice(data.request.selected_choice);
      setStatus(data.request.request_state === 'completed' ? 'complete' : 'retry');
    } catch (submitError) {
      const failureRequest = submitError?.response?.data?.request;
      if (failureRequest?.selected_choice) {
        setRequest(failureRequest);
        setSelectedChoice(failureRequest.selected_choice);
        setStatus('retry');
        setError('Your choice is securely recorded, but the operational update did not finish. Please retry the same selection.');
      } else {
        setStatus(request?.selected_choice ? 'retry' : 'ready');
        setError(parseError(submitError, 'Your choice was not saved. Please try again before closing this page.'));
      }
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#edf4ee] text-[#122019] dark:bg-[#08110c] dark:text-white">
      <header className="border-b border-[#ccdbcf] bg-[#0c1b13] px-5 py-5 text-white dark:border-white/10">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <img src="/icons/nuviraappv2.png" alt="NuVira Juice Co." className="h-11 w-11 rounded-lg object-cover" />
          <div>
            <p className="text-sm font-bold">NuVira Juice Co.</p>
            <p className="text-xs text-white/65">Order update</p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
        {status === 'loading' && (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center" aria-live="polite">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#159947]/20 border-t-[#159947]" />
            <p className="text-sm font-semibold text-[#526157] dark:text-white/65">Loading your order options...</p>
          </div>
        )}

        {status === 'error' && (
          <section className="rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900/50 dark:bg-[#111a14]">
            <h1 className="font-heading text-2xl font-bold">We could not open this order update</h1>
            <p className="mt-3 text-sm leading-relaxed text-[#58645d] dark:text-white/65">{error}</p>
            <a href="mailto:support@nuvirajuice.com" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-[#159947] px-5 text-sm font-bold text-white">Contact NuVira</a>
          </section>
        )}

        {request && status !== 'loading' && status !== 'error' && (
          <>
            <section className="border-b border-[#cbd9ce] pb-6 dark:border-white/10">
              <p className="text-xs font-bold uppercase tracking-widest text-[#167f3c] dark:text-[#61d786]">Order {request.order_number}</p>
              <h1 className="mt-2 font-heading text-3xl font-bold leading-tight sm:text-4xl">
                {status === 'complete' ? 'Your choice is confirmed' : `Hi ${request.customer_first_name}, choose what works best`}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#526157] dark:text-white/65 sm:text-base">
                {status === 'complete'
                  ? 'NuVira operations has received your selection. We will follow this choice when preparing and fulfilling your order.'
                  : status === 'retry'
                    ? 'Your choice is securely recorded, but one operational update still needs to finish. Use the button below to retry the same selection safely.'
                    : 'To make sure every item meets our freshness and quality standards, OASIS needs a timing adjustment. Nothing changes until you confirm one option below.'}
              </p>
            </section>

            {status === 'complete' ? (
              <section className="mt-6 rounded-lg border border-[#a8d4b2] bg-white p-5 shadow-sm dark:border-[#245f36] dark:bg-[#111a14]" aria-live="polite">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dff3e4] text-[#137e39] dark:bg-[#143923] dark:text-[#78e39a]"><Check className="h-5 w-5" /></span>
                  <div>
                    <p className="font-bold">{selectedOption?.label || 'Selection received'}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#526157] dark:text-white/65">{selectedOption?.description}</p>
                  </div>
                </div>
                <p className="mt-5 border-t border-[#e1e9e3] pt-4 text-xs leading-relaxed text-[#68746c] dark:border-white/10 dark:text-white/55">
                  Need to change this selection? Contact support@nuvirajuice.com before production begins.
                </p>
              </section>
            ) : (
              <>
                <aside className="mt-6 border-l-4 border-[#159947] bg-[#e0f2e4] px-4 py-4 dark:bg-[#11301d]">
                  <div className="flex items-start gap-3">
                    <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-[#147a38] dark:text-[#73dc91]" />
                    <div>
                      <p className="text-sm font-bold">Freshness-first recommendation</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#3f5948] dark:text-white/70">
                        Producing the complete order {request.target_production_label} and delivering it together {request.target_delivery_label} keeps every juice in one fresh delivery. The final choice is entirely yours.
                      </p>
                    </div>
                  </div>
                </aside>

                <fieldset className="mt-6 space-y-3">
                  <legend className="sr-only">Choose an order update</legend>
                  {request.choices?.map((choice) => {
                    const checked = selectedChoice === choice.id;
                    return (
                      <label
                        key={choice.id}
                        className={`block cursor-pointer rounded-lg border bg-white p-4 transition dark:bg-[#111a14] ${checked ? 'border-[#159947] ring-2 ring-[#159947]/20 dark:border-[#58d37c]' : 'border-[#ccd8cf] hover:border-[#78ad85] dark:border-white/15 dark:hover:border-white/30'}`}
                      >
                        <input
                          type="radio"
                          name="order-choice"
                          value={choice.id}
                          checked={checked}
                          onChange={() => setSelectedChoice(choice.id)}
                          disabled={status === 'retry' && selectedChoice !== choice.id}
                          className="sr-only"
                        />
                        <div className="flex items-start gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${checked ? 'bg-[#159947] text-white' : 'bg-[#edf4ee] text-[#34533f] dark:bg-white/10 dark:text-white/75'}`}>
                            <ChoiceIcon id={choice.id} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold">{choice.label}</p>
                              {choice.recommended && <span className="rounded-full bg-[#dff3e4] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#147a38] dark:bg-[#143923] dark:text-[#77df96]">Recommended</span>}
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-[#5a675f] dark:text-white/60">{choice.description}</p>
                          </div>
                          <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${checked ? 'border-[#159947] bg-[#159947] text-white' : 'border-[#9cac9f] dark:border-white/35'}`}>
                            {checked && <Check className="h-3.5 w-3.5" />}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </fieldset>

                {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200" role="alert">{error}</p>}

                <button
                  type="button"
                  onClick={submitChoice}
                  disabled={!selectedChoice || status === 'submitting'}
                  className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-[#159947] px-5 text-sm font-bold text-white transition hover:bg-[#11813b] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {status === 'submitting' ? 'Confirming...' : (status === 'retry' ? 'Finish my confirmed update' : 'Confirm my choice')}
                </button>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-[#68746c] dark:text-white/50">
                  <ShieldCheck className="h-4 w-4" />
                  Secure order-specific link
                  <span aria-hidden="true">·</span>
                  <Clock3 className="h-4 w-4" />
                  One confirmed choice
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
