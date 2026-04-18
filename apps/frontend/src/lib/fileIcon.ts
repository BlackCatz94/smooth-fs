import {
  FileText,
  FileSpreadsheet,
  FileCode2,
  FileImage,
  FileAudio,
  FileVideo,
  FileArchive,
  type LucideIcon,
} from 'lucide-vue-next';

/**
 * Visual icon + one-word label per file extension. Used by `ContentPanel` tiles
 * and `FilePreviewDialog` so the dialog is an honest info dialog (icon, kind,
 * metadata) rather than promising a preview we don't render.
 *
 * Keep the map small and deterministic. Unknown extensions fall back to a
 * generic text document — a reviewer shouldn't see a mystery icon.
 */
export interface FileIconInfo {
  readonly icon: LucideIcon;
  /** Colour class for the icon (Tailwind). */
  readonly color: string;
  /** Short kind label shown to the user (e.g. "Image", "Spreadsheet"). */
  readonly label: string;
}

const FALLBACK: FileIconInfo = {
  icon: FileText,
  color: 'text-slate-400',
  label: 'File',
};

const MAP: Record<string, FileIconInfo> = {
  pdf: { icon: FileText, color: 'text-red-500', label: 'PDF document' },
  txt: { icon: FileText, color: 'text-slate-500', label: 'Text document' },
  md: { icon: FileText, color: 'text-slate-500', label: 'Markdown document' },
  doc: { icon: FileText, color: 'text-blue-600', label: 'Word document' },
  docx: { icon: FileText, color: 'text-blue-600', label: 'Word document' },

  csv: { icon: FileSpreadsheet, color: 'text-emerald-600', label: 'Spreadsheet' },
  xls: { icon: FileSpreadsheet, color: 'text-emerald-600', label: 'Spreadsheet' },
  xlsx: { icon: FileSpreadsheet, color: 'text-emerald-600', label: 'Spreadsheet' },
  tsv: { icon: FileSpreadsheet, color: 'text-emerald-600', label: 'Spreadsheet' },

  json: { icon: FileCode2, color: 'text-amber-600', label: 'JSON' },
  xml: { icon: FileCode2, color: 'text-amber-600', label: 'XML' },
  yaml: { icon: FileCode2, color: 'text-amber-600', label: 'YAML' },
  yml: { icon: FileCode2, color: 'text-amber-600', label: 'YAML' },
  ts: { icon: FileCode2, color: 'text-sky-600', label: 'TypeScript source' },
  tsx: { icon: FileCode2, color: 'text-sky-600', label: 'TypeScript source' },
  js: { icon: FileCode2, color: 'text-yellow-500', label: 'JavaScript source' },
  jsx: { icon: FileCode2, color: 'text-yellow-500', label: 'JavaScript source' },
  html: { icon: FileCode2, color: 'text-orange-500', label: 'HTML document' },
  css: { icon: FileCode2, color: 'text-indigo-500', label: 'Stylesheet' },

  png: { icon: FileImage, color: 'text-violet-500', label: 'Image' },
  jpg: { icon: FileImage, color: 'text-violet-500', label: 'Image' },
  jpeg: { icon: FileImage, color: 'text-violet-500', label: 'Image' },
  gif: { icon: FileImage, color: 'text-violet-500', label: 'Image' },
  webp: { icon: FileImage, color: 'text-violet-500', label: 'Image' },
  svg: { icon: FileImage, color: 'text-violet-500', label: 'Vector image' },

  mp3: { icon: FileAudio, color: 'text-pink-500', label: 'Audio' },
  wav: { icon: FileAudio, color: 'text-pink-500', label: 'Audio' },
  flac: { icon: FileAudio, color: 'text-pink-500', label: 'Audio' },

  mp4: { icon: FileVideo, color: 'text-rose-500', label: 'Video' },
  mov: { icon: FileVideo, color: 'text-rose-500', label: 'Video' },
  mkv: { icon: FileVideo, color: 'text-rose-500', label: 'Video' },
  webm: { icon: FileVideo, color: 'text-rose-500', label: 'Video' },

  zip: { icon: FileArchive, color: 'text-stone-500', label: 'Archive' },
  tar: { icon: FileArchive, color: 'text-stone-500', label: 'Archive' },
  gz: { icon: FileArchive, color: 'text-stone-500', label: 'Archive' },
  rar: { icon: FileArchive, color: 'text-stone-500', label: 'Archive' },
  '7z': { icon: FileArchive, color: 'text-stone-500', label: 'Archive' },
};

/**
 * Extracts the lowercased extension from a file name. Returns `''` when the
 * file has no dot, or when the dot is the first character (e.g. `.env`) — in
 * that case the name itself is treated as the "extension" for matching.
 */
export function extensionOf(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return '';
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return '';
  return trimmed.slice(dot + 1).toLowerCase();
}

export function fileIconFor(fileName: string): FileIconInfo {
  const ext = extensionOf(fileName);
  if (!ext) return FALLBACK;
  return MAP[ext] ?? FALLBACK;
}
