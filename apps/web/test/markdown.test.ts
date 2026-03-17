import { describe, expect, it } from 'vitest';
import { renderReadmeMarkdown } from '../src/lib/server/text/markdown';

describe('renderReadmeMarkdown', () => {
  it('preserves safe raw HTML while stripping dangerous tags and attributes', () => {
    const html = renderReadmeMarkdown(`
<details open>
  <summary>More</summary>
  <p><img src="https://example.com/demo.png" alt="demo" width="640" onerror="alert(1)" style="color:red"></p>
  <script>alert(1)</script>
  <iframe src="https://evil.test/embed"></iframe>
</details>
    `);

    expect(html).toContain('<details open>');
    expect(html).toContain('<summary>More</summary>');
    expect(html).toContain('<img src="https://example.com/demo.png" alt="demo" width="640">');
    expect(html).not.toContain('onerror');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;iframe src=&quot;https://evil.test/embed&quot;&gt;&lt;/iframe&gt;');
  });

  it('blocks unsafe markdown image URLs', () => {
    const html = renderReadmeMarkdown('![x](javascript:alert(1))');

    expect(html).not.toContain('<img');
    expect(html).toContain('<p></p>');
  });

  it('keeps safe markdown images and relative file links working', () => {
    const html = renderReadmeMarkdown(`
![Logo](https://example.com/logo.png "Logo")

[Guide](docs/guide.md)
    `);

    expect(html).toContain('<img src="https://example.com/logo.png" alt="Logo" loading="lazy" title="Logo">');
    expect(html).toContain('class="file-link"');
    expect(html).toContain('data-file-path="docs/guide.md"');
  });

  it('preserves renderer metadata needed by the skill page for code blocks', () => {
    const html = renderReadmeMarkdown(`
\`\`\`ts:src/index.ts
const answer = 42;
\`\`\`
    `);

    expect(html).toContain('class="code-block-wrapper"');
    expect(html).toContain('class="code-block-header"');
    expect(html).toContain('<span>src/index.ts</span>');
    expect(html).toContain('class="language-ts"');
    expect(html).toContain('data-language="ts"');
  });

  it('sanitizes raw HTML hrefs that hide javascript with entities', () => {
    const html = renderReadmeMarkdown('<a href="java&#x73;cript:alert(1)" onclick="alert(1)">Click me</a>');

    expect(html).toContain('<a>Click me</a>');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('onclick');
  });

  it('keeps markdown task list checkboxes renderable', () => {
    const html = renderReadmeMarkdown('- [x] done');

    expect(html).toContain('<input');
    expect(html).toContain('checked');
    expect(html).toContain('disabled');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('done');
  });
});
