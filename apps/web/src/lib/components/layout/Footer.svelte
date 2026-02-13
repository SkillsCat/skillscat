<script lang="ts">
  import Logo from '$lib/components/common/Logo.svelte';
</script>

<footer class="border-t border-border mt-16 bg-bg-subtle/50">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
      <!-- Brand -->
      <div class="md:col-span-1">
        <Logo size="sm" />
        <p class="mt-3 text-sm text-fg-muted">
          An open platform for discovering, sharing, and installing AI agent skills.
        </p>
      </div>

      <!-- Skills -->
      <div class="hidden md:block">
        <h4 class="font-semibold text-fg mb-3">Discover</h4>
        <ul class="space-y-2 text-sm">
          <li>
            <a href="/trending" class="text-fg-muted hover:text-fg transition-colors">Trending</a>
          </li>
          <li>
            <a href="/recent" class="text-fg-muted hover:text-fg transition-colors">Recently Added</a>
          </li>
          <li>
            <a href="/top" class="text-fg-muted hover:text-fg transition-colors">Top Rated</a>
          </li>
          <li>
            <a href="/categories" class="text-fg-muted hover:text-fg transition-colors">Categories</a>
          </li>
        </ul>
      </div>

      <!-- Resources -->
      <div class="hidden md:block">
        <h4 class="font-semibold text-fg mb-3">Resources</h4>
        <ul class="space-y-2 text-sm">
          <li>
            <a
              href="https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview"
              target="_blank"
              rel="noopener noreferrer"
              class="text-fg-muted hover:text-fg transition-colors"
            >
              Claude Code Docs
            </a>
          </li>
          <li>
            <a
              href="https://github.com/anthropics/claude-code"
              target="_blank"
              rel="noopener noreferrer"
              class="text-fg-muted hover:text-fg transition-colors"
            >
              Claude Code GitHub
            </a>
          </li>
          <li>
            <a
              href="https://cursor.com"
              target="_blank"
              rel="noopener noreferrer"
              class="text-fg-muted hover:text-fg transition-colors"
            >
              Cursor
            </a>
          </li>
        </ul>
      </div>

      <!-- Legal (hidden on mobile, shown in bottom bar instead) -->
      <div class="hidden md:block">
        <h4 class="font-semibold text-fg mb-3">Legal</h4>
        <ul class="space-y-2 text-sm">
          <li>
            <a href="/privacy" class="text-fg-muted hover:text-fg transition-colors">Privacy Policy</a>
          </li>
          <li>
            <a href="/terms" class="text-fg-muted hover:text-fg transition-colors">Terms of Service</a>
          </li>
        </ul>
      </div>
    </div>

    <!-- Bottom -->
    <div class="mt-8 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
        <p class="text-sm text-fg-subtle">
          © {new Date().getFullYear()} SkillsCat. Open source under AGPL-3.0.
        </p>
        <div class="flex items-center gap-3 md:hidden text-sm">
          <a href="/privacy" class="text-fg-subtle hover:text-fg transition-colors">Privacy</a>
          <span class="text-fg-subtle">·</span>
          <a href="/terms" class="text-fg-subtle hover:text-fg transition-colors">Terms</a>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <a
          href="https://github.com/skillscat/skillscat"
          target="_blank"
          rel="noopener noreferrer"
          class="text-fg-subtle hover:text-fg transition-colors"
          aria-label="GitHub"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
      </div>
    </div>
  </div>
</footer>
