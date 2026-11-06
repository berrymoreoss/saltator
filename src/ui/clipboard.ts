/**
 * Connects the editor's copy/paste to the system clipboard. Keyboard shortcuts go through the
 * browser's `copy`/`cut`/`paste` events, which need no permission; menu items use the async
 * Clipboard API (paste may ask for permission). A copy is also kept in memory, so menu paste
 * works where the async API is refused. Spec: docs/editor.md#copy-and-paste.
 */
import type { Editor } from '../editor';
import { isTextField } from './commands';

export class ClipboardBridge {
  readonly #editor: Editor;
  #copied: string | undefined;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Copy from a menu. */
  copy(): void {
    this.#write(this.#editor.copySelection());
  }

  cut(): void {
    this.#write(this.#editor.cutSelection());
  }

  /** Paste from a menu: the system clipboard if it can be read, else the last copy. */
  async paste(): Promise<void> {
    let text: string | undefined;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Refused or unsupported: fall back to the in-memory copy.
    }
    const source = text ?? this.#copied;
    if (source !== undefined) this.#editor.pasteText(source);
  }

  #write(text: string | undefined): void {
    if (text === undefined) return;
    this.#copied = text;
    navigator.clipboard?.writeText(text).catch(() => {
      // The in-memory copy still works within this page.
    });
  }

  /** Handles the browser's clipboard events (Mod+C/X/V) outside text fields. */
  attach(target: Document): () => void {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (isTextField(e.target) || !e.clipboardData) return;
      const text = cut ? this.#editor.cutSelection() : this.#editor.copySelection();
      if (text === undefined) return;
      this.#copied = text;
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (isTextField(e.target)) return;
      // The system clipboard is the truth here: other text in it pastes nothing.
      const text = e.clipboardData?.getData('text/plain');
      if (text && this.#editor.pasteText(text)) e.preventDefault();
    };
    target.addEventListener('copy', copy);
    target.addEventListener('cut', cut);
    target.addEventListener('paste', paste);
    return () => {
      target.removeEventListener('copy', copy);
      target.removeEventListener('cut', cut);
      target.removeEventListener('paste', paste);
    };
  }
}
