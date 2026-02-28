import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { NightfallConfig, OllamaProviderConfig } from '@nightfall/shared';
import { THEME } from '../theme.js';

// ---------------------------------------------------------------------------
// Form field model
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'provider_toggle';

interface FormField {
  key: string;
  type: FieldType;
  value: string;
  originalValue: string;
  /** For provider_toggle: ordered list of valid values to cycle through */
  providers?: string[];
}

function buildFields(config: NightfallConfig): FormField[] {
  const isOllama = config.provider.name === 'ollama';
  const fields: FormField[] = [
    {
      key: 'provider',
      type: 'provider_toggle',
      value: config.provider.name,
      originalValue: config.provider.name,
      providers: ['ollama', 'openrouter'],
    },
    {
      key: 'model',
      type: 'string',
      value: config.provider.model,
      originalValue: config.provider.model,
    },
  ];

  if (isOllama) {
    const ollama = config.provider as OllamaProviderConfig;
    fields.push(
      {
        key: 'host',
        type: 'string',
        value: ollama.host,
        originalValue: ollama.host,
      },
      {
        key: 'port',
        type: 'number',
        value: String(ollama.port),
        originalValue: String(ollama.port),
      },
    );
  }

  fields.push(
    {
      key: 'max_engineers',
      type: 'number',
      value: String(config.concurrency.max_engineers),
      originalValue: String(config.concurrency.max_engineers),
    },
    {
      key: 'max_rework_cycles',
      type: 'number',
      value: String(config.task.max_rework_cycles),
      originalValue: String(config.task.max_rework_cycles),
    },
    {
      key: 'log_retention',
      type: 'number',
      value: String(config.logs.retention),
      originalValue: String(config.logs.retention),
    },
  );

  return fields;
}

function fieldsToConfig(fields: FormField[], base: NightfallConfig): NightfallConfig {
  const get = (key: string, fallback: string) =>
    fields.find((f) => f.key === key)?.value ?? fallback;

  const providerName = get('provider', base.provider.name);
  const model = get('model', base.provider.model);

  const provider: NightfallConfig['provider'] =
    providerName === 'ollama'
      ? {
          name: 'ollama',
          model,
          host: get('host', 'localhost'),
          port: parseInt(get('port', '11434'), 10),
        }
      : { name: 'openrouter', model };

  return {
    provider,
    concurrency: { max_engineers: parseInt(get('max_engineers', '1'), 10) },
    task: { max_rework_cycles: parseInt(get('max_rework_cycles', '3'), 10) },
    logs: { retention: parseInt(get('log_retention', '50'), 10) },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SettingsViewProps {
  initialConfig: NightfallConfig;
  onSave: (config: NightfallConfig) => void;
  onExit: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialConfig,
  onSave,
  onExit,
}) => {
  const [fields, setFields] = useState<FormField[]>(() => buildFields(initialConfig));
  const [cursorIndex, setCursorIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const isEditing = editingIndex !== null;

  useInput((input, key) => {
    if (isEditing) {
      const idx = editingIndex;
      const field = fields[idx];
      if (!field) return;

      if (key.escape) {
        // Discard — restore original value for this field
        setFields((prev) =>
          prev.map((f, i) => (i === idx ? { ...f, value: f.originalValue } : f)),
        );
        setEditingIndex(null);
        return;
      }

      if (key.return) {
        setEditingIndex(null);
        return;
      }

      if (key.backspace || key.delete) {
        setFields((prev) =>
          prev.map((f, i) => (i === idx ? { ...f, value: f.value.slice(0, -1) } : f)),
        );
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setFields((prev) =>
          prev.map((f, i) => (i === idx ? { ...f, value: f.value + input } : f)),
        );
      }
      return; // Consume all input while in edit mode
    }

    // ── Navigation mode ──────────────────────────────────────────────────────

    if (key.escape) {
      onExit();
      return;
    }

    if (key.upArrow) {
      setCursorIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setCursorIndex((i) => Math.min(fields.length - 1, i + 1));
      return;
    }

    if (key.return) {
      const field = fields[cursorIndex];
      if (!field) return;

      if (field.type === 'provider_toggle') {
        // Cycle provider and rebuild the field list (adds/removes host+port)
        const providers = field.providers ?? ['ollama', 'openrouter'];
        const nextProvider = providers[(providers.indexOf(field.value) + 1) % providers.length] ?? field.value;
        const currentConfig = fieldsToConfig(fields, initialConfig);
        const rebased: NightfallConfig = {
          ...currentConfig,
          provider:
            nextProvider === 'ollama'
              ? { name: 'ollama', model: currentConfig.provider.model, host: 'localhost', port: 11434 }
              : { name: 'openrouter', model: currentConfig.provider.model },
        };
        setFields(buildFields(rebased));
        setCursorIndex(0);
        return;
      }

      // Enter text/number edit mode
      setEditingIndex(cursorIndex);
      return;
    }

    if ((input === 's' || input === 'S') && !key.ctrl && !key.meta) {
      onSave(fieldsToConfig(fields, initialConfig));
      return;
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.accent} paddingX={2} paddingY={1}>
      <Text bold color={THEME.primary}>◆ SETTINGS</Text>
      <Text color={THEME.textDim}>Changes take effect on restart.</Text>

      <Box marginTop={1} flexDirection="column">
        {fields.map((field, i) => {
          const isSelected = i === cursorIndex;
          const isActiveEdit = i === editingIndex;
          const isDirty = field.value !== field.originalValue;

          return (
            <Box key={field.key}>
              <Text color={isSelected ? THEME.primary : THEME.textDim}>
                {isSelected ? '▶ ' : '  '}
                {field.key.padEnd(20)}
              </Text>
              {isActiveEdit ? (
                <Text color={THEME.text}>
                  {field.value}
                  <Text color={THEME.primary}>▌</Text>
                </Text>
              ) : (
                <Text color={isDirty ? THEME.warning : THEME.text}>
                  {field.value}
                  {isDirty ? ' *' : ''}
                  {field.type === 'provider_toggle' && !isActiveEdit ? '  [Enter to toggle]' : ''}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {isEditing ? (
          <Text color={THEME.dim}>Enter: confirm · Esc: discard field</Text>
        ) : (
          <Text color={THEME.dim}>↑↓: navigate · Enter: edit/toggle · S: save · Esc: cancel</Text>
        )}
      </Box>
    </Box>
  );
};
