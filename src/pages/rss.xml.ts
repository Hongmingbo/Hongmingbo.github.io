import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const sortedPosts = posts.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: 'Hmingbo',
    description: '一名即将高一的学生,在课余探索 AI Agent、前端、自托管与知识管理。这里记录我的学习笔记、方法论和踩坑心得。',
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
