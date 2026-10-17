const BLOG_ID = /^[a-z0-9][a-z0-9_-]{1,49}$/;

/** Browser and API share the same accepted public Naver blog address formats. */
export function parseNaverBlog(input: string): string | null {
  const value = input.trim();
  if (value.length > 300) return null;
  if (BLOG_ID.test(value.toLowerCase())) return value.toLowerCase();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return null;
    const path = url.pathname.split('/').filter(Boolean);
    const id = (/^(?:PostList|PostView|BlogHome)\.naver$/i.test(path[0] ?? '')
      ? url.searchParams.get('blogId') : path[0])?.toLowerCase();
    return id && BLOG_ID.test(id) ? id : null;
  } catch { return null; }
}
