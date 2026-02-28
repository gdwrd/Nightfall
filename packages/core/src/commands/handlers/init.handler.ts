import { initializeMemoryBank, previewMemoryBank } from '../../memory/memory.init.js';
import type { CommandDispatcherContext } from '../command.dispatcher.js';

export async function initHandler(ctx: CommandDispatcherContext, args: string): Promise<string> {
  try {
    if (args.trim() === 'confirm') {
      const result = await initializeMemoryBank(ctx.projectRoot);
      const fileList = result.filesCreated.map((f) => `  ${f}`).join('\n');
      return `✓ Memory bank initialized in .nightfall/memory/\n${fileList}`;
    }

    const preview = await previewMemoryBank(ctx.projectRoot);
    const maxPath = Math.max(...preview.files.map((f) => f.path.length));
    const fileLines = preview.files
      .map((f) => `  ${f.path.padEnd(maxPath + 2)}— ${f.description}`)
      .join('\n');

    return [
      'Memory bank preview — files to be created:',
      '',
      fileLines,
      '',
      'Type y to create or n to cancel.',
    ].join('\n');
  } catch (err) {
    return `Error during /init: ${err instanceof Error ? err.message : String(err)}`;
  }
}
