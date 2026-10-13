import inquirer from 'inquirer';
import { prompt, PromptCancelledError, terminalText } from './ui';

export interface Choice {
  name: string;
  value: string;
  checked?: boolean;
}

interface Selection {
  name: string;
  message: string;
  choices: Choice[];
}

export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const answer = (await prompt(`${terminalText(message)} ${defaultValue ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
  return answer === '' ? defaultValue : answer === 'y' || answer === 'yes';
}

export async function confirmText(message: string, expected: string): Promise<boolean> {
  return await prompt(`${terminalText(message)} Type the slug to confirm: `) === expected;
}

async function select(options: Selection, multiple: boolean): Promise<string | string[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive selection requires a terminal. Provide explicit options such as --yes, --skill/--agent, or --reason.');
  }
  try {
    const answer = await inquirer.prompt<Record<string, string | string[]>>([{
      type: multiple ? 'checkbox' : 'select', name: options.name,
      message: terminalText(options.message),
      choices: options.choices.map((choice) => ({ ...choice, name: terminalText(choice.name) })),
    }]);
    return answer[options.name];
  } catch (error) {
    if (error instanceof Error && ['ExitPromptError', 'CancelPromptError', 'AbortPromptError'].includes(error.name)) {
      throw new PromptCancelledError();
    }
    throw error;
  }
}

export async function selectMany(options: Selection): Promise<string[]> {
  const answer = await select(options, true);
  return Array.isArray(answer) ? answer : [];
}

export async function selectOne(options: Selection): Promise<string | undefined> {
  const answer = await select(options, false);
  return typeof answer === 'string' ? answer : undefined;
}
