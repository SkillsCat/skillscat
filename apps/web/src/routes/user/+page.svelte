<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { useI18n } from '$lib/i18n/runtime';

  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  // Redirect to skills page as the default user view
  onMount(() => {
    goto('/user/skills', { replaceState: true });
  });
</script>

<svelte:head>
  <title>{messages.settingsLayout.title} - SkillsCat</title>
</svelte:head>

<div class="redirect-message">
  <p>{messages.common.loading}</p>
</div>

<style>
  .redirect-message {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: var(--muted-foreground);
  }
</style>
