import { Eraser, FileDown, FileUp } from 'lucide-react';
import { useState } from 'react';
import { formatAddress, placeImage, suggestedLoadAddress } from '../core';
import type { Editor, MemoryEntry } from '../editor';
import { Dialog } from './Dialogs';
import type { ImageFileAccess, ImageFileKind } from './files';
import {
  describeImage,
  FORMAT_LABELS,
  type ImageFileInfo,
  imageFileBytes,
  imageFileName,
  readImageForLoad,
} from './image-dialogs';
import { parseAddress } from './memory-view';

type Open =
  | { readonly kind: 'load'; readonly info: ImageFileInfo }
  | { readonly kind: 'save' }
  | { readonly kind: 'problem'; readonly message: string };

/**
 * The Memory tab's Load…, Save… and Erase buttons and their dialogs: Load reads a file and shows
 * what it holds before programming it (the programmer, R12b Q3); Save writes the memory as
 * `.bin` or Intel HEX; Erase sets every byte of a ROM to 0xFF (one undo step).
 */
export function MemoryImageActions({
  editor,
  entry,
  images,
}: {
  readonly editor: Editor;
  readonly entry: MemoryEntry;
  readonly images: ImageFileAccess;
}) {
  const [open, setOpen] = useState<Open | undefined>(undefined);
  const cells = editor.memory.cells(entry.id);
  const why = cells.kind === 'none' ? cells.reason : undefined;
  const close = () => setOpen(undefined);
  const load = async () => {
    try {
      const picked = await images.openBytes();
      if (!picked) return;
      const info = readImageForLoad(picked.name, picked.bytes);
      setOpen(
        typeof info === 'string' ? { kind: 'problem', message: info } : { kind: 'load', info },
      );
    } catch (error) {
      setOpen({ kind: 'problem', message: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <>
      <button
        type="button"
        className="tool-button memory-action"
        title={why ?? `Load a .bin or Intel HEX file into ${entry.id}`}
        disabled={why !== undefined}
        onClick={load}
      >
        <FileUp size={13} /> Load…
      </button>
      <button
        type="button"
        className="tool-button memory-action"
        title={why ?? `Save ${entry.id} as a .bin or Intel HEX file`}
        disabled={why !== undefined}
        onClick={() => setOpen({ kind: 'save' })}
      >
        <FileDown size={13} /> Save…
      </button>
      {!entry.volatile && (
        <button
          type="button"
          className="tool-button memory-action"
          title={`Set every byte of ${entry.id} to FF`}
          onClick={() => editor.memory.erase(entry.id)}
        >
          <Eraser size={13} /> Erase
        </button>
      )}
      {open?.kind === 'load' && (
        <LoadImageDialog editor={editor} entry={entry} info={open.info} onClose={close} />
      )}
      {open?.kind === 'save' && (
        <SaveImageDialog editor={editor} entry={entry} images={images} onClose={close} />
      )}
      {open?.kind === 'problem' && (
        <Dialog title="Can’t Load Image" onClose={close} testId="image-problem-dialog">
          <p className="mono">{open.message}</p>
          <div className="dialog-actions">
            <span className="dialog-actions-gap" />
            <button type="button" className="dialog-button primary" onClick={close}>
              OK
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** What a file holds, where it will land, and Program. */
function LoadImageDialog({
  editor,
  entry,
  info,
  onClose,
}: {
  readonly editor: Editor;
  readonly entry: MemoryEntry;
  readonly info: ImageFileInfo;
  readonly onClose: () => void;
}) {
  const [at, setAt] = useState(() =>
    formatAddress(suggestedLoadAddress(info.summary, entry.words)),
  );
  const [eraseRest, setEraseRest] = useState(true);
  const [problem, setProblem] = useState('');
  const target = parseAddress(at, entry.words);
  const writes =
    typeof target === 'string'
      ? target
      : placeImage(info.file, entry.words, { at: target, eraseRest });
  const { low, high } = info.summary;
  const program = () => {
    if (typeof writes === 'string') return;
    const failed = editor.memory.load(entry.id, writes);
    if (failed) setProblem(failed);
    else onClose();
  };
  return (
    <Dialog title={`Load Image into ${entry.id}`} onClose={onClose} testId="load-image-dialog">
      <dl className="image-facts">
        <dt>File</dt>
        <dd>
          {info.name} <span className="muted">({FORMAT_LABELS[info.format]})</span>
        </dd>
        <dt>Holds</dt>
        <dd className="mono" data-testid="image-summary">
          {describeImage(info.summary)}
        </dd>
        <dt>Memory</dt>
        <dd>{entry.label}</dd>
        <dt>
          <label htmlFor="image-at">Load at</label>
        </dt>
        <dd>
          <input
            id="image-at"
            className="prop-input mono image-at"
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
          {typeof writes !== 'string' && typeof target === 'number' && (
            <span className="muted mono">
              {' '}
              {formatAddress(low)} → {formatAddress(target)}, ends at{' '}
              {formatAddress(target + high - low)}
            </span>
          )}
        </dd>
      </dl>
      <label className="image-option">
        <input
          type="checkbox"
          checked={eraseRest}
          onChange={(event) => setEraseRest(event.target.checked)}
        />
        Fill the rest with FF (erase first, as a programmer does)
      </label>
      {entry.volatile && (
        <p className="muted">The simulated RAM takes the bytes now; a Reset loses them.</p>
      )}
      {(typeof writes === 'string' || problem !== '') && (
        <div className="field-error" role="status">
          {typeof writes === 'string' ? writes : problem}
        </div>
      )}
      <div className="dialog-actions">
        <span className="dialog-actions-gap" />
        <button type="button" className="dialog-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-button primary"
          disabled={typeof writes === 'string'}
          onClick={program}
        >
          Program
        </button>
      </div>
    </Dialog>
  );
}

/** `.bin` or Intel HEX, and Save. */
function SaveImageDialog({
  editor,
  entry,
  images,
  onClose,
}: {
  readonly editor: Editor;
  readonly entry: MemoryEntry;
  readonly images: ImageFileAccess;
  readonly onClose: () => void;
}) {
  const [kind, setKind] = useState<ImageFileKind>('binary');
  const [base, setBase] = useState('0x0000');
  const [omitErased, setOmitErased] = useState(!entry.volatile);
  const [problem, setProblem] = useState('');
  const contents = editor.memory.contents(entry.id);
  const start = parseAddress(base, 2 ** 32);
  const save = async () => {
    if (typeof contents === 'string' || typeof start === 'string') return;
    try {
      const bytes = imageFileBytes(contents.bytes, { kind, base: start, omitErased });
      const saved = await images.saveBytes(bytes, imageFileName(entry.id, kind), kind);
      if (saved !== undefined) onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Dialog title={`Save Image of ${entry.id}`} onClose={onClose} testId="save-image-dialog">
      <fieldset className="image-kinds">
        <label className="image-option">
          <input
            type="radio"
            name="image-kind"
            checked={kind === 'binary'}
            onChange={() => setKind('binary')}
          />
          Binary (.bin): every byte, from address 0
        </label>
        <label className="image-option">
          <input
            type="radio"
            name="image-kind"
            checked={kind === 'intel-hex'}
            onChange={() => setKind('intel-hex')}
          />
          Intel HEX (.hex)
        </label>
      </fieldset>
      {kind === 'intel-hex' && (
        <dl className="image-facts">
          <dt>
            <label htmlFor="image-base">Address of byte 0</label>
          </dt>
          <dd>
            <input
              id="image-base"
              className="prop-input mono image-at"
              value={base}
              onChange={(event) => setBase(event.target.value)}
            />
          </dd>
          <dt />
          <dd>
            <label className="image-option">
              <input
                type="checkbox"
                checked={omitErased}
                onChange={(event) => setOmitErased(event.target.checked)}
              />
              Leave out lines of FF
            </label>
          </dd>
        </dl>
      )}
      {typeof contents !== 'string' && contents.unknownBytes > 0 && (
        <p className="muted">
          {contents.unknownBytes} of {entry.words} bytes have unknown (X) bits: they are saved as 0.
        </p>
      )}
      {(typeof contents === 'string' || typeof start === 'string' || problem !== '') && (
        <div className="field-error" role="status">
          {typeof contents === 'string' ? contents : typeof start === 'string' ? start : problem}
        </div>
      )}
      <div className="dialog-actions">
        <span className="dialog-actions-gap" />
        <button type="button" className="dialog-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="dialog-button primary"
          disabled={typeof contents === 'string' || typeof start === 'string'}
          onClick={save}
        >
          Save…
        </button>
      </div>
    </Dialog>
  );
}
