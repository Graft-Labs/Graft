"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface BrowserShellProps {
  children: React.ReactNode;
  url?: string;
  className?: string;
  contentClassName?: string;
}

export function BrowserShell({
  children,
  url = "graft.ai/scan/results",
  className,
  contentClassName,
}: BrowserShellProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl",
        className
      )}
    >
      {/* Browser Chrome */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <div className="w-3 h-3 rounded-full bg-green-400" />
        </div>
        <div className="flex-1 max-w-xs mx-4">
          <div className="flex items-center gap-1 px-3 py-1 bg-white rounded-md border border-gray-200 text-xs text-gray-500 font-mono">
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="truncate">{url}</span>
          </div>
        </div>
        <div className="w-16" />
      </div>

      {/* Browser Content */}
      <div className={cn("relative overflow-hidden", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
