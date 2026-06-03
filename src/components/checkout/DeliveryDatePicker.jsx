import React from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarCheck } from 'lucide-react';

/**
 * DeliveryDatePicker
 * Shows available NuVira delivery slots for the customer to choose from.
 * Props:
 *   options: Array from the backend scheduling function
 *   selected: currently selected delivery_date string (YYYY-MM-DD)
 *   onSelect: (option) => void
 */
export default function DeliveryDatePicker({ options, selected, onSelect }) {
  if (!options || options.length === 0) return null;

  return (
    <div className="mx-4 mb-5">
      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Choose Your Delivery Date
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Your juices are made fresh the day before delivery. Available delivery windows are shown below.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {options.map((opt) => {
          const isSelected = selected === opt.delivery_date;
          const displayDate = format(parseISO(opt.delivery_date), 'EEEE, MMMM d');

          return (
            <button
              key={opt.delivery_date}
              type="button"
              onClick={() => onSelect(opt)}
              className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-nuvira-gradient-soft shadow-sm'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <CalendarCheck className={`w-4 h-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                <div>
                  <p className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-foreground'}`}>
                    {displayDate}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{opt.delivery_window_label}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {opt.is_earliest && (
                  <span className="text-[10px] font-semibold bg-nuvira-gradient-soft text-primary border border-nuvira rounded-full px-2 py-0.5">
                    Earliest
                  </span>
                )}
                {isSelected && (
                  <span className="text-[10px] font-semibold text-primary">✓ Selected</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
