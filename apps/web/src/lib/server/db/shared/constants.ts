import { CATEGORIES } from '$lib/constants/categories';

export const CACHE_VERSION_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
export const LIST_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
export const PREDEFINED_CATEGORY_SLUGS = CATEGORIES.map((category) => category.slug);
export const SEARCH_PAGE_MIN_FUZZY_HEAD_SCAN = 80;
export const SEARCH_PAGE_MAX_FUZZY_HEAD_SCAN = 240;
export const SEARCH_PAGE_FUZZY_HEAD_SCAN_MULTIPLIER = 12;
