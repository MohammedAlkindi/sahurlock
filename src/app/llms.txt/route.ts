import { PAGES, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

/** /llms.txt: a plain summary of the site for language models, built from the same page list as the sitemap. */
export function GET() {
  const pages = Object.entries(PAGES).map(([id, page]) => `- [${page.title}](${SITE_URL}/${id}): ${page.description}`);
  const text = [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    'SahurLock is free and open source under the MIT License. It has no accounts and no database: everything a student makes is saved in their own browser.',
    '',
    '## Pages',
    '',
    ...pages,
    '',
    '## More',
    '',
    `- [Privacy](${SITE_URL}/privacy): what stays on the device, what reaches a server, and the cookies set when Spotify is connected.`,
    `- [Terms](${SITE_URL}/terms)`,
    '- [Source code](https://github.com/MohammedAlkindi/sahurlock)',
    '',
  ].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
