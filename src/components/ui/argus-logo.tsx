export function ArgusLogo({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer ring */}
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      {/* Middle ring */}
      <circle cx="16" cy="16" r="8.5" stroke="currentColor" strokeWidth="1.5" opacity="0.15" />
      {/* Sweep arc */}
      <path
        d="M16 3A13 13 0 0 1 28.5 19"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx="16" cy="16" r="2.5" fill="var(--accent)" />
    </svg>
  );
}
