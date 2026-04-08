import { buildSkillPath } from '$lib/skill-path';
import type { SkillCardData } from '$lib/types';
import { SITE_URL } from '$lib/seo/constants';

export interface SchemaListItem {
  '@type': 'ListItem';
  position: number;
  name: string;
  url: string;
}

export interface PathListItemInput {
  name: string;
  path: string;
}

export interface BreadcrumbListItemInput {
  name: string;
  item: string;
}

export interface CollectionPageStructuredDataInput {
  name: string;
  description: string;
  url: string;
  numberOfItems: number;
  itemListElement?: SchemaListItem[];
  itemListOrder?: string;
}

function isAbsoluteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function toAbsoluteUrl(value: string): string {
  if (isAbsoluteUrl(value)) {
    return value;
  }

  const normalizedValue = value.startsWith('/') ? value : `/${value}`;
  return `${SITE_URL}${normalizedValue}`;
}

export function buildSkillListItemElements(
  skills: SkillCardData[],
  options: {
    startPosition?: number;
    limit?: number;
  } = {}
): SchemaListItem[] {
  const startPosition = Math.max(1, options.startPosition ?? 1);
  const limit = Math.max(0, options.limit ?? skills.length);

  return skills.slice(0, limit).map((skill, index) => ({
    '@type': 'ListItem',
    position: startPosition + index,
    name: skill.name,
    url: toAbsoluteUrl(buildSkillPath(skill.slug)),
  }));
}

export function buildPathListItemElements(
  items: PathListItemInput[],
  options: {
    startPosition?: number;
    limit?: number;
  } = {}
): SchemaListItem[] {
  const startPosition = Math.max(1, options.startPosition ?? 1);
  const limit = Math.max(0, options.limit ?? items.length);

  return items.slice(0, limit).map((item, index) => ({
    '@type': 'ListItem',
    position: startPosition + index,
    name: item.name,
    url: toAbsoluteUrl(item.path),
  }));
}

export function buildCollectionPageStructuredData(
  input: CollectionPageStructuredDataInput
): Record<string, unknown> {
  const mainEntity: Record<string, unknown> = {
    '@type': 'ItemList',
    numberOfItems: input.numberOfItems,
  };

  if (input.itemListOrder) {
    mainEntity.itemListOrder = input.itemListOrder;
  }

  if (input.itemListElement && input.itemListElement.length > 0) {
    mainEntity.itemListElement = input.itemListElement;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: input.name,
    description: input.description,
    url: toAbsoluteUrl(input.url),
    mainEntity,
  };
}

export function buildBreadcrumbListStructuredData(
  items: BreadcrumbListItemInput[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.item),
    })),
  };
}
