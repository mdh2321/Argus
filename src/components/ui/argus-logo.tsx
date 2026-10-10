import Image from "next/image";

export function ArgusLogo({ size = 28, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 40 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <path d="M3 16S9 7 20 7s17 9 17 9-6 9-17 9S3 16 3 16Z" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="20" cy="16" r="5.5" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="20" cy="16" r="2" fill="currentColor" />
  </svg>;
}

export function ArgusAvatar({ size = 72, working = false }: { size?: number; working?: boolean }) {
  return <div className={`argus-avatar ${working ? "is-working" : ""}`} style={{ width: size, height: size }}>
    <Image
      src="/avatars/scout-soft.png"
      alt={working ? "Scout, the Argus companion, is working" : "Scout, the Argus companion"}
      width={size}
      height={size}
      className="argus-avatar-image"
      loading="eager"
      draggable={false}
    />
  </div>;
}
