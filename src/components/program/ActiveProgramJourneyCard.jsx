import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { invokeCustomerGateway } from '@/api/base44Client';
import { PROGRAM_BY_KEY } from '@/lib/program-catalog';

export default function ActiveProgramJourneyCard({ enabled }) {
  const { data } = useQuery({
    queryKey: ['program-journeys'],
    queryFn: async () => (await invokeCustomerGateway('manageProgramJourney', { action: 'list' })).data,
    enabled,
    staleTime: 60 * 1000,
  });
  const journeys = data?.journeys || [];
  const journey = journeys.find((row) => row.status === 'in_progress')
    || journeys.find((row) => row.status === 'ready')
    || null;
  if (!journey) return null;

  const program = PROGRAM_BY_KEY[journey.program_key] || PROGRAM_BY_KEY.hydration;
  const progress = Math.round((Number(journey.completed_steps || 0) / Math.max(1, Number(journey.total_steps || 12))) * 100);
  return (
    <div className="mx-5 mt-5">
      <Link
        to={`/account/programs/${encodeURIComponent(journey.id)}`}
        className="relative block overflow-hidden rounded-3xl border shadow-[0_14px_40px_rgba(14,35,27,0.14)] active:scale-[0.985] transition-transform"
        style={{ borderColor: program.palette.border, background: `linear-gradient(135deg, ${program.palette.ink}, ${program.palette.primary})` }}
      >
        <img src={journey.program_image_url || program.image} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-25 ${program.imagePosition}`} />
        <div className="relative p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.17em] text-white/65">
              {journey.status === 'ready' ? <Sparkles className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {journey.status === 'ready' ? 'Delivered · ready to begin' : 'Program in progress'}
            </div>
            <span className="text-[10px] font-black">{progress}%</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <div><p className="font-heading text-2xl font-bold">{journey.program_name}</p><p className="mt-0.5 text-[10px] text-white/65">{journey.status === 'ready' ? 'Choose your start date' : `${journey.completed_steps} of ${journey.total_steps} moments complete`}</p></div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10"><ArrowRight className="h-4 w-4" /></span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: program.palette.glow }} /></div>
        </div>
      </Link>
    </div>
  );
}

