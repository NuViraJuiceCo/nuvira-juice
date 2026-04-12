import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';

const THRESHOLD = 72;

export default function PullToRefresh({ onRefresh, children }) {
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pullY = useMotionValue(0);
  const opacity = useTransform(pullY, [0, THRESHOLD], [0, 1]);
  const scale = useTransform(pullY, [0, THRESHOLD], [0.5, 1]);

  const onTouchStart = (e) => {
    if (window.scrollY === 0) startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e) => {
    if (startY.current === null) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta > 0) pullY.set(Math.min(delta * 0.4, THRESHOLD));
  };

  const onTouchEnd = async () => {
    if (pullY.get() >= THRESHOLD - 5 && !refreshing) {
      setRefreshing(true);
      await onRefresh();
      setRefreshing(false);
    }
    startY.current = null;
    pullY.set(0);
  };

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <motion.div
        style={{ height: pullY, opacity }}
        className="flex items-center justify-center overflow-hidden"
      >
        <motion.div style={{ scale }} className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </motion.div>
      {children}
    </div>
  );
}