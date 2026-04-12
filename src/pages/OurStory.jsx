import React from 'react';
import SEO from '@/components/SEO';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Leaf, Heart, Sparkles, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LOGO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/b04d63077_Asset18322x.png";
const TRIO_URL = "https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg";

const values = [
  { icon: Leaf, title: 'Cold-Pressed Purity', body: 'We never heat, dilute, or compromise our juice. Every bottle is cold-pressed to preserve the living nutrients your body craves.' },
  { icon: Heart, title: 'Made with Intention', body: 'Small-batch crafted in St. Louis. Every juice is made to order — never sitting on a shelf waiting for you.' },
  { icon: Sparkles, title: 'Real Ingredients Only', body: 'No fillers. No preservatives. No shortcuts. Just clean, nutrient-dense produce pressed fresh for every order.' },
  { icon: MapPin, title: 'STL Roots', body: 'Born and built in St. Louis. NuVira is a local wellness movement growing one fresh bottle at a time.' },
];

export default function OurStory() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Our Story"
        description="NuVira Juice Company was built on real, living nutrition. Cold-pressed in St. Louis, made to order, no compromises. Learn our story."
        image="https://media.base44.com/images/public/69d48d0c39891f7945481152/99e225ed4_DSC02438-Edit-2.jpg"
      />
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/40 flex items-center gap-3 px-4 py-3">
        <Link to="/account">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <span className="font-heading text-base font-semibold">Our Story</span>
      </div>

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative"
      >
        <div className="relative h-64 overflow-hidden">
          <img
            src={TRIO_URL}
            alt="NuVira Juices"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-primary/60 to-primary/90" />
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <img src={LOGO_URL} alt="NuVira Juice Company" className="w-40 mb-3 drop-shadow-lg" />
            <p className="text-primary-foreground/90 text-sm font-light tracking-wide">
              Real. Living. Nutrition.
            </p>
          </div>
        </div>
      </motion.div>

      <div className="px-5 py-8 space-y-10">
        {/* Origin Story */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <h2 className="font-heading text-2xl font-bold mb-4 text-foreground">
            We Believe Wellness Starts<br />With What You Put In.
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed mb-3">
            NuVira Juice Company was built on a simple but powerful belief: true wellness begins with real, living nutrition. Not supplements. Not shortcuts. Real produce, cold-pressed fresh, and delivered to you at the peak of its nutritional power.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We started in St. Louis with a commitment to doing things the right way — small batches, intentional ingredients, made to order. No sitting on shelves. No compromises. Just pure juice crafted for people who take their wellness seriously.
          </p>
        </motion.section>

        {/* Values Grid */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <h3 className="font-heading text-lg font-semibold mb-4">The NuVira Way</h3>
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

        {/* Brand Promise */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-gradient-to-br from-primary to-primary/80 rounded-2xl p-6 text-center"
        >
          <p className="font-heading text-xl font-bold text-primary-foreground mb-2">
            More Than Juice.
          </p>
          <p className="text-primary-foreground/80 text-sm leading-relaxed">
            NuVira is a lifestyle and a movement. We're building a community of people committed to elevating everyday wellness — one intentional choice at a time.
          </p>
        </motion.section>

        {/* Customer Reviews */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <h3 className="font-heading text-lg font-semibold mb-4">What People Are Saying</h3>
          <div className="space-y-4">
            {[
              {
                name: 'Jesse Kahlon',
                review: "NuVira Juice Co. is truly a standout when it comes to fresh, vibrant, and delicious juices! Every sip tastes like it's been crafted with care, quality, and passion. The flavors are perfectly balanced — refreshing, nutrient-packed, and never too sweet. You can literally taste the freshness in every bottle.",
              },
              {
                name: 'Jagdish Kaur',
                review: "Nuvira juice is truly amazing. It's fresh, vibrant and packed with natural flavours. I could taste the quality in every sip and knowing it's cold pressed with real ingredients makes it even better. It's the perfect blend of amazing taste and real health benefits that give you clean energy and nourishment that I could feel. Would highly recommend!",
              },
            ].map(({ name, review }) => (
              <div key={name} className="bg-secondary/50 rounded-2xl border border-border/40 p-5">
                <div className="flex gap-0.5 mb-3">
                  {[1,2,3,4,5].map(s => <span key={s} className="text-yellow-400 text-sm">★</span>)}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3 italic">"{review}"</p>
                <p className="text-xs font-semibold text-foreground">— {name}</p>
                <p className="text-[10px] text-muted-foreground">Verified Google Review</p>
              </div>
            ))}
          </div>
          <a
            href="https://www.google.com/maps/place/NuVira+Juice+Company/@38.7028093,-90.7162366,11z"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm font-semibold text-yellow-700"
          >
            ⭐ Leave a Google Review
          </a>
        </motion.section>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center pb-4"
        >
          <Link to="/shop">
            <Button className="rounded-full px-8 bg-primary text-primary-foreground">
              Shop the Collection
            </Button>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}