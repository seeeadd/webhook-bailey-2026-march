/**
 * ThriveCart Webhook Router
 *
 * Receives ALL ThriveCart webhooks (account-level)
 * and routes to the correct FEA Create workflow based on product ID.
 *
 * ThriveCart sends POST as x-www-form-urlencoded.
 * We parse the product ID and forward to the right FEA Create webhook.
 */

const PRODUCT_ROUTES = {
  // Product 87 = VIP Kit ($47) → vip-buyer tag
  '87': {
    url: 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/54c039b6-a239-485b-8f6d-4ed13f12c0a4',
    tag: 'vip-buyer',
    name: 'VIP Kit'
  },
  // Product 85 = AI Income OS Standard ($1,897) → main-offer-buyer tag
  '85': {
    url: 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/6c51951e-0867-4f64-85ad-c708d65eb5c1',
    tag: 'main-offer-buyer',
    name: 'AI Income OS Standard'
  }
};

// Only forward these events
const ALLOWED_EVENTS = ['order.success', 'order.subscription_payment'];

module.exports = async function handler(req, res) {
  // ThriveCart pings with HEAD to verify the URL
  if (req.method === 'HEAD' || req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'thrivecart-webhook-router' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const event = body.event || body.thrivecart_event || '';
    const productId = String(body.base_product || body.product_id || '');
    const customerEmail = body.customer_email || body.email || '';
    const customerName = body.customer_name || body.name || '';

    console.log(`[TC Webhook] Event: ${event}, Product: ${productId}, Email: ${customerEmail}`);

    // Check if this event should be forwarded
    if (!ALLOWED_EVENTS.includes(event)) {
      console.log(`[TC Webhook] Skipping event: ${event}`);
      return res.status(200).json({ status: 'skipped', reason: `Event ${event} not in allowed list` });
    }

    // Find the route for this product
    const route = PRODUCT_ROUTES[productId];
    if (!route) {
      console.log(`[TC Webhook] No route for product: ${productId}`);
      return res.status(200).json({ status: 'skipped', reason: `No route for product ${productId}` });
    }

    console.log(`[TC Webhook] Routing to ${route.name} → ${route.tag}`);

    // Forward to FEA Create with structured data
    const payload = {
      email: customerEmail,
      first_name: customerName.split(' ')[0] || customerName,
      last_name: customerName.split(' ').slice(1).join(' ') || '',
      tags: [route.tag],
      source: `thrivecart-${route.name.toLowerCase().replace(/\s+/g, '-')}`,
      product_id: productId,
      event: event,
      // Pass through all original ThriveCart data
      thrivecart_data: body
    };

    const response = await fetch(route.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseStatus = response.status;
    console.log(`[TC Webhook] FEA Create response: ${responseStatus}`);

    return res.status(200).json({
      status: 'forwarded',
      product: route.name,
      tag: route.tag,
      fea_status: responseStatus
    });

  } catch (error) {
    console.error(`[TC Webhook] Error: ${error.message}`);
    // Always return 200 so ThriveCart doesn't retry
    return res.status(200).json({ status: 'error', message: error.message });
  }
}
