<script lang="ts">
  import '../app.css';
  import { Navbar, Footer } from '$lib/components';

  let { children } = $props();
</script>

<div class="min-h-screen flex flex-col">
  <Navbar />

  <main class="flex-1">
    {@render children()}
  </main>

  <Footer />
</div>
