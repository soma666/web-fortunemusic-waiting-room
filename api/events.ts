import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (_req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const response = await fetch('https://fm.proxies.n46.io/v1/appGetEventData/');

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      console.error('Events proxy upstream error', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.slice(0, 500),
      });
      res.status(response.status).json({
        error: `Upstream API returned ${response.status} ${response.statusText}`,
        source: 'events-proxy',
        upstream: 'fm.proxies.n46.io',
        status: response.status,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Events proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch from upstream events API',
      source: 'events-proxy',
      upstream: 'fm.proxies.n46.io',
    });
  }
}