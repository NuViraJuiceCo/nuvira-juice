import React from 'react';
import { Sunrise, Sun, Sunset, Moon, Refrigerator, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { approvedProductMedia } from '@/lib/approved-product-media';
import { DAILY_PROGRAM_SCHEDULES, PROGRAM_BY_KEY, programOptionForDays } from '@/lib/program-catalog';
import './BrowserConsumptionGuide.css';

const TIME_ICONS = { morning: Sunrise, midday: Sun, golden_hour: Sunset, evening: Moon };

export function ProgramGuideDay({ schedule, day, shotName }) {
  return (
    <>
      <div className="nv-guide-pairing" data-has-shot={Boolean(shotName)}>
        <Zap aria-hidden="true" />
        <div>
          <strong>{shotName ? `${shotName} before your morning ${schedule[0].product}` : 'Just your juices today'}</strong>
          <p>{shotName ? `Day ${day} morning pairing. Your selected shot is an optional add-on.` : 'No optional shot selected for this day.'}</p>
        </div>
      </div>
      <ol className="nv-guide-timeline" aria-label={`Day ${day} juice schedule`}>
        {schedule.map((item, index) => {
          const Icon = TIME_ICONS[item.timeKey] || Sun;
          const media = approvedProductMedia({ title: item.product });
          return (
            <li key={item.timeKey} className="nv-guide-stop">
              <div className="nv-guide-stop-heading">
                <span><Icon aria-hidden="true" />{item.time}</span>
                <span className="nv-guide-time">{item.suggestedTime}</span>
              </div>
              <div className="nv-guide-bottle">
                {media && <img src={media.card} alt={media.alt} width="72" height="88" loading="lazy" decoding="async" />}
                <div><span className="nv-guide-bottle-number">Bottle {index + 1}</span><h3>{item.product}</h3><p>1 bottle · 12 oz</p></div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default function BrowserConsumptionGuide({ programKey, days = 3, shotNames = [] }) {
  const program = PROGRAM_BY_KEY[programKey];
  const schedule = DAILY_PROGRAM_SCHEDULES[programKey];
  const option = programOptionForDays(program, days);
  if (!schedule || !option) return null;
  const dailyShots = Array.isArray(shotNames) ? shotNames.slice(0, option.days) : [];

  return (
    <section className="nv-consumption-guide" aria-label="Daily consumption guide">
      <div className="nv-guide-heading">
        <p className="nv-guide-eyebrow">Daily consumption guide</p>
        <h2>Your day, bottle by bottle.</h2>
        <p>Enjoy one juice at each stop. Suggested times are flexible; follow the bottle label and your own needs.</p>
      </div>
      <Tabs key={`${programKey}-${option.days}`} defaultValue="1" className="nv-guide-days">
        <div className="nv-guide-toolbar">
          <TabsList aria-label="Program day" className="nv-guide-day-tabs">
            {Array.from({ length: option.days }, (_, index) => <TabsTrigger key={index} value={String(index + 1)}>Day {index + 1}</TabsTrigger>)}
          </TabsList>
          <p>{schedule.length} juices each day <span>·</span> {option.bottles} total</p>
        </div>
        {Array.from({ length: option.days }, (_, index) => (
          <TabsContent key={index} value={String(index + 1)} className="nv-guide-day">
            <ProgramGuideDay schedule={schedule} day={index + 1} shotName={dailyShots[index]} />
          </TabsContent>
        ))}
      </Tabs>
      <p className="nv-guide-storage"><Refrigerator aria-hidden="true" /><span>Keep refrigerated at 40°F or below. Follow each bottle’s printed date; this guide never extends it.</span></p>
    </section>
  );
}
