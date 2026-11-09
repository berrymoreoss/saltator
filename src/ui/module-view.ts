/**
 * The pure side of a Verilog module's view (HDL-1): what it shows of a compiled module, the Yosys
 * command for it, and the JSON drafts kept for the session. Spec: docs/editor.md#verilog-modules.
 */
import type { Circuit, CircuitDocument } from '../circuit';
import type { HdlMessage, HdlModule } from '../core';
import { fromYosys, type YosysConversion, yosysCommand } from '../library';

/** What the view lists of a compiled module. */
export interface ModuleSummary {
  readonly top: string;
  readonly creator: string;
  readonly ports: readonly {
    readonly name: string;
    readonly dir: 'in' | 'out';
    readonly width: number;
  }[];
  /** Cells by type, the most frequent first (then by type). */
  readonly cells: readonly (readonly [type: string, count: number])[];
  readonly cellCount: number;
}

export function moduleSummary(module: HdlModule): ModuleSummary {
  const counts = new Map<string, number>();
  for (const cell of module.cells) counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
  return {
    top: module.top,
    creator: module.creator,
    ports: module.ports.map((p) => ({
      name: p.bits.length === 1 ? p.name : `${p.name}[${p.lsb + p.bits.length - 1}:${p.lsb}]`,
      dir: p.dir,
      width: p.bits.length,
    })),
    cells: [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    cellCount: module.cells.length,
  };
}

/**
 * The command to make a module's JSON, its files named after the module: the compiled top's
 * name, else the circuit's id as an identifier (`address-decoder` → `address_decoder.v`).
 */
export function moduleCommand(circuit: Circuit): string {
  const base = circuit.verilog?.module?.top ?? circuit.id.replaceAll('-', '_');
  return yosysCommand(`${base}.v`, `${base}.json`);
}

/** Compile's conversion of the editor's text: nothing to convert is a message of its own. */
export function compileJson(text: string): YosysConversion {
  if (text.trim() === '') {
    return {
      messages: [{ severity: 'error', message: 'Paste the JSON Yosys made, or import its file' }],
    };
  }
  return fromYosys(text);
}

/** Where a module is placed: `2× in Main, 1× in CPU Board`; empty when nowhere. */
export function placements(document: CircuitDocument, circuitId: string): string {
  const type = `sub/${circuitId}`;
  return document.circuits
    .map((c) => [c.name, c.components.filter((p) => p.type === type).length] as const)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n}× in ${name}`)
    .join(', ');
}

/** A message as a line: `decoder.v:12.3-12.20: a latch is inferred for q`. */
export function messageText(message: HdlMessage): string {
  return message.src ? `${message.src}: ${message.message}` : message.message;
}

/**
 * The JSON typed or imported into each module's editor, and the last Compile's messages: kept
 * for the session (switching circuits keeps them), never in the document.
 */
export class ModuleDrafts {
  readonly #text = new Map<string, string>();
  readonly #messages = new Map<string, readonly HdlMessage[]>();

  text(circuitId: string): string {
    return this.#text.get(circuitId) ?? '';
  }

  setText(circuitId: string, text: string): void {
    this.#text.set(circuitId, text);
  }

  /** The last Compile's messages, or undefined before one. */
  messages(circuitId: string): readonly HdlMessage[] | undefined {
    return this.#messages.get(circuitId);
  }

  setMessages(circuitId: string, messages: readonly HdlMessage[]): void {
    this.#messages.set(circuitId, messages);
  }

  /** Forgets everything: another document is shown. */
  clear(): void {
    this.#text.clear();
    this.#messages.clear();
  }
}
