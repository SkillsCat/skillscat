<script lang="ts">
  import { page } from '$app/stores';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import { SITE_DESCRIPTION } from '$lib/seo/constants';

  // 根据状态码获取默认标题
  function getDefaultTitle(status: number): string {
    switch (status) {
      case 400: return 'Bad Request';
      case 401: return 'Unauthorized';
      case 403: return 'Forbidden';
      case 404: return 'Page Not Found';
      case 500: return 'Server Error';
      case 502: return 'Bad Gateway';
      case 503: return 'Service Unavailable';
      default: return 'Something went wrong';
    }
  }

  // 根据状态码获取默认消息
  function getDefaultMessage(status: number): string {
    switch (status) {
      case 400: return 'The request could not be understood by the server.';
      case 401: return 'You need to be logged in to access this page.';
      case 403: return "You don't have permission to access this page.";
      case 404: return "The page you're looking for doesn't exist or has been moved.";
      case 500: return 'An unexpected error occurred on the server.';
      case 502: return 'The server received an invalid response.';
      case 503: return 'The service is temporarily unavailable. Please try again later.';
      default: return 'An unexpected error occurred.';
    }
  }

  const status = $derived($page.status);
  const title = $derived(getDefaultTitle(status));
  const message = $derived($page.error?.message || getDefaultMessage(status));
</script>

<svelte:head>
  <title>{status} - SkillsCat</title>
  <meta name="description" content={SITE_DESCRIPTION} />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<ErrorState
  code={status}
  {title}
  {message}
  fullPage
  primaryActionText="Go Home"
  primaryActionHref="/"
  secondaryActionText="Go Back"
  secondaryActionClick={() => history.back()}
/>
