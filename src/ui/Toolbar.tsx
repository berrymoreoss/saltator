import { Fragment, type ReactNode } from 'react';
import { type CommandRegistry, isEnabled } from './commands';
import { formatShortcut } from './shortcuts';

interface ToolbarProps {
  /** Command ids, or `widget:<name>` for an entry of `widgets` (the speed select). */
  readonly groups: readonly (readonly string[])[];
  readonly commands: CommandRegistry;
  readonly mac: boolean;
  readonly widgets?: Readonly<Record<string, ReactNode>>;
}

/**
 * Icon buttons for commands, in groups separated by dividers; toggles show as pressed. Re-renders
 * with its parent, which subscribes to the state the commands' checked/enabled flags read.
 */
export function Toolbar({ groups, commands, mac, widgets = {} }: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Main toolbar">
      {groups.map((group, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: groups are static
        <Fragment key={i}>
          {i > 0 && <div className="toolbar-divider" />}
          {group.map((id) => {
            if (id.startsWith('widget:')) {
              return <Fragment key={id}>{widgets[id.slice('widget:'.length)]}</Fragment>;
            }
            const command = commands.get(id);
            const Icon = command.stateIcon?.() ?? command.icon;
            const checked = command.checked?.();
            const shortcut = command.shortcuts?.[0];
            const title = `${command.title ?? command.label}${shortcut ? ` (${formatShortcut(shortcut, mac)})` : ''}`;
            return (
              <button
                key={id}
                type="button"
                className={checked ? 'tool-button pressed' : 'tool-button'}
                title={title}
                aria-label={command.title ?? command.label}
                aria-pressed={checked}
                disabled={!isEnabled(command)}
                onClick={() => command.run()}
              >
                {Icon ? <Icon size={16} strokeWidth={1.75} /> : command.label}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
