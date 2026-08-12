import type { CollectionEntry } from "astro:content";

export type FeaturedPost = CollectionEntry<"posts">;

export function getFeaturedPosts(posts: FeaturedPost[], limit = 4): FeaturedPost[] {
	return [...posts]
		.filter((post) => post.data.featured && post.data.draft !== true)
		.sort((a, b) => {
			const rankA = a.data.featuredRank ?? Number.MAX_SAFE_INTEGER;
			const rankB = b.data.featuredRank ?? Number.MAX_SAFE_INTEGER;
			if (rankA !== rankB) return rankA - rankB;
			return new Date(b.data.published).getTime() - new Date(a.data.published).getTime();
		})
		.slice(0, limit);
}