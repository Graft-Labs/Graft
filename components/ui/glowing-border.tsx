import React from "react";
import { cn } from "@/lib/utils";

export const GlowingBorder = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("relative group", className)}>
      <div className="absolute -inset-0.5 bg-gradient-to-r from-[#3079FF] to-[#0000EE] rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
      <div className="relative bg-white rounded-2xl">
        {children}
      </div>
    </div>
  );
};
