import {
  AlignLeft,
  BookOpen,
  Braces,
  Copy,
  Regex,
  SortAsc,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import type { SendMode } from '../../store/aiStore'

/**
 * Canned prompts shown as chips above the chat input. Registry-shaped, mirroring
 * `components/Tools/tools.tsx`, so adding one is a single entry.
 *
 * `mode` decides where the answer lands:
 *  - 'chat' → prose in the transcript
 *  - 'edit' → a diff the user approves before it touches the buffer
 *  - 'find' → a pattern pushed into the Find & Replace dialog, leaving the
 *             document alone (much cheaper than rewriting a big file)
 */
export interface QuickAction {
  id: string
  label: string
  icon: LucideIcon
  mode: SendMode
  prompt: string
  /** Shown as the button tooltip. */
  hint: string
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'summarize',
    label: 'Summarize',
    icon: BookOpen,
    mode: 'chat',
    hint: 'Describe what this document contains',
    prompt:
      'Summarize this document. Lead with what it is and what it is for, then list the ' +
      'key points as bullets. Note anything that looks anomalous or inconsistent.'
  },
  {
    id: 'explain',
    label: 'Explain',
    icon: Sparkles,
    mode: 'chat',
    hint: 'Explain the structure, format, or logic',
    prompt:
      'Explain this content: its structure or format, what each part does, and anything ' +
      'a reader would likely misunderstand.'
  },
  {
    id: 'dedupe',
    label: 'Remove duplicates',
    icon: Copy,
    mode: 'edit',
    hint: 'Drop repeated lines or records, keeping the first of each',
    prompt:
      'Remove duplicate lines or records, keeping the first occurrence of each and ' +
      'preserving the original order. If the content has a header row, keep it. ' +
      'Change nothing else.'
  },
  {
    id: 'sort',
    label: 'Sort',
    icon: SortAsc,
    mode: 'edit',
    hint: 'Sort lines or records sensibly',
    prompt:
      'Sort the lines or records in the most sensible order for this content ' +
      '(alphabetical, numeric, or by date as appropriate). Keep any header row in place. ' +
      'Do not add, remove, or reword anything.'
  },
  {
    id: 'clean',
    label: 'Clean up',
    icon: AlignLeft,
    mode: 'edit',
    hint: 'Trim trailing whitespace, collapse blank runs, normalise spacing',
    prompt:
      'Clean up this text: trim trailing whitespace, collapse runs of blank lines to a ' +
      'single blank line, and normalise inconsistent separators or spacing. Do not ' +
      'change any actual values or wording.'
  },
  {
    id: 'convert',
    label: 'Convert format',
    icon: Braces,
    mode: 'edit',
    hint: 'Convert between CSV, JSON, YAML, TSV, Markdown table…',
    prompt:
      'Convert this content to the most useful alternative structured format ' +
      '(for example CSV to JSON, JSON to CSV, or a delimited list to a Markdown table). ' +
      'State which format you chose in the explanation.'
  },
  {
    id: 'regex',
    label: 'Build a regex',
    icon: Regex,
    mode: 'find',
    hint: 'Generate a search pattern and open it in Find & Replace',
    prompt:
      'Build a regular expression that matches the repeating pattern in this content, ' +
      'with capture groups for the parts a user would most likely want to extract or reorder.'
  }
]
