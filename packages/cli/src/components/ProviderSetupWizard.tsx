import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ProviderConfig } from '@nightfall/shared';
import { THEME } from '../theme.js';

type WizardStep = 'choose_provider' | 'enter_key' | 'enter_model' | 'configuring';
type ProviderChoice = 'anthropic' | 'openrouter' | 'ollama';

const PROVIDERS: { id: ProviderChoice; label: string; defaultModel: string }[] = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-4-6' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4-5' },
  { id: 'ollama', label: 'Ollama (local)', defaultModel: 'deepseek-r1:14b' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface ProviderSetupWizardProps {
  errorMessage: string;
  onComplete: (provider: ProviderConfig) => void;
}

export const ProviderSetupWizard: React.FC<ProviderSetupWizardProps> = ({
  errorMessage,
  onComplete,
}) => {
  const [step, setStep] = useState<WizardStep>('choose_provider');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  const selectedProvider = PROVIDERS[selectedIndex];

  useEffect(() => {
    if (step !== 'configuring') return;
    const id = setInterval(() => setSpinnerFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [step]);

  // Call onComplete once we enter the configuring step
  useEffect(() => {
    if (step !== 'configuring' || !selectedProvider) return;

    const providerName = selectedProvider.id;
    const resolvedModel = model || selectedProvider.defaultModel;

    let providerConfig: ProviderConfig;
    if (providerName === 'anthropic') {
      providerConfig = { name: 'anthropic', model: resolvedModel, api_key: apiKey || undefined };
    } else if (providerName === 'openrouter') {
      providerConfig = { name: 'openrouter', model: resolvedModel, api_key: apiKey || undefined };
    } else {
      providerConfig = { name: 'ollama', model: resolvedModel, host: 'localhost', port: 11434 };
    }

    onComplete(providerConfig);
  }, [step]); // intentionally omits other deps — only re-runs when step reaches 'configuring'

  // Handle keyboard input for provider selection and API key entry
  useInput(
    (input, key) => {
      if (step === 'choose_provider') {
        if (key.upArrow) {
          setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
          setSelectedIndex((i) => Math.min(PROVIDERS.length - 1, i + 1));
        } else if (key.return) {
          if (!selectedProvider) return;
          if (selectedProvider.id === 'ollama') {
            setModel(selectedProvider.defaultModel);
            setStep('enter_model');
          } else {
            setApiKey('');
            setStep('enter_key');
          }
        }
      } else if (step === 'enter_key') {
        if (key.return) {
          if (apiKey.trim().length > 0) {
            setModel(selectedProvider?.defaultModel ?? '');
            setStep('enter_model');
          }
        } else if (key.backspace || key.delete) {
          setApiKey((k) => k.slice(0, -1));
        } else if (input && !key.ctrl && !key.meta && input.length > 0) {
          setApiKey((k) => k + input);
        }
      }
    },
    { isActive: step === 'choose_provider' || step === 'enter_key' },
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color={THEME.primary}>
          Nightfall — Provider Setup
        </Text>
        {errorMessage && <Text color={THEME.error}>{errorMessage}</Text>}
      </Box>

      {step === 'choose_provider' && (
        <Box flexDirection="column">
          <Text color={THEME.textDim}>
            Select a provider (arrow keys to navigate, Enter to select):
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {PROVIDERS.map((p, i) => (
              <Text key={p.id} color={i === selectedIndex ? THEME.primary : THEME.textDim}>
                {i === selectedIndex ? '▶ ' : '  '}
                {p.label}
                <Text color={THEME.dim}> (default model: {p.defaultModel})</Text>
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {step === 'enter_key' && (
        <Box flexDirection="column">
          <Text color={THEME.textDim}>
            Enter your {selectedProvider?.label} API key (input is hidden):
          </Text>
          <Box marginTop={1}>
            <Text color={THEME.primary}>{'> '}</Text>
            <Text>{apiKey.length > 0 ? '*'.repeat(apiKey.length) : ''}</Text>
            {apiKey.length === 0 && <Text color={THEME.dim}>{'(start typing your key)'}</Text>}
          </Box>
          {apiKey.length > 0 && (
            <Text color={THEME.textDim} dimColor>
              Press Enter to continue
            </Text>
          )}
        </Box>
      )}

      {step === 'enter_model' && (
        <Box flexDirection="column">
          <Text color={THEME.textDim}>
            Model name (press Enter to use default: {selectedProvider?.defaultModel}):
          </Text>
          <Box marginTop={1}>
            <Text color={THEME.primary}>{'> '}</Text>
            <TextInput
              value={model}
              onChange={setModel}
              onSubmit={(val) => {
                if (!selectedProvider) return;
                setModel(val || selectedProvider.defaultModel);
                setStep('configuring');
              }}
            />
          </Box>
        </Box>
      )}

      {step === 'configuring' && (
        <Box>
          <Text color={THEME.primary}>{SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]}</Text>
          <Text color={THEME.textDim}> Configuring provider...</Text>
        </Box>
      )}
    </Box>
  );
};
