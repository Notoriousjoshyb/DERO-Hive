import { useId } from 'react';

export function HiveLogo({ size = 16, className }: { size?: number; className?: string }): JSX.Element {
  const uid = useId();
  const bg = `hive-bg-${uid}`;
  const glow = `hive-glow-${uid}`;
  const soft = `hive-soft-${uid}`;

  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#C8674C" />
          <stop offset="1" stopColor="#A84A32" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#F5F1E8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#F5F1E8" stopOpacity="0" />
        </radialGradient>
        <filter id={soft} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="114" ry="114" fill={`url(#${bg})`} />
      <circle cx="256" cy="256" r="200" fill={`url(#${glow})`} />
      <path d="M 314.02 289.50 L 256.00 323.00 L 197.98 289.50 L 197.98 222.50 L 256.00 189.00 L 314.02 222.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 435.27 289.50 L 377.24 323.00 L 319.22 289.50 L 319.22 222.50 L 377.24 189.00 L 435.27 222.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 192.78 289.50 L 134.76 323.00 L 76.73 289.50 L 76.73 222.50 L 134.76 189.00 L 192.78 222.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 374.65 394.50 L 316.62 428.00 L 258.60 394.50 L 258.60 327.50 L 316.62 294.00 L 374.65 327.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 374.65 184.50 L 316.62 218.00 L 258.60 184.50 L 258.60 117.50 L 316.62 84.00 L 374.65 117.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 253.40 394.50 L 195.38 428.00 L 137.35 394.50 L 137.35 327.50 L 195.38 294.00 L 253.40 327.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <path d="M 253.40 184.50 L 195.38 218.00 L 137.35 184.50 L 137.35 117.50 L 195.38 84.00 L 253.40 117.50 Z" fill="#F5F1E8" fillOpacity="0.07" stroke="#F5F1E8" strokeOpacity="0.85" strokeWidth="4.5" strokeLinejoin="round" />
      <line x1="256" y1="256" x2="377.24" y2="256" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="256" y1="256" x2="134.76" y2="256" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="256" y1="256" x2="316.62" y2="361" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="256" y1="256" x2="316.62" y2="151" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="256" y1="256" x2="195.38" y2="361" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="256" y1="256" x2="195.38" y2="151" stroke="#F0B39C" strokeOpacity="0.9" strokeWidth="5" strokeLinecap="round" />
      <line x1="195.38" y1="151" x2="316.62" y2="151" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="316.62" y1="151" x2="377.24" y2="256" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="377.24" y1="256" x2="316.62" y2="361" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="316.62" y1="361" x2="195.38" y2="361" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="195.38" y1="361" x2="134.76" y2="256" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="134.76" y1="256" x2="195.38" y2="151" stroke="#F0B39C" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="377.24" cy="256" r="15" fill="#F5F1E8" />
      <circle cx="377.24" cy="256" r="7" fill="#A84A32" />
      <circle cx="134.76" cy="256" r="15" fill="#F5F1E8" />
      <circle cx="134.76" cy="256" r="7" fill="#A84A32" />
      <circle cx="316.62" cy="361" r="15" fill="#F5F1E8" />
      <circle cx="316.62" cy="361" r="7" fill="#A84A32" />
      <circle cx="316.62" cy="151" r="15" fill="#F5F1E8" />
      <circle cx="316.62" cy="151" r="7" fill="#A84A32" />
      <circle cx="195.38" cy="361" r="15" fill="#F5F1E8" />
      <circle cx="195.38" cy="361" r="7" fill="#A84A32" />
      <circle cx="195.38" cy="151" r="15" fill="#F5F1E8" />
      <circle cx="195.38" cy="151" r="7" fill="#A84A32" />
      <circle cx="256" cy="256" r="34" fill="#F5F1E8" filter={`url(#${soft})`} opacity="0.5" />
      <circle cx="256" cy="256" r="26" fill="#F5F1E8" />
      <circle cx="256" cy="256" r="12" fill="#A84A32" />
    </svg>
  );
}
