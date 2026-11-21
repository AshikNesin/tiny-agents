export function Face({ size = 28 }: { size?: number }) {
  return (
    <svg className="ta-face" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="50" fill="#ee8a5b" />
      <rect x="34" y="34" width="10" height="22" rx="5" fill="#111" />
      <rect x="56" y="34" width="10" height="22" rx="5" fill="#111" />
      <path d="M40 68q10 7 20 0" stroke="#111" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
