<script lang="ts">
  import { page } from '$app/stores';
  import ErrorState from '$lib/components/feedback/ErrorState.svelte';
  import { useI18n } from '$lib/i18n/runtime';

  // 根据状态码获取默认标题
  const i18n = useI18n();
  const messages = $derived(i18n.messages());

  function getDefaultTitle(status: number): string {
    switch (status) {
      case 400: return messages.errorPage.badRequestTitle;
      case 401: return messages.errorPage.unauthorizedTitle;
      case 403: return messages.errorPage.forbiddenTitle;
      case 404: return messages.errorPage.notFoundTitle;
      case 500: return messages.errorPage.serverErrorTitle;
      case 502: return messages.errorPage.badGatewayTitle;
      case 503: return messages.errorPage.serviceUnavailableTitle;
      default: return messages.errorPage.defaultTitle;
    }
  }

  // 根据状态码获取默认消息
  function getDefaultMessage(status: number): string {
    switch (status) {
      case 400: return messages.errorPage.badRequestMessage;
      case 401: return messages.errorPage.unauthorizedMessage;
      case 403: return messages.errorPage.forbiddenMessage;
      case 404: return messages.errorPage.notFoundMessage;
      case 500: return messages.errorPage.serverErrorMessage;
      case 502: return messages.errorPage.badGatewayMessage;
      case 503: return messages.errorPage.serviceUnavailableMessage;
      default: return messages.errorPage.defaultMessage;
    }
  }

  const status = $derived($page.status);
  const title = $derived(getDefaultTitle(status));
  const message = $derived($page.error?.message || getDefaultMessage(status));
</script>

<svelte:head>
  <title>{status} - SkillsCat</title>
  <meta name="description" content={message} />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<ErrorState
  code={status}
  {title}
  {message}
  fullPage
  primaryActionText={messages.common.goHome}
  primaryActionHref="/"
  secondaryActionText={messages.common.goBack}
  secondaryActionClick={() => history.back()}
/>
