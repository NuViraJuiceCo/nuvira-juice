import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { CheckCircle2, ArrowRight, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";

const STEPS = [
  {
    key: 'juice_experience',
    type: 'single',
    question: "What's your juice journey?",
    subtitle: "Help us understand where you're starting from.",
    options: [
      { value: 'new', label: "I'm new to cold-pressed", emoji: '🌱' },
      { value: 'occasional', label: 'I juice occasionally', emoji: '🍊' },
      { value: 'weekly', label: 'Part of my weekly routine', emoji: '💪' },
      { value: 'daily', label: 'I live the juice life', emoji: '⚡' },
    ],
  },
  {
    key: 'wellness_goals',
    type: 'multi',
    question: 'What are your wellness goals?',
    subtitle: 'Select all that apply — we\'ll tailor your experience.',
    options: [
      { value: 'energy', label: 'Boost Energy', emoji: '⚡' },
      { value: 'detox', label: 'Detox & Cleanse', emoji: '🌿' },
      { value: 'immunity', label: 'Strengthen Immunity', emoji: '🛡️' },
      { value: 'digestion', label: 'Support Digestion', emoji: '🌀' },
      { value: 'glow', label: 'Skin Glow', emoji: '✨' },
      { value: 'weight', label: 'Weight Management', emoji: '⚖️' },
    ],
  },
  {
    key: 'flavor_preferences',
    type: 'multi',
    question: 'What flavors speak to you?',
    subtitle: 'We\'ll highlight the blends you\'ll love most.',
    options: [
      { value: 'citrus', label: 'Citrus & Bright', emoji: '🍋' },
      { value: 'green', label: 'Clean & Green', emoji: '🥬' },
      { value: 'tropical', label: 'Tropical & Sweet', emoji: '🍍' },
      { value: 'spicy', label: 'Bold & Spicy', emoji: '🌶️' },
      { value: 'earthy', label: 'Root & Earthy', emoji: '🪨' },
      { value: 'berry', label: 'Berry & Rich', emoji: '🫐' },
    ],
  },
  {
    key: 'drink_time',
    type: 'single',
    question: 'When do you usually drink?',
    subtitle: 'We\'ll suggest the best blends for your routine.',
    options: [
      { value: 'morning', label: 'Morning ritual', emoji: '🌅' },
      { value: 'afternoon', label: 'Afternoon reset', emoji: '☀️' },
      { value: 'post_workout', label: 'Post-workout', emoji: '🏃' },
      { value: 'anytime', label: 'Whenever I need it', emoji: '🕐' },
    ],
  },
];

export default function OnboardingQuiz({ onComplete }) {
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const current = STEPS[step];

  const toggle = (key, value, type) => {
    if (type === 'single') {
      setAnswers(a => ({ ...a, [key]: value }));
    } else {
      setAnswers(a => {
        const arr = a[key] || [];
        return {
          ...a,
          [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
        };
      });
    }
  };

  const isSelected = (key, value) => {
    const v = answers[key];
    return Array.isArray(v) ? v.includes(value) : v === value;
  };

  const canNext = () => {
    const v = answers[current.key];
    if (current.type === 'single') return !!v;
    return Array.isArray(v) && v.length > 0;
  };

  const handleNext = async () => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
      return;
    }
    // Save
    setSaving(true);
    await base44.entities.UserProfile.create({
      customer_email: user.email,
      ...answers,
      onboarding_complete: true,
    });
    setSaving(false);
    setDone(true);
    setTimeout(() => onComplete(), 1800);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-50 bg-primary flex flex-col items-center justify-center px-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <CheckCircle2 className="w-16 h-16 text-white mb-4" />
        </motion.div>
        <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="font-heading text-2xl font-bold text-white mb-2">You're all set!</motion.h2>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          className="text-primary-foreground/80 text-sm">Your NuVira experience is personalized.</motion.p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 pt-10 pb-4 bg-primary">
        <img src={LOGO_URL} alt="NuVira" className="h-6 brightness-0 invert opacity-90 mb-4" />
        <div className="flex gap-1.5 mb-4">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 rounded-full flex-1 transition-all duration-500 ${i <= step ? 'bg-white' : 'bg-white/30'}`} />
          ))}
        </div>
        <p className="text-primary-foreground/70 text-xs mb-1">Step {step + 1} of {STEPS.length}</p>
        <AnimatePresence mode="wait">
          <motion.h1
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="font-heading text-xl font-bold text-white leading-tight"
          >
            {current.question}
          </motion.h1>
        </AnimatePresence>
        <p className="text-primary-foreground/70 text-xs mt-1">{current.subtitle}</p>
      </div>

      {/* Button - Sticky */}
      <div className="sticky top-0 bg-gradient-to-b from-background to-transparent px-4 pt-4 pb-3 z-10">
        <Button
          onClick={handleNext}
          disabled={!canNext() || saving}
          className="w-full h-11 rounded-xl font-semibold text-sm"
        >
          {saving ? 'Saving...' : step === STEPS.length - 1 ? (
            <>
              <Leaf className="w-4 h-4 mr-2" />
              Start My Journey
            </>
          ) : (
            <>
              Next
              <ArrowRight className="w-4 h-4 ml-1" />
            </>
          )}
        </Button>
      </div>

      {/* Options */}
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-2 gap-3"
          >
            {current.options.map((opt, i) => {
              const selected = isSelected(current.key, opt.value);
              return (
                <motion.button
                  key={opt.value}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => toggle(current.key, opt.value, current.type)}
                  className={`p-4 rounded-2xl border-2 text-left transition-all active:scale-95 ${
                    selected
                      ? 'bg-primary border-primary text-primary-foreground shadow-lg'
                      : 'bg-card border-border text-foreground'
                  }`}
                >
                  <span className="text-2xl block mb-2">{opt.emoji}</span>
                  <p className="text-xs font-semibold leading-tight">{opt.label}</p>
                </motion.button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}