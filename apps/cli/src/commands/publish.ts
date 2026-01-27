import pc from 'picocolors';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { isAuthenticated, getToken } from '../utils/auth.js';
import { REGISTRY_URL } from '../utils/paths.js';
import { box, prompt, warn } from '../utils/ui.js';

interface PublishOptions {
  name?: string;
  org?: string;
  public?: boolean;
  description?: string;
  yes?: boolean;  // Skip confirmation
}

interface PreviewResponse {
  success: boolean;
  preview?: {
    name: string;
    slug: string;
    description: string | null;
    categories: string[];
    owner: string;
  };
  warnings?: string[];
  error?: string;
}

interface UploadResponse {
  success: boolean;
  slug?: string;
  name?: string;
  description?: string | null;
  categories?: string[];
  message?: string;
  error?: string;
}

/**
 * Get preview of skill metadata before publishing
 */
async function getPreview(content: string, org?: string): Promise<PreviewResponse> {
  const contentBase64 = Buffer.from(content).toString('base64');
  const params = new URLSearchParams({ content: contentBase64 });
  if (org) {
    params.append('org', org);
  }

  const response = await fetch(
    `${REGISTRY_URL.replace('/api/registry', '')}/api/skills/upload?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
    }
  );

  return response.json() as Promise<PreviewResponse>;
}

export async function publish(skillPath: string, options: PublishOptions): Promise<void> {
  // Check authentication
  if (!isAuthenticated()) {
    console.error(pc.red('Authentication required.'));
    console.log(pc.dim('Run `skillscat login` first.'));
    process.exit(1);
  }

  // Resolve skill path
  const resolvedPath = resolve(skillPath);
  let skillMdPath = resolvedPath;

  // If path is a directory, look for SKILL.md
  if (existsSync(resolvedPath) && !resolvedPath.endsWith('.md')) {
    skillMdPath = resolve(resolvedPath, 'SKILL.md');
  }

  if (!existsSync(skillMdPath)) {
    console.error(pc.red(`SKILL.md not found at ${skillMdPath}`));
    process.exit(1);
  }

  // Read SKILL.md content
  const content = readFileSync(skillMdPath, 'utf-8');

  // Get preview first
  console.log(pc.cyan('Analyzing skill...'));
  console.log();

  try {
    const previewResult = await getPreview(content, options.org);

    if (!previewResult.success || !previewResult.preview) {
      console.error(pc.red(`Failed to analyze skill: ${previewResult.error || 'Unknown error'}`));
      process.exit(1);
    }

    const { preview, warnings } = previewResult;

    // Show preview box
    const previewContent = [
      `Name: ${pc.cyan(preview.name)}`,
      `Slug: ${pc.cyan(preview.slug)}`,
      `Description: ${preview.description ? pc.dim(preview.description.slice(0, 60) + (preview.description.length > 60 ? '...' : '')) : pc.dim('(none)')}`,
      `Categories: ${preview.categories.length > 0 ? pc.cyan(preview.categories.join(', ')) : pc.dim('(auto-classified)')}`,
      `Visibility: ${pc.dim(options.public ? 'public' : 'private')}`,
    ].join('\n');

    box(previewContent, 'Skill Preview');
    console.log();

    // Show warnings
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        warn(w);
      }
      console.log();
    }

    // Show immutable slug warning
    console.log(pc.yellow('⚠️  Warning: The slug cannot be changed after publishing.'));
    console.log();

    // Confirm unless --yes flag is provided
    if (!options.yes) {
      const answer = await prompt(`Publish ${pc.cyan(preview.slug)}? [y/N] `);
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(pc.dim('Cancelled.'));
        process.exit(0);
      }
      console.log();
    }

    // Proceed with upload
    console.log(pc.cyan('Publishing skill...'));

    // Prepare form data
    const formData = new FormData();
    formData.append('skill_md', new Blob([content], { type: 'text/markdown' }), 'SKILL.md');
    formData.append('name', options.name || preview.name);
    formData.append('visibility', options.public ? 'public' : 'private');

    if (options.org) {
      formData.append('org', options.org);
    }

    if (options.description) {
      formData.append('description', options.description);
    }

    const response = await fetch(`${REGISTRY_URL.replace('/api/registry', '')}/api/skills/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
      body: formData,
    });

    const result = await response.json() as UploadResponse;

    if (!response.ok || !result.success) {
      console.error(pc.red(`Failed to publish: ${result.error || result.message || 'Unknown error'}`));
      process.exit(1);
    }

    console.log(pc.green('✔ Skill published successfully!'));
    console.log();
    console.log(`  Slug: ${pc.cyan(result.slug)}`);
    console.log(`  Visibility: ${pc.dim(options.public ? 'public' : 'private')}`);
    if (result.categories && result.categories.length > 0) {
      console.log(`  Categories: ${pc.dim(result.categories.join(', '))}`);
    }
    console.log();
    console.log(pc.dim('To install this skill:'));
    console.log(pc.cyan(`  skillscat add ${result.slug}`));
  } catch (error) {
    console.error(pc.red('Failed to connect to registry.'));
    if (error instanceof Error) {
      console.error(pc.dim(error.message));
    }
    process.exit(1);
  }
}
