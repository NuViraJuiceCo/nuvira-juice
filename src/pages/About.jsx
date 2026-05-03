import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Leaf, Heart, Sparkles, MapPin } from 'lucide-react';
import SEO from '@/components/SEO';
import { motion } from 'framer-motion';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";
const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/801123d05_DSC02744.jpg";

const values = [
  { icon: Leaf, title: 'Cold-Pressed Purity', body: 'We never heat, dilute, or compromise our juice. Every bottle is cold-pressed to preserve the living nutrients your body craves.' },
  { icon: Heart, title: 'Made with Intention', body: 'Small-batch crafted in St. Louis. Every juice is made to order — never sitting on a shelf waiting for you.' },
  { icon: Sparkles, title: 'Real Ingredients Only', body: 'No fillers. No preservatives. No shortcuts. Just clean, nutrient-dense produce pressed fresh for every order.' },
  { icon: MapPin, title: 'STL Roots', body: 'Born and built in St. Louis. NuVira is a local wellness movement growing one fresh bottle at a time.' },
];

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="About NuVira Juice Co."
        description="NuVira Juice Co. is a cold-pressed juice company based in Wentzville, MO delivering fresh, small-batch juices to the St. Louis area. Learn who we are, what we make, and why we do it."
        image={TRIO_URL}
      />

      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Our Story</span>
      </div>

      {/* Hero Image */}
      <div className="relative h-56 overflow-hidden">
        <img src={TRIO_URL} alt="NuVira cold-pressed juices" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/60 to-primary/90" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <img src={LOGO_URL} alt="NuVira Juice Company logo" className="w-36 mb-2 drop-shadow-lg" />
          <p className="text-primary-foreground/90 text-sm font-light tracking-wide">Real. Living. Nutrition.</p>
        </div>
      </div>

      <div className="px-5 py-8 space-y-10 max-w-2xl mx-auto">

        {/* Main About Content */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <h1 className="font-heading text-2xl font-bold mb-4 text-foreground">
            About NuVira Juice Co.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            NuVira Juice Co. is a cold-pressed juice company headquartered in Wentzville, Missouri, proudly serving the greater St. Louis area including O'Fallon, St. Charles, and surrounding communities. We built NuVira on a single, powerful belief: true wellness starts with real, living nutrition — not supplements, not shortcuts, and definitely not juice that has been sitting on a shelf for weeks.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            Every bottle we make is cold-pressed fresh, in small batches, to order. That means the moment you place your order, we get to work sourcing and pressing whole fruits and vegetables at their peak nutritional value. No high-pressure processing. No added sugars. No fillers. Just pure juice crafted with intention and delivered straight to your door.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            NuVira is built for people who take their health seriously and want a convenient, trustworthy way to fuel their body with the best nature has to offer. Whether you're looking for a daily wellness ritual, a 3-day juice program to reset and recharge, or a flexible subscription that keeps fresh juice coming to your door every week — NuVira has you covered.
          </p>
        </motion.section>

        {/* Values */}
        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="font-heading text-lg font-semibold mb-4">The NuVira Way</h2>
          <div className="grid grid-cols-1 gap-4">
            {values.map(({ icon: IconComp, title, body }) => (
              <div key={title} className="flex gap-4 p-4 bg-secondary/50 rounded-2xl border border-border/40">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                  <IconComp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm mb-1">{title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Lifestyle Photo Strip */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="grid grid-cols-3 gap-2 rounded-2xl overflow-hidden"
        >
          {[
            'https://media.base44.com/images/public/69d48d0c39891f7945481152/9a762c75e_DSC02687.jpg',
            'https://media.base44.com/images/public/69d48d0c39891f7945481152/b070984a9_DSC02698.jpg',
            'https://media.base44.com/images/public/69d48d0c39891f7945481152/80af61b53_DSC02560.jpg',
          ].map((url, i) => (
            <div key={i} className="aspect-square overflow-hidden rounded-xl">
              <img src={url} alt="NuVira lifestyle" className="w-full h-full object-cover" loading="lazy" />
            </div>
          ))}
        </motion.section>

        {/* Brand Promise */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-gradient-to-br from-primary to-primary/80 rounded-2xl p-6 text-center"
        >
          <div className="relative rounded-xl overflow-hidden mb-4" style={{ height: '180px' }}>
            <img
              src="https://media.base44.com/images/public/69d48d0c39891f7945481152/19cc41d64_DSC02565.jpg"
              alt="NuVira community lifestyle"
              className="w-full h-full object-cover"
            />
          </div>
          <p className="font-heading text-xl font-bold text-primary-foreground mb-2">More Than Juice.</p>
          <p className="text-primary-foreground/80 text-sm leading-relaxed">
            NuVira is a lifestyle and a movement. We're building a community of people committed to elevating everyday wellness — one intentional choice at a time.
          </p>
        </motion.section>

        {/* CTA Links */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex flex-col gap-3 pb-4">
          <Link to="/shop" className="w-full h-12 rounded-xl font-semibold text-sm bg-primary text-primary-foreground flex items-center justify-center">
            Shop the Collection
          </Link>
          <Link to="/contact" className="w-full h-12 rounded-xl font-semibold text-sm border border-border flex items-center justify-center text-foreground">
            Contact Us
          </Link>
        </motion.div>
      </div>
    </div>
  );
}