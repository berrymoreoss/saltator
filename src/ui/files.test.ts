import { describe, expect, it } from 'vitest';
import {
  type FallbackPrimitives,
  fallbackFileAccess,
  type NativeFileHandle,
  type NativePickers,
  nativeFileAccess,
} from './files';

type Permission = 'granted' | 'denied' | 'prompt';

/** An in-memory `FileSystemFileHandle` with a permission state. */
class FakeHandle implements NativeFileHandle {
  readonly kind = 'file';
  readonly requests: string[] = [];
  readonly name: string;
  text: string;
  permission: Permission;
  /** What `requestPermission` answers. */
  answer: Permission;
  constructor(name: string, text: string, permission: Permission = 'granted', answer = permission) {
    this.name = name;
    this.text = text;
    this.permission = permission;
    this.answer = answer;
  }
  async getFile() {
    return Object.assign(new Blob([this.text]), { name: this.name });
  }
  async createWritable() {
    let written = '';
    return {
      write: async (data: string) => {
        written += data;
      },
      close: async () => {
        this.text = written;
      },
    };
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission({ mode }: { mode: string }) {
    this.requests.push(mode);
    this.permission = this.answer;
    return this.answer;
  }
}

const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

function pickers(open: () => FakeHandle[], save: (name: string) => FakeHandle): NativePickers {
  return {
    showOpenFilePicker: async () => open(),
    showSaveFilePicker: async ({ suggestedName }) => save(suggestedName),
  };
}

describe('native file access (File System Access API)', () => {
  it('opens a picked file with its handle', async () => {
    const handle = new FakeHandle('adder.logic.json', '{"schemaVersion":1}');
    const access = nativeFileAccess(
      pickers(
        () => [handle],
        () => handle,
      ),
    );
    expect(access.kind).toBe('native');
    expect(await access.open()).toEqual({
      name: 'adder.logic.json',
      text: '{"schemaVersion":1}',
      handle,
    });
  });

  it('a closed picker is not an error; other failures are', async () => {
    const cancelled = nativeFileAccess({
      showOpenFilePicker: async () => Promise.reject(abort()),
      showSaveFilePicker: async () => Promise.reject(abort()),
    });
    expect(await cancelled.open()).toBeUndefined();
    expect(await cancelled.saveAs('x', 'a.logic.json')).toBeUndefined();

    const broken = nativeFileAccess({
      showOpenFilePicker: async () => Promise.reject(new Error('SecurityError')),
      showSaveFilePicker: async () => Promise.reject(new Error('SecurityError')),
    });
    await expect(broken.open()).rejects.toThrow('SecurityError');
    await expect(broken.saveAs('x', 'a.logic.json')).rejects.toThrow('SecurityError');
  });

  it('Save As writes the picked file and returns its handle', async () => {
    let suggested = '';
    const handle = new FakeHandle('picked.logic.json', '');
    const access = nativeFileAccess(
      pickers(
        () => [],
        (name) => {
          suggested = name;
          return handle;
        },
      ),
    );
    expect(await access.saveAs('TEXT', 'Hello, LED.logic.json')).toEqual({
      name: 'picked.logic.json',
      handle,
    });
    expect(suggested).toBe('Hello, LED.logic.json');
    expect(handle.text).toBe('TEXT');
  });

  it('writes through a kept handle, asking for permission when needed', async () => {
    const access = nativeFileAccess(
      pickers(
        () => [],
        () => new FakeHandle('x', ''),
      ),
    );
    const granted = new FakeHandle('a.logic.json', 'old');
    expect(await access.write(granted, 'new')).toBe(true);
    expect(granted.text).toBe('new');
    expect(granted.requests).toEqual([]);

    // After a reload the restored handle asks again.
    const prompt = new FakeHandle('b.logic.json', 'old', 'prompt', 'granted');
    expect(await access.write(prompt, 'new')).toBe(true);
    expect(prompt.requests).toEqual(['readwrite']);
    expect(prompt.text).toBe('new');

    const refused = new FakeHandle('c.logic.json', 'old', 'prompt', 'denied');
    expect(await access.write(refused, 'new')).toBe(false);
    expect(refused.text).toBe('old');
  });

  it('reads a kept handle with read permission', async () => {
    const access = nativeFileAccess(
      pickers(
        () => [],
        () => new FakeHandle('x', ''),
      ),
    );
    const handle = new FakeHandle('a.logic.json', 'TEXT', 'prompt', 'granted');
    expect(await access.read(handle)).toEqual({ name: 'a.logic.json', text: 'TEXT', handle });
    expect(handle.requests).toEqual(['read']);
    expect(await access.read(new FakeHandle('b', 'x', 'prompt', 'denied'))).toBeUndefined();
  });
});

describe('fallback file access (file input and download)', () => {
  function fallback(picked?: Blob & { name: string }) {
    const downloads: [string, string][] = [];
    let accept = '';
    const primitives: FallbackPrimitives = {
      pickFile: async (a) => {
        accept = a;
        return picked;
      },
      download: (name, text) => downloads.push([name, text]),
    };
    return { access: fallbackFileAccess(primitives), downloads, accept: () => accept };
  }

  it('opens the chosen file, without a handle', async () => {
    const { access, accept } = fallback(
      Object.assign(new Blob(['TEXT']), { name: 'a.logic.json' }),
    );
    expect(access.kind).toBe('fallback');
    expect(await access.open()).toEqual({ name: 'a.logic.json', text: 'TEXT' });
    expect(accept()).toContain('.logic.json');
    expect(await fallback().access.open()).toBeUndefined();
  });

  it('Save As downloads; there is no handle to read or write', async () => {
    const { access, downloads } = fallback();
    expect(await access.saveAs('TEXT', 'adder.logic.json')).toEqual({ name: 'adder.logic.json' });
    expect(downloads).toEqual([['adder.logic.json', 'TEXT']]);
    expect(await access.write({ name: 'adder.logic.json' }, 'TEXT')).toBe(false);
    expect(await access.read({ name: 'adder.logic.json' })).toBeUndefined();
  });
});
