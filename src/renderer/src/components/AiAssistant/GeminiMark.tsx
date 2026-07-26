import React from 'react'

/**
 * Gemini-style four-pointed spark, drawn inline.
 *
 * Deliberately our own glyph rather than a bundled copy of Google's brand asset:
 * it reads as "Gemini" in context, stays crisp at 14–24px, and inherits
 * `currentColor` so it follows the active theme. When the provider list grows,
 * give each provider its own mark component and pick by `aiProvider`.
 */
export function GeminiMark({
  size = 18,
  className
}: {
  size?: number
  className?: string
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="novapad-gemini-grad" x1="2" y1="20" x2="22" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4E8CFF" />
          <stop offset="55%" stopColor="#8A7CFF" />
          <stop offset="100%" stopColor="#D96CD1" />
        </linearGradient>
      </defs>
      {/* Large spark */}
      <path
        d="M12 2c.35 3.02 1.3 5.2 2.86 6.6C16.4 10 18.7 10.8 22 11.1c-3.3.3-5.6 1.1-7.14 2.5C13.3 15 12.35 17.2 12 20.2c-.35-3-1.3-5.2-2.86-6.6C7.6 12.2 5.3 11.4 2 11.1c3.3-.3 5.6-1.1 7.14-2.5C10.7 7.2 11.65 5.02 12 2Z"
        fill="url(#novapad-gemini-grad)"
      />
      {/* Small trailing spark */}
      <path
        d="M18.8 16.4c.16 1.16.55 2 1.16 2.54.6.53 1.5.85 2.74.96-1.24.11-2.14.43-2.74.96-.61.54-1 1.38-1.16 2.54-.16-1.16-.55-2-1.16-2.54-.6-.53-1.5-.85-2.74-.96 1.24-.11 2.14-.43 2.74-.96.61-.54 1-1.38 1.16-2.54Z"
        fill="url(#novapad-gemini-grad)"
        opacity="0.75"
      />
    </svg>
  )
}
