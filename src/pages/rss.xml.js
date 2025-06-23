import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = [
    {
      title: "Psychology of the Independent Creator",
      description: "Exploring how ideologies shape identity and the importance of maintaining youthful ideals in creative work",
      slug: "psych-of-independent-creator",
      date: "2023-07-25",
      year: 2023
    },
    {
      title: "The Power of Youthful Ideologies",
      description: "A reflection on how maintaining youthful ideals can shape our identity and creative journey",
      slug: "youthful-ideologies",
      date: "2023-06-28",
      year: 2023
    }
  ];

  return rss({
    title: 'Kang Astro Blog',
    description: 'A collection of personal notes and thoughts',
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      description: post.description,
      pubDate: new Date(post.date),
      link: `/blog/${post.slug}/`,
    })),
  });
} 