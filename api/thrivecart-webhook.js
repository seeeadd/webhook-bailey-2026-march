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
  // Product 85 = AI Income OS ($1,997) → os-buyer tag
  '85': {
    url: 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/6c51951e-0867-4f64-85ad-c708d65eb5c1',
    tag: 'os-buyer',
    name: 'AI Income OS'
  },
  // Product 89 = AI Design & Grow Experience → adg-buyer tag
  '89': {
    url: 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/6c51951e-0867-4f64-85ad-c708d65eb5c1',
    tag: 'adg-buyer',
    name: 'AI Design and Grow'
  }
};

// Shared workflow that tags VIP upsell acceptances (used for multiple flows)
const VIP_UPSELL_WORKFLOW_URL = 'https://services.leadconnectorhq.com/hooks/mRbOcEobWT5kQ5hBurus/webhook-trigger/37b35d29-c687-4d4a-a651-c9396e04f3a0';

// Main purchase events that route by PRODUCT_ROUTES
const ALLOWED_EVENTS = ['order.success', 'order.subscription_payment'];

// Upsell events get special handling — they forward to VIP_UPSELL_WORKFLOW_URL
const UPSELL_ACCEPTED_EVENTS = ['order.upsell_accepted', 'order.upsell.accepted'];
const UPSELL_DECLINED_EVENTS = ['order.upsell_declined', 'order.upsell.declined'];

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

    // Log raw body for debugging
    console.log(`[TC Webhook] Raw body keys: ${Object.keys(body).join(', ')}`);

    const event = body.event || '';
    const productId = String(body.base_product || '');

    // ThriveCart nests customer data inside a 'customer' object
    // Handles both nested (customer.email) and flat (customer[email]) formats
    const customer = body.customer || {};
    const customerEmail = customer.email || body['customer[email]'] || body.customer_email || body.email || '';
    const customerFirstName = customer.firstname || body['customer[firstname]'] || '';
    const customerLastName = customer.lastname || body['customer[lastname]'] || '';
    const customerName = customer.name || body['customer[name]'] || body.customer_name || `${customerFirstName} ${customerLastName}`.trim();

    console.log(`[TC Webhook] Event: ${event}, Product: ${productId}, Email: ${customerEmail}, Name: ${customerName}`);

    // VIP upsell accepted — forward to dedicated VIP tagging workflow
    if (UPSELL_ACCEPTED_EVENTS.includes(event)) {
      console.log(`[TC Webhook] VIP upsell accepted → forwarding to VIP tagging workflow`);
      const vipPayload = {
        email: customerEmail,
        first_name: customerFirstName || customerName.split(' ')[0] || customerName,
        last_name: customerLastName || customerName.split(' ').slice(1).join(' ') || '',
        tags: ['vip-buyer'],
        source: 'thrivecart-vip-upsell',
        product_id: productId,
        event: event,
        thrivecart_data: body
      };
      const vipResponse = await fetch(VIP_UPSELL_WORKFLOW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vipPayload)
      });
      console.log(`[TC Webhook] VIP workflow response: ${vipResponse.status}`);
      return res.status(200).json({
        status: 'forwarded',
        destination: 'vip-upsell-workflow',
        tag: 'vip-buyer',
        fea_status: vipResponse.status
      });
    }

    // VIP upsell declined — main purchase already tagged them on order.success, nothing to do
    if (UPSELL_DECLINED_EVENTS.includes(event)) {
      console.log(`[TC Webhook] VIP upsell declined → no additional tagging`);
      return res.status(200).json({ status: 'skipped', reason: 'upsell declined — base buyer tag already applied on order.success' });
    }

    // If no event field, still try to forward (some webhook formats differ)
    if (event && !ALLOWED_EVENTS.includes(event)) {
      console.log(`[TC Webhook] Skipping event: ${event}`);
      return res.status(200).json({ status: 'skipped', reason: `Event ${event} not in allowed list` });
    }

    // Find the route for this product
    const route = PRODUCT_ROUTES[productId];
    if (!route) {
      console.log(`[TC Webhook] No route for product: ${productId}. Full body: ${JSON.stringify(body).slice(0, 500)}`);
      return res.status(200).json({ status: 'skipped', reason: `No route for product ${productId}` });
    }

    console.log(`[TC Webhook] Routing to ${route.name} → ${route.tag}`);

    // Forward to FEA Create with structured data
    const payload = {
      email: customerEmail,
      first_name: customerFirstName || customerName.split(' ')[0] || customerName,
      last_name: customerLastName || customerName.split(' ').slice(1).join(' ') || '',
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
