import type { NightfallConfig } from '@nightfall/shared';
import type { CommandDispatcherContext } from '../command.dispatcher.js';
import { writeConfig } from '../../config/config.loader.js';

interface SettingsViewPayload {
  type: 'settings_view';
  config: NightfallConfig;
}

interface SettingsSavedPayload {
  type: 'settings_saved';
  config: NightfallConfig;
}

interface ErrorPayload {
  type: 'error';
  message: string;
}

export async function settingsHandler(
  ctx: CommandDispatcherContext,
  args: string,
): Promise<string> {
  const trimmed = args.trim();

  // Sub-command: save <jsonPayload>
  if (trimmed.startsWith('save ')) {
    const jsonStr = trimmed.slice('save '.length).trim();
    let incoming: NightfallConfig;
    try {
      incoming = JSON.parse(jsonStr) as NightfallConfig;
    } catch {
      return JSON.stringify({ type: 'error', message: 'Invalid settings JSON.' } satisfies ErrorPayload);
    }

    try {
      writeConfig(incoming);
      return JSON.stringify({ type: 'settings_saved', config: incoming } satisfies SettingsSavedPayload);
    } catch (err) {
      return JSON.stringify({
        type: 'error',
        message: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies ErrorPayload);
    }
  }

  // Default: return current config for the settings view
  return JSON.stringify({ type: 'settings_view', config: ctx.config } satisfies SettingsViewPayload);
}
