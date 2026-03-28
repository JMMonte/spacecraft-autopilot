// Shared Tailwind class strings for consistent UI across window components.

export const CHECKBOX =
  'w-3 h-3 rounded border-white/30 bg-black/40 checked:bg-cyan-300/40 checked:border-cyan-300/60 focus:ring-0 focus:ring-offset-0';

export const WINDOW_BODY =
  'flex flex-col gap-0.5 p-1 bg-black/40 text-white/90 backdrop-blur';

export const SECTION_HEADER =
  'text-cyan-300/90 font-medium text-[10px] uppercase';

export const FIELD_LABEL =
  'text-[10px] text-white/70 font-mono';

export const FIELD_ROW =
  'flex items-center justify-between gap-1';

export const SELECT =
  'text-[10px] font-mono bg-black/40 text-white/90 border border-white/20 rounded px-1 py-0.5 focus:outline-none focus:border-cyan-500/50';

export const SELECT_DISABLED = `${SELECT} disabled:opacity-40`;

export const BUTTON_PRIMARY =
  'w-full px-1 py-0.5 bg-black/60 hover:bg-white/20 text-white/90 text-[10px] border border-white/20 font-mono disabled:opacity-50';
