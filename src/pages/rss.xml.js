import rss from '@astrojs/rss';

export async function GET(context) {
  // Dynamically import all blog posts from the content directory
  const postImports = import.meta.glob('../content/posts/*.md', { eager: true });

  const posts = Object.entries(postImports).map(([path, post]) => {
    // Extract slug from file path
    const slug = path.split('/').pop().replace(/\.md$/, '');

    return {
      title: post.frontmatter?.title || 'Untitled',
      description: post.frontmatter?.description || '',
      slug: slug,
      date: post.frontmatter?.date || new Date().toISOString(),
    };
  }).filter(post => post.title !== 'Untitled'); // Filter out posts without frontmatter

  // Sort posts by date (newest first)
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

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