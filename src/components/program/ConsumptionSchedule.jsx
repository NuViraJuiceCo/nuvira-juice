import React from 'react';
import { Sunrise, Sun, Sunset, Moon } from 'lucide-react';

const TIME_ICONS = {
  'AM': Sunrise,
  'Afternoon Boost': Sun,
  'Golden Hour': Sunset,
  'Nightcap': Moon,
};

const TIME_COLORS = {
  'AM': 'bg-cyan-50 border-cyan-200 text-cyan-700',
  'Afternoon Boost': 'bg-orange-50 border-orange-200 text-orange-700',
  'Golden Hour': 'bg-rose-50 border-rose-200 text-rose-700',
  'Nightcap': 'bg-indigo-50 border-indigo-200 text-indigo-700',
};

// Hardcoded schedules per program key
const SCHEDULES = {
  radiance: [
    { time: 'AM', label: 'AURA', shotBefore: true },
    { time: 'Afternoon Boost', label: 'OASIS' },
    { time: 'Golden Hour', label: 'AURA' },
    { time: 'Nightcap', label: 'AURA' },
  ],
  hydration: [
    { time: 'AM', label: 'OASIS', shotBefore: true },
    { time: 'Afternoon Boost', label: 'AURA' },
    { time: 'Golden Hour', label: 'OASIS' },
    { time: 'Nightcap', label: 'OASIS' },
  ],
  reset: [
    { time: 'AM', label: 'RE-NU', shotBefore: true },
    { time: 'Afternoon Boost', label: 'OASIS' },
    { time: 'Golden Hour', label: 'RE-NU' },
    { time: 'Nightcap', label: 'RE-NU' },
  ],
};

export default function ConsumptionSchedule({ programKey, shotName }) {
  const schedule = SCHEDULES[programKey];
  if (!schedule) return null;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-5 mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Daily Consumption Guide</p>
      <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
        Days 1–3 · Shake gently before drinking · Best enjoyed chilled.
      </p>
      <div className="space-y-3">
        {schedule.map((item, i) => {
          const Icon = TIME_ICONS[item.time] || Sun;
          const colorClass = TIME_COLORS[item.time] || 'bg-secondary border-border text-foreground';
          const showShot = item.shotBefore && shotName;
          return (
            <div key={i} className={`border rounded-xl p-3 ${colorClass}`}>
              <div className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-white/60 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">{item.time}</p>
                  {showShot && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold bg-white/70 px-2 py-0.5 rounded-full">① {shotName}</span>
                      <span className="text-[10px] opacity-60">then</span>
                    </div>
                  )}
                  <p className="text-sm font-bold">{showShot ? `② ${item.label}` : item.label}</p>
                  {showShot && (
                    <p className="text-[10px] opacity-65 mt-0.5">Take your shot first, then follow with your juice.</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {shotName && (
        <p className="text-[10px] text-muted-foreground mt-3 text-center italic">
          * {shotName} should always be taken before your AM juice.
        </p>
      )}
    </div>
  );
}