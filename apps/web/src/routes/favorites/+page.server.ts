import type { PageServerLoad } from './$types';
import type { SkillCardData } from '$lib/types';

export const load: PageServerLoad = async ({ locals, platform, fetch }) => {
  // Check if user is authenticated
  const session = await locals.auth?.();
  const isAuthenticated = !!session?.user;

  if (!isAuthenticated) {
    return {
      favorites: [] as SkillCardData[],
      isAuthenticated: false,
    };
  }

  // Fetch user's favorites from API
  try {
    const response = await fetch('/api/favorites');
    if (!response.ok) {
      return {
        favorites: [] as SkillCardData[],
        isAuthenticated: true,
      };
    }

    const data = await response.json() as { favorites: SkillCardData[] };
    return {
      favorites: data.favorites,
      isAuthenticated: true,
    };
  } catch (error) {
    console.error('Error fetching favorites:', error);
    return {
      favorites: [] as SkillCardData[],
      isAuthenticated: true,
    };
  }
};
