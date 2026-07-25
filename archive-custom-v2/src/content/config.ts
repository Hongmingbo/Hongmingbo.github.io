import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
  }),
});

const friends = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    url: z.string().url(),
    desc: z.string(),
    avatar: z.string().default(''),
  }),
});

export const collections = { blog, friends };
