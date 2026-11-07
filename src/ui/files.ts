/**
 * Reading and writing `.logic.json` files. Two implementations behind one interface:
 * - **native** — the File System Access API (Chromium): pickers, and Save writes back through
 *   the file's handle;
 * - **fallback** (Firefox, Safari) — a file input to open, a download to save (no handles, so
 *   every Save downloads).
 * The browser primitives are injected, so the logic runs in Node tests; `browserFileAccess`
 * plugs in the real ones.
 */
import { FILE_EXTENSION, type FileRef } from './document-session';

/** A file's name and text, with the handle to write back to where the browser gives one. */
export interface OpenedFile {
  readonly name: string;
  readonly text: string;
  readonly handle?: FileRef;
}

/** Where a Save As went: the file name, and its handle (native) for the next Save. */
export interface SavedFile {
  readonly name: string;
  readonly handle?: FileRef;
}

export interface FileAccess {
  readonly kind: 'native' | 'fallback';
  /** Asks for a file to open; `undefined` when the user cancels. */
  open(): Promise<OpenedFile | undefined>;
  /** Reads a kept handle (Open Recent, a dropped file); `undefined` if permission is refused. */
  read(handle: FileRef): Promise<OpenedFile | undefined>;
  /** Writes to a kept handle; `false` if write permission is refused (then Save As). */
  write(handle: FileRef, text: string): Promise<boolean>;
  /** Asks where to save (native) or downloads (fallback); `undefined` when cancelled. */
  saveAs(text: string, suggestedName: string): Promise<SavedFile | undefined>;
}

// The parts of the File System Access API used here (Chromium only; not in TypeScript's DOM lib).
type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionDescriptor {
  readonly mode: 'read' | 'readwrite';
}
interface WritableFile {
  write(data: string | Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
}
/** A `FileSystemFileHandle`. */
export interface NativeFileHandle extends FileRef {
  readonly kind: 'file';
  getFile(): Promise<Blob & { readonly name: string }>;
  createWritable(): Promise<WritableFile>;
  queryPermission?(descriptor: PermissionDescriptor): Promise<Permission>;
  requestPermission?(descriptor: PermissionDescriptor): Promise<Permission>;
}
interface PickerType {
  readonly description: string;
  readonly accept: Record<string, readonly string[]>;
}
interface PickerOptions {
  readonly id?: string;
  readonly types?: readonly PickerType[];
}
/** `window.showOpenFilePicker` / `showSaveFilePicker`. */
export interface NativePickers {
  showOpenFilePicker(options: PickerOptions): Promise<readonly NativeFileHandle[]>;
  showSaveFilePicker(options: PickerOptions & { suggestedName: string }): Promise<NativeFileHandle>;
}

/** The fallback's browser primitives. */
export interface FallbackPrimitives {
  /** A file input's choice; `undefined` when cancelled. */
  pickFile(accept: string): Promise<(Blob & { readonly name: string }) | undefined>;
  download(fileName: string, text: string): void;
}

const PICKER_OPTIONS: PickerOptions = {
  // Lets the browser remember the folder for these pickers.
  id: 'logic-circuits',
  types: [{ description: 'Logic circuit', accept: { 'application/json': [FILE_EXTENSION] } }],
};

/** A picker the user closed rejects with `AbortError`: not an error. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function permitted(handle: NativeFileHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  if ((await handle.queryPermission?.({ mode })) === 'granted') return true;
  // No permission API: a handle from this page's own picker is usable as it is.
  if (handle.requestPermission === undefined) return handle.queryPermission === undefined;
  return (await handle.requestPermission({ mode })) === 'granted';
}

async function readHandle(handle: NativeFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: file.name, text: await file.text(), handle };
}

export function nativeFileAccess(pickers: NativePickers): FileAccess {
  return {
    kind: 'native',
    async open() {
      try {
        const [handle] = await pickers.showOpenFilePicker(PICKER_OPTIONS);
        return handle && (await readHandle(handle));
      } catch (error) {
        if (isAbort(error)) return undefined;
        throw error;
      }
    },
    async read(ref) {
      const handle = ref as NativeFileHandle;
      if (!(await permitted(handle, 'read'))) return undefined;
      return readHandle(handle);
    },
    async write(ref, text) {
      const handle = ref as NativeFileHandle;
      if (!(await permitted(handle, 'readwrite'))) return false;
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    },
    async saveAs(text, suggestedName) {
      let handle: NativeFileHandle;
      try {
        handle = await pickers.showSaveFilePicker({ ...PICKER_OPTIONS, suggestedName });
      } catch (error) {
        if (isAbort(error)) return undefined;
        throw error;
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { name: handle.name, handle };
    },
  };
}

export function fallbackFileAccess(primitives: FallbackPrimitives): FileAccess {
  return {
    kind: 'fallback',
    async open() {
      const file = await primitives.pickFile(`${FILE_EXTENSION},.json,application/json`);
      return file && { name: file.name, text: await file.text() };
    },
    // There are no handles without the native API.
    read: async () => undefined,
    write: async () => false,
    async saveAs(text, suggestedName) {
      primitives.download(suggestedName, text);
      return { name: suggestedName };
    },
  };
}

/**
 * A dropped file, read from the `drop` event's data. Must be called during the event (the
 * browser empties the data afterwards); the handle comes along where the browser gives one.
 */
export function droppedFile(data: DataTransfer): Promise<OpenedFile> | undefined {
  const item = [...data.items].find((i) => i.kind === 'file');
  if (!item) return undefined;
  const withHandle = item as DataTransferItem & {
    getAsFileSystemHandle?(): Promise<NativeFileHandle | { readonly kind: 'directory' } | null>;
  };
  const handle = withHandle.getAsFileSystemHandle?.();
  const file = item.getAsFile();
  if (!file) return undefined;
  return (async () => {
    const native = await handle?.catch(() => null);
    const text = await file.text();
    return native?.kind === 'file'
      ? { name: file.name, text, handle: native }
      : { name: file.name, text };
  })();
}

/** A memory image file opened as bytes (`.bin`, `.hex`). */
export interface OpenedBytes {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Files saved from bytes: memory images (R12b) and waveform dumps (`vcd`, R13). */
export type ImageFileKind = 'binary' | 'intel-hex' | 'vcd';

/**
 * Memory image files (R12b): opened as bytes and saved from bytes, with pickers of their own
 * (the browser remembers the images folder apart from the circuits folder). No handles are
 * kept: an image is loaded into a memory, not edited in place.
 */
export interface ImageFileAccess {
  /** Asks for an image file; `undefined` when the user cancels. */
  openBytes(): Promise<OpenedBytes | undefined>;
  /** Asks where to save (native) or downloads (fallback); the name saved, or `undefined`. */
  saveBytes(
    bytes: Uint8Array<ArrayBuffer>,
    suggestedName: string,
    kind: ImageFileKind,
  ): Promise<string | undefined>;
}

const IMAGE_ACCEPT = ['.bin', '.rom', '.hex', '.ihx'];
const IMAGE_TYPES: Readonly<Record<ImageFileKind, PickerType>> = {
  binary: { description: 'Binary image', accept: { 'application/octet-stream': ['.bin', '.rom'] } },
  'intel-hex': { description: 'Intel HEX', accept: { 'text/plain': ['.hex', '.ihx'] } },
  vcd: { description: 'Value Change Dump', accept: { 'text/plain': ['.vcd'] } },
};

export function nativeImageAccess(pickers: NativePickers): ImageFileAccess {
  return {
    async openBytes() {
      try {
        const [handle] = await pickers.showOpenFilePicker({
          id: 'logic-images',
          types: [
            { description: 'Memory image', accept: { 'application/octet-stream': IMAGE_ACCEPT } },
          ],
        });
        if (!handle) return undefined;
        const file = await handle.getFile();
        return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
      } catch (error) {
        if (isAbort(error)) return undefined;
        throw error;
      }
    },
    async saveBytes(bytes, suggestedName, kind) {
      let handle: NativeFileHandle;
      try {
        handle = await pickers.showSaveFilePicker({
          // Waveform dumps go to a folder of their own.
          id: kind === 'vcd' ? 'logic-waveforms' : 'logic-images',
          types: [IMAGE_TYPES[kind]],
          suggestedName,
        });
      } catch (error) {
        if (isAbort(error)) return undefined;
        throw error;
      }
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return handle.name;
    },
  };
}

export function fallbackImageAccess(primitives: {
  pickFile(accept: string): Promise<(Blob & { readonly name: string }) | undefined>;
  downloadBytes(fileName: string, bytes: Uint8Array<ArrayBuffer>): void;
}): ImageFileAccess {
  return {
    async openBytes() {
      const file = await primitives.pickFile(IMAGE_ACCEPT.join(','));
      return file && { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
    },
    async saveBytes(bytes, suggestedName) {
      primitives.downloadBytes(suggestedName, bytes);
      return suggestedName;
    },
  };
}

/** Image files through the File System Access API where the page may use it, else the fallback. */
export function browserImageAccess(): ImageFileAccess {
  const pickers = window as unknown as Partial<NativePickers>;
  if (pickers.showOpenFilePicker && pickers.showSaveFilePicker && window.self === window.top) {
    return nativeImageAccess({
      showOpenFilePicker: (options) => pickers.showOpenFilePicker!.call(window, options),
      showSaveFilePicker: (options) => pickers.showSaveFilePicker!.call(window, options),
    });
  }
  return fallbackImageAccess({ pickFile, downloadBytes });
}

/** The File System Access API where the page may use it, the fallback elsewhere. */
export function browserFileAccess(): FileAccess {
  const pickers = window as unknown as Partial<NativePickers>;
  // Cross-origin frames can't show pickers.
  if (pickers.showOpenFilePicker && pickers.showSaveFilePicker && window.self === window.top) {
    return nativeFileAccess({
      showOpenFilePicker: (options) => pickers.showOpenFilePicker!.call(window, options),
      showSaveFilePicker: (options) => pickers.showSaveFilePicker!.call(window, options),
    });
  }
  return fallbackFileAccess({ pickFile, download });
}

function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0]));
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

function download(fileName: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: 'application/json' }));
}

function downloadBytes(fileName: string, bytes: Uint8Array<ArrayBuffer>): void {
  downloadBlob(fileName, new Blob([bytes], { type: 'application/octet-stream' }));
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked later: the download starts asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
