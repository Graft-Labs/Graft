import React from 'react';
import { motion } from 'framer-motion';

export const SquigglyLine = ({ className }: { className?: string }) => {
  return (
    <motion.svg
      className={className}
      width="100%"
      height="12"
      viewBox="0 0 100 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: 1, ease: "easeInOut", delay: 0.5 }}
    >
      <motion.path
        d="M2 10C15 10 20 2 33 2C46 2 50 10 63 10C76 10 80 2 93 2C96 2 98 4 98 6"
        stroke="#3079FF"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </motion.svg>
  );
};
