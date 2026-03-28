// Design tokens for the cockpit UI.
//
// Font:        system sans for UI, font-mono only for numeric values/inputs
// Typography:  text-[10px] body | text-xs titles
// Text color:  white/90 primary | white/70 secondary | white/50 muted
// Backgrounds: black/60 chrome/inputs | black/40 content
// Borders:     white/20 standard | white/10 subtle dividers
// Disabled:    opacity-50

export const CHECKBOX =
  'w-3 h-3 rounded border-white/20 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0';

export const WINDOW_BODY =
  'flex flex-col gap-1 p-1 text-white/90 text-[10px]';

export const SECTION_HEADER =
  'text-cyan-300/90 font-medium text-[10px]';

export const FIELD_LABEL =
  'text-[10px] text-white/70';

export const FIELD_ROW =
  'flex items-center justify-between gap-1';

export const SELECT =
  'text-[10px] bg-black/60 text-white/90 border border-white/20 rounded px-1 py-0.5 focus:outline-none focus:border-cyan-500/50';

export const SELECT_DISABLED = `${SELECT} disabled:opacity-50`;

export const BUTTON_PRIMARY =
  'w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 text-[10px] border border-white/20 disabled:opacity-50';

export const BUTTON_GHOST =
  'px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed';

export const BUTTON_ACCENT =
  'px-1 py-0.5 text-[10px] rounded bg-cyan-500/30 text-white/90 hover:bg-cyan-500/50 border border-cyan-500/50 disabled:opacity-50';

export const INPUT_BASE =
  'w-full px-1 py-0.5 bg-black/60 text-white/90 border border-white/20 text-[10px] font-mono focus:outline-none focus:border-cyan-500/50';

export const EMPTY_STATE =
  'text-white/50 italic text-center p-1 text-[10px]';

// ── Toggle groups (exclusive selections) ──

export const TOGGLE_GROUP =
  'flex rounded overflow-hidden border border-white/20';

export const TOGGLE_STACK =
  'rounded overflow-hidden border border-white/20 divide-y divide-white/10';

export const TOGGLE_OPTION =
  'text-[10px] transition-colors disabled:opacity-50';

export const TOGGLE_ACTIVE =
  'bg-accent-30 text-white';

export const TOGGLE_INACTIVE =
  'text-white/70 hover:bg-white/10';
