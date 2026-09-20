/**
 * Provider marks, inlined as SVG.
 *
 * Google's brand guidelines require their own four-colour mark at its official
 * proportions, so this is not a generic icon-font glyph. The colours are fixed
 * values on purpose — they must not shift with the theme.
 */
export function ProviderMark({ slug, className }: { slug: string; className?: string }) {
  if (slug === 'google') {
    return (
      <svg viewBox="0 0 18 18" className={className} aria-hidden focusable="false">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
    );
  }

  if (slug === 'apple') {
    return (
      <svg viewBox="0 0 18 18" className={className} aria-hidden focusable="false">
        <path
          fill="currentColor"
          d="M12.3 9.55c-.02-1.9 1.55-2.81 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.87.69-.59 0-1.5-.67-2.47-.65-1.27.02-2.44.74-3.1 1.87-1.32 2.29-.34 5.68.95 7.54.63.91 1.38 1.93 2.37 1.89.95-.04 1.31-.61 2.46-.61s1.47.61 2.48.59c1.02-.02 1.67-.93 2.3-1.84.72-1.06 1.02-2.08 1.04-2.13-.02-.01-2-.77-2.03-3ZM10.5 3.9c.52-.64.87-1.51.78-2.4-.75.03-1.66.5-2.2 1.13-.48.56-.9 1.46-.79 2.32.84.07 1.69-.42 2.21-1.05Z"
        />
      </svg>
    );
  }

  return null;
}
