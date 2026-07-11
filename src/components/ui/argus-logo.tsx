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
      {/* Pupil first so the lids overlap it — the disc sits tucked under the
          eyelids (tangent at the apex), not floating inside the almond. */}
      <circle cx="16" cy="16" r="5" fill="var(--accent)" />
      {/* Eye outline */}
      <path
        d="M2 16 Q16 6 30 16 Q16 26 2 16 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
