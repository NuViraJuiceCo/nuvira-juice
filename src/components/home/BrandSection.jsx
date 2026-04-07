import React from 'react';
import { Leaf, Heart, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const values = [
  { icon: Leaf, title: 'Cold-Pressed', desc: '100% raw, never heated' },
  { icon: Heart, title: 'Made with Love', desc: 'Small-batch crafted' },
  { icon: Sparkles, title: 'Always Fresh', desc: 'Made to order' },
];

export default function BrandSection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mx-4 mt-8 mb-4"
    >
      <div className="bg-gradient-to-br from-secondary to-secondary/50 rounded-2xl p-5">
        <h3 className="font-heading text-base font-semibold text-center mb-4">
          The NuVira Difference
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {values.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="text-center">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xs font-medium">{title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}