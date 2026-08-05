import type { NoteColor } from '../../store/notesStore'

/**
 * Note tint → Tailwind class. Values resolve from CSS variables (see the
 * `:root` / `.dark` blocks in styles/tailwind.css and the Solarized overrides
 * in utils/themes.ts) so a theme switch repaints instantly. Never use inline
 * `style` colours here — those would survive a theme change.
 *
 * 'default' reuses the existing card surface; it has no variable of its own.
 */
export const NOTE_BG: Record<NoteColor, string> = {
  default: 'bg-card',
  yellow: 'bg-[hsl(var(--note-yellow))]',
  green: 'bg-[hsl(var(--note-green))]',
  blue: 'bg-[hsl(var(--note-blue))]',
  pink: 'bg-[hsl(var(--note-pink))]',
  purple: 'bg-[hsl(var(--note-purple))]'
}

export interface NoteSwatch {
  color: NoteColor
  label: string
  /** Small square shown in the overflow menu. */
  swatchClass: string
}

export const NOTE_SWATCHES: NoteSwatch[] = [
  { color: 'default', label: 'Default', swatchClass: 'bg-secondary' },
  { color: 'yellow', label: 'Yellow', swatchClass: 'bg-[hsl(var(--note-yellow))]' },
  { color: 'green', label: 'Green', swatchClass: 'bg-[hsl(var(--note-green))]' },
  { color: 'blue', label: 'Blue', swatchClass: 'bg-[hsl(var(--note-blue))]' },
  { color: 'pink', label: 'Pink', swatchClass: 'bg-[hsl(var(--note-pink))]' },
  { color: 'purple', label: 'Purple', swatchClass: 'bg-[hsl(var(--note-purple))]' }
]
