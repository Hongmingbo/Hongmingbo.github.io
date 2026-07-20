import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const sortedPosts = posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: 'Hmingbo',
    description: '技术、设计与自动化。记录 AI Agent、前端工程、知识管理与自托管基础设施的实践与思考。',
    site: context.site ?? 'https://hongmingbo.github.io',
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      link: `/blog/${post.id.replace(/\.md$/, '')}/`,
      categories: post.data.tags,
    })),
    customData: '<language>zh-CN</language>',
  });
}
