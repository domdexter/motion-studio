import { useId } from "react";
import { cn } from "@/lib/utils";

/** Motion Studio mark: a gradient “M” whose right stroke resolves into a play button. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="20 10 730 570" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-pill`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#14DCFB" />
          <stop offset="1" stopColor="#1759F5" />
        </linearGradient>
        <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1650FF" />
          <stop offset="0.55" stopColor="#6E62FF" />
          <stop offset="1" stopColor="#E47CF6" />
        </linearGradient>
        <linearGradient id={`${id}-arm`} x1="0" y1="0.8" x2="1" y2="0.1">
          <stop offset="0" stopColor="#2E12D6" />
          <stop offset="0.6" stopColor="#5A1BF2" />
          <stop offset="1" stopColor="#B52FF6" />
        </linearGradient>
        <linearGradient id={`${id}-play`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A996FF" />
          <stop offset="1" stopColor="#5B45F5" />
        </linearGradient>
        <mask id={`${id}-gap`} maskUnits="userSpaceOnUse" x="0" y="0" width="780" height="600">
          <rect width="780" height="600" fill="#fff" />
          <path d="M548 330c0-30 27-40 50-25l124 85c23 15 23 45 0 60L598 535c-23 15-50 5-50-25Z" fill="#000" stroke="#000" strokeWidth="44" strokeLinejoin="round" />
        </mask>
      </defs>
      <g mask={`url(#${id}-gap)`}>
        <path d="M398 178 612 42c56-34 123 3 123 73v265L560 300l-40 30-50-105Z" fill={`url(#${id}-arm)`} />
        <path d="M150 120 206 46l262 176c35 26 52 58 52 98v192L240 308H150Z" fill={`url(#${id}-band)`} />
      </g>
      <rect x="35" y="20" width="205" height="545" rx="102.5" fill={`url(#${id}-pill)`} />
      <path d="M548 330c0-30 27-40 50-25l124 85c23 15 23 45 0 60L598 535c-23 15-50 5-50-25Z" fill={`url(#${id}-play)`} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span>Motion Studio</span>
    </span>
  );
}
