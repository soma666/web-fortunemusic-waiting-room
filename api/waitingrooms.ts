import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const response = await fetch('https://fm.proxies.n46.io/lapi/v5/app/dateTimezoneMessages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      console.error('Waiting rooms proxy upstream error', {
        status: response.status,
        statusText: response.statusText,
        body: responseText.slice(0, 500),
        requestBody: req.body,
      });
      res.status(response.status).json({
        error: `Upstream API returned ${response.status} ${response.statusText}`,
        source: 'waitingrooms-proxy',
        upstream: 'fm.proxies.n46.io',
        status: response.status,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('Waiting rooms proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch from upstream waiting rooms API',
      source: 'waitingrooms-proxy',
      upstream: 'fm.proxies.n46.io',
    });
  }
}