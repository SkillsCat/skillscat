<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Redirect to skills page as the default settings view
  onMount(() => {
    goto('/settings/skills', { replaceState: true });
  });
</script>

<svelte:head>
  <title>Settings - SkillsCat</title>
</svelte:head>

<div class="redirect-message">
  <p>Redirecting to settings...</p>
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
