import React from 'react';
import { Sunrise, Sun, Sunset, Moon } from 'lucide-react';

const TIME_ICONS = {
  'AM': Sunrise,
  'Afternoon Boost': Sun,
  'Golden Hour': Sunset,
  'Nightcap': Moon,
};

const TIME_COLORS = {
  'AM': 'bg-amber-50 border-amber-200 text-amber-700',
  'Afternoon Boost': 'bg-orange-50 border-orange-200 text-orange-700',
  'Golden Hour': 'bg-rose-50 border-rose-200 text-rose-700',
  'Nightcap': 'bg-indigo-50 border-indigo-200 text-indigo-700',
};

// Hardcoded schedules per program key
const SCHEDULES = {
  radiance: [
    { time: 'AM', label: 'AURA', note: 'Start your morning with a glow boost — drink on an empty stomach.' },
    { time: 'Afternoon Boost', label: 'AURA', note: 'Re-energize mid-day and keep antioxidants flowing.' },
    { time: 'Golden Hour', label: 'OASIS', note: 'Wind down and deeply hydrate as your body starts to recover.' },
    { time: 'Nightcap', label: 'AURA', note: 'One final glow dose to work overnight while you sleep.' },
  ],
  hydration: [
    { time: 'AM', label: 'OASIS', note: 'Kickstart cellular hydration first thing — best before coffee.' },
    { time: 'Afternoon Boost', label: 'OASIS', note: 'Replenish electrolytes lost through the morning.' },
    { time: 'Golden Hour', label: 'AURA', note: 'Layer in antioxidants as the day winds down.' },
    { time: 'Nightcap', label: 'OASIS', note: 'Deep overnight hydration to wake up feeling restored.' },
  ],
  reset: [
    { time: 'AM', label: 'RE-NU', note: 'Cleanse your system first thing — alkalizing and grounding.' },
    { time: 'Afternoon Boost', label: 'RE-NU', note: 'Keep the detox momentum going through the afternoon.' },
    { time: 'Golden Hour', label: 'OASIS', note: 'Hydrate and replenish as your body processes the cleanse.' },
    { time: 'Nightcap', label: 'RE-NU', note: 'Support overnight detoxification and gut reset.' },
  ],
};

export default function ConsumptionSchedule({ programKey, programColor, programBorder }) {
  const schedule = SCHEDULES[programKey];
  if (!schedule) return null;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-5 mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Daily Consumption Guide</p>
      <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
        Follow this schedule each day of your 3-day program for best results. Shake gently before drinking. Best enjoyed chilled.
      </p>
      <div className="space-y-3">
        {schedule.map((item, i) => {
          const Icon = TIME_ICONS[item.time] || Sun;
          const colorClass = TIME_COLORS[item.time] || 'bg-secondary border-border text-foreground';
          return (
            <div key={i} className={`flex gap-3 items-start border rounded-xl p-3 ${colorClass}`}>
              <div className="w-8 h-8 rounded-full bg-white/60 flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{item.time}</p>
                </div>
                <p className="text-sm font-bold">{item.label}</p>
                {item.note && <p className="text-[11px] opacity-75 leading-relaxed mt-0.5">{item.note}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}