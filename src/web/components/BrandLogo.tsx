/** Contempra Signs logo (AVIF with PNG fallback). Height drives size; width follows the 357×263 ratio. */
export function BrandLogo({ className = "h-10 w-auto" }: { className?: string }) {
  return (
    <picture>
      <source srcSet="/brand/contempra-logo.avif" type="image/avif" />
      <img
        src="/brand/contempra-logo.png"
        alt="Contempra Signs"
        width={357}
        height={263}
        className={`object-contain ${className}`}
        draggable={false}
      />
    </picture>
  );
}
