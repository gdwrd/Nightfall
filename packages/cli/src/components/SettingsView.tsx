import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { NightfallConfig, OllamaProviderConfig, AnthropicProviderConfig } from '@nightfall/shared';
import { THEME } from '../theme.js';

// ---------------------------------------------------------------------------
// Form field model
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'provider_toggle' | 'section_toggle';

interface FormField {
  key: string;
  type: FieldType;
  value: string;
  originalValue: string;
  /** For provider_toggle: ordered list of valid values to cycle through */
  providers?: string[];
}

// Default per-role max_iterations (mirrors agent.factory.ts hardcoded defaults)
const AGENT_ITERATION_DEFAULTS: Record<string, number> = {
  'team-lead': 20,
  'engineer': 30,
  'reviewer': 20,
  'memory-manager': 20,
};

function buildFields(config: NightfallConfig, agentSectionExpanded: boolean): FormField[] {
  const isOllama = config.provider.name === 'ollama';
  const fields: FormField[] = [
    {
      key: 'provider',
      type: 'provider_toggle',
      value: config.provider.name,
      originalValue: config.provider.name,
      providers: ['ollama', 'openrouter', 'anthropic'],
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

  // Collapsible agent iteration limits section
  fields.push({
    key: '__agent_limits_toggle',
    type: 'section_toggle',
    value: agentSectionExpanded ? 'expanded' : 'collapsed',
    originalValue: 'collapsed',
  });

  if (agentSectionExpanded) {
    const agentsCfg = config.agents ?? {};
    const roles = ['team-lead', 'engineer', 'reviewer', 'memory-manager'] as const;
    for (const role of roles) {
      const defaultVal = AGENT_ITERATION_DEFAULTS[role] ?? 20;
      const val = agentsCfg[role]?.max_iterations ?? defaultVal;
      fields.push({
        key: `agent:${role}:max_iterations`,
        type: 'number',
        value: String(val),
        originalValue: String(val),
      });
    }
  }

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
      : providerName === 'anthropic'
        ? ((): AnthropicProviderConfig => {
            const anthropic = base.provider as AnthropicProviderConfig;
            return { name: 'anthropic', model, ...(anthropic.api_key ? { api_key: anthropic.api_key } : {}) };
          })()
        : { name: 'openrouter', model };

  // Collect per-role agent iteration overrides
  const agentFields = fields.filter((f) => f.key.startsWith('agent:') && f.key.endsWith(':max_iterations'));
  let agents: NightfallConfig['agents'];
  if (agentFields.length > 0) {
    agents = {};
    for (const f of agentFields) {
      const parts = f.key.split(':');
      // key format: "agent:<role>:max_iterations"
      const role = parts.slice(1, -1).join(':') as 'team-lead' | 'engineer' | 'reviewer' | 'memory-manager';
      const val = parseInt(f.value, 10);
      if (!isNaN(val) && val > 0) {
        agents[role] = { max_iterations: val };
      }
    }
    if (Object.keys(agents).length === 0) agents = undefined;
  }

  const parseIntSafe = (raw: string, fallback: number): number => {
    const v = parseInt(raw, 10);
    return isNaN(v) || v < 1 ? fallback : v;
  };

  return {
    provider,
    concurrency: { max_engineers: parseIntSafe(get('max_engineers', '1'), base.concurrency.max_engineers) },
    task: {
      max_rework_cycles: parseIntSafe(get('max_rework_cycles', '3'), base.task.max_rework_cycles),
      max_retries: base.task.max_retries,
      max_context_tokens: base.task.max_context_tokens,
    },
    logs: { retention: parseIntSafe(get('log_retention', '50'), base.logs.retention) },
    ...(agentFields.length > 0
      ? agents !== undefined ? { agents } : {}
      : base.agents !== undefined ? { agents: base.agents } : {}),
    ...(base.context_window !== undefined ? { context_window: base.context_window } : {}),
    ...(base.memoryNamespace !== undefined ? { memoryNamespace: base.memoryNamespace } : {}),
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
  const [agentSectionExpanded, setAgentSectionExpanded] = useState(false);
  const [fields, setFields] = useState<FormField[]>(() => buildFields(initialConfig, false));
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
              : nextProvider === 'anthropic'
                ? { name: 'anthropic', model: currentConfig.provider.model }
                : { name: 'openrouter', model: currentConfig.provider.model },
        };
        setFields(buildFields(rebased, agentSectionExpanded));
        setCursorIndex(0);
        return;
      }

      if (field.type === 'section_toggle') {
        // Toggle the agent limits section
        const newExpanded = !agentSectionExpanded;
        setAgentSectionExpanded(newExpanded);
        const currentConfig = fieldsToConfig(fields, initialConfig);
        const rebuilt = buildFields(currentConfig, newExpanded);
        setFields(rebuilt);
        // Keep cursor on the toggle row (its index stays the same since we insert after it)
        setCursorIndex((i) => Math.min(i, rebuilt.length - 1));
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

          if (field.type === 'section_toggle') {
            const isExpanded = field.value === 'expanded';
            return (
              <Box key={field.key}>
                <Text color={isSelected ? THEME.primary : THEME.textDim}>
                  {isSelected ? '▶ ' : '  '}
                  {isExpanded ? '▼ Agent iteration limits' : '▶ Agent iteration limits'}
                  <Text color={THEME.dim}>  [Enter to {isExpanded ? 'collapse' : 'expand'}]</Text>
                </Text>
              </Box>
            );
          }

          const isAgentField = field.key.startsWith('agent:');
          const displayKey = isAgentField
            ? '  ' + field.key.replace('agent:', '').replace(':max_iterations', '') + ':max_iter'
            : field.key;

          return (
            <Box key={field.key}>
              <Text color={isSelected ? THEME.primary : THEME.textDim}>
                {isSelected ? '▶ ' : '  '}
                {displayKey.padEnd(22)}
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
