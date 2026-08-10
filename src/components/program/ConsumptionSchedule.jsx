import React from 'react';
import { Sunrise, Sun, Sunset, Moon, Refrigerator } from 'lucide-react';
import { DAILY_PROGRAM_SCHEDULES, PROGRAM_BY_KEY } from '@/lib/program-catalog';

const TIME_ICONS = {
  'Morning': Sunrise,
  'Midday': Sun,
  'Golden Hour': Sunset,
  'Evening': Moon,
};

export default function ConsumptionSchedule({ programKey, days = 3, shotName }) {
  const schedule = DAILY_PROGRAM_SCHEDULES[programKey];
  const program = PROGRAM_BY_KEY[programKey];
  if (!schedule || !program) return null;

  return (
    <div className="bg-card border border-border/50 rounded-2xl p-5 mb-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Daily Consumption Guide</p>
      <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
        Repeat for days 1–{days}. Suggested times are a flexible guide; follow the bottle label and your own needs.
      </p>
      <div className="space-y-3">
        {schedule.map((item, i) => {
          const Icon = TIME_ICONS[item.time] || Sun;
          const showShot = item.timeKey === 'morning' && shotName;
          return (
            <div
              key={i}
              className="border rounded-xl p-3"
              style={{
                borderColor: `color-mix(in srgb, ${program.palette.border} 74%, transparent)`,
                backgroundColor: `color-mix(in srgb, ${program.palette.soft} 82%, white)`,
                color: program.palette.ink,
              }}
            >
              <div className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-white/60 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-0.5">{item.time}</p>
                    <p className="text-[10px] font-semibold opacity-60">{item.suggestedTime}</p>
                  </div>
                  {showShot && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-bold bg-white/70 px-2 py-0.5 rounded-full">① {shotName}</span>
                      <span className="text-[10px] opacity-60">then</span>
                    </div>
                  )}
                  <p className="text-sm font-bold">{showShot ? `② ${item.product}` : item.product}</p>
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
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-border/50 bg-secondary/35 p-3">
        <Refrigerator className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Keep refrigerated at 40°F or below. Use the date printed on each bottle; the interactive journey never extends that date.
        </p>
      </div>
    </div>
  );
}
